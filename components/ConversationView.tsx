

import React, { useState, useEffect, useRef, useCallback } from 'react';
// FIX: The `LiveSession` type is not an exported member of `@google/genai`.
// It is now defined locally, and the `Blob` type is imported for use in the interface.
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { TranscriptEntry } from '../types';
import { MicIcon } from './icons/MicIcon';
import { decode, decodeAudioData, createPcmBlob } from '../utils/audio';

// FIX: Define the LiveSession interface locally as it's not exported from the SDK.
interface LiveSession {
  sendRealtimeInput(input: { media: Blob }): void;
  close(): void;
}

interface MouthCoordinates {
    x: number;
    y: number;
    width: number;
    height: number;
}

// Audio configuration
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096;
// FIX: Increased FFT size from 32 to 256 for more stable and reliable audio volume analysis.
const ANALYSER_FFT_SIZE = 256;

interface ConversationViewProps {
  photoUrl: string;
  personalityPrompt: string;
  voiceName: string;
  mouthCoordinates: MouthCoordinates | null;
  onEnd: () => void;
}

const ConversationView: React.FC<ConversationViewProps> = ({ photoUrl, personalityPrompt, voiceName, mouthCoordinates, onEnd }) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [activeAudioSources, setActiveAudioSources] = useState(0);

  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const smoothedVolumeRef = useRef(0);

  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  
  const isModelSpeaking = activeAudioSources > 0;

  const stopAudioProcessing = useCallback(() => {
    if (scriptProcessorRef.current && mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
        mediaStreamSourceRef.current = null;
    }
    if(audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null;
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
        inputAudioContextRef.current.close();
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        outputAudioContextRef.current.close();
    }
  }, []);

  const endConversation = useCallback(() => {
    setStatus('idle');
    if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => session.close());
        sessionPromiseRef.current = null;
    }
    stopAudioProcessing();
    if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
    }
    for (const source of audioSourcesRef.current.values()) {
        source.stop();
    }
    audioSourcesRef.current.clear();
    onEnd();
  }, [onEnd, stopAudioProcessing]);
  
  const stopAnimation = useCallback(() => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      // When stopping, restore the canvas to the original, static image
      const canvas = canvasRef.current;
      const img = imageRef.current;
      if (!canvas || !img) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }, []);
  
  // Lip-sync animation loop using canvas jaw-drop effect
  const animateMouth = useCallback(() => {
    if (!analyserNodeRef.current || !canvasRef.current || !imageRef.current || !mouthCoordinates) {
        animationFrameIdRef.current = requestAnimationFrame(animateMouth);
        return;
    };
    const analyser = analyserNodeRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = imageRef.current;
    const coords = mouthCoordinates;
    if (!ctx) return;

    // Use Time Domain data for a more direct and accurate volume measure.
    const dataArray = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(dataArray);

    // Calculate Root Mean Square (RMS) to measure audio power/loudness.
    let sumSquares = 0.0;
    for (const amplitude of dataArray) {
        // The values are 0-255, with 128 as the zero-point (silence). Normalize to -1 to 1.
        const normSample = (amplitude / 128.0) - 1.0;
        sumSquares += normSample * normSample;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);

    // Use a threshold to prevent background noise from triggering the animation.
    const volumeThreshold = 0.02; 
    const effectiveVolume = (rms > volumeThreshold) ? rms : 0;
    
    // Apply smoothing (a low-pass filter) to the volume to prevent jittery animation.
    const smoothingFactor = 0.25;
    smoothedVolumeRef.current = smoothedVolumeRef.current * (1 - smoothingFactor) + effectiveVolume * smoothingFactor;
    
    // Map the smoothed volume to how much the mouth should open in pixels.
    const dHeight = canvas.height * (coords.height / 100);
    // The mouth can open up to 70% of its original height for a pronounced effect.
    const maxOpenness = dHeight * 0.7; 
    // FIX: The multiplier is increased for more responsive and visible animation.
    const mouthOpenness = smoothedVolumeRef.current * maxOpenness * 8;

    // Define coordinates for the source image (s) and canvas destination (d).
    const sy = img.height * (coords.y / 100);
    const sHeight = img.height * (coords.height / 100);
    const dy = canvas.height * (coords.y / 100);

    // Split the image at the horizontal center of the mouth to create a "jaw".
    const jawLineSourceY = sy + sHeight / 2;
    const jawLineCanvasY = dy + dHeight / 2;
    
    // Clear the canvas before drawing the new frame.
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Only animate if the mouth should be open (prevents tiny, flickery movements).
    if (mouthOpenness > 1) { 
        // 1. Draw the top part of the image (above the jaw line), which remains static.
        ctx.drawImage(
            img,
            0, 0, img.width, jawLineSourceY,
            0, 0, canvas.width, jawLineCanvasY
        );

        // 2. Draw the bottom part of the image (the jaw), shifted downwards by mouthOpenness.
        ctx.drawImage(
            img,
            0, jawLineSourceY, img.width, img.height - jawLineSourceY,
            0, jawLineCanvasY + mouthOpenness, canvas.width, canvas.height - jawLineCanvasY
        );
        
        // 3. Fill the gap created by the jaw drop by stretching the pixels from the jaw line.
        ctx.drawImage(
            img,
            0, jawLineSourceY - 1, img.width, 2, // Take a 2px slice for a smoother blend.
            0, jawLineCanvasY, canvas.width, mouthOpenness // Stretch it to fill the gap.
        );
    } else {
        // If there's no sound, draw the original, static image.
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }

    animationFrameIdRef.current = requestAnimationFrame(animateMouth);
  }, [mouthCoordinates]);

  // Initial image drawing on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !photoUrl) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = photoUrl;
    imageRef.current = img;
    
    img.onload = () => {
        const container = canvas.parentElement;
        if (container) {
            const maxWidth = container.clientWidth;
            const scale = maxWidth / img.width;
            canvas.width = maxWidth;
            canvas.height = img.height * scale;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
    }
  }, [photoUrl]);


  const startConversation = useCallback(async () => {
    setStatus('connecting');
    setTranscript([]);

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStreamRef.current = stream;

        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
        const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
        outputAudioContextRef.current = outCtx;

        const analyser = outCtx.createAnalyser();
        analyser.fftSize = ANALYSER_FFT_SIZE;
        analyser.connect(outCtx.destination);
        analyserNodeRef.current = analyser;

        nextStartTimeRef.current = 0;

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

        sessionPromiseRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } },
                },
                systemInstruction: personalityPrompt,
                inputAudioTranscription: {},
                outputAudioTranscription: {},
            },
            callbacks: {
                onopen: () => {
                    setStatus('live');
                    const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
                    mediaStreamSourceRef.current = source;
                    const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1);
                    scriptProcessorRef.current = scriptProcessor;
                    
                    scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const pcmBlob = createPcmBlob(inputData);
                        sessionPromiseRef.current!.then((session) => {
                            session.sendRealtimeInput({ media: pcmBlob });
                        });
                    };
                    source.connect(scriptProcessor);
                    scriptProcessor.connect(inputAudioContextRef.current!.destination);
                },
                onmessage: async (message: LiveServerMessage) => {
                    const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                    if (audioData && outputAudioContextRef.current && analyserNodeRef.current) {
                        // Guard: Only start animation if we have mouth coordinates
                        if (animationFrameIdRef.current === null && mouthCoordinates) {
                            animateMouth(); // Start animation loop on first audio chunk
                        }
                        
                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
                        const audioBuffer = await decodeAudioData(decode(audioData), outputAudioContextRef.current, OUTPUT_SAMPLE_RATE, 1);
                        const sourceNode = outputAudioContextRef.current.createBufferSource();
                        sourceNode.buffer = audioBuffer;
                        sourceNode.connect(analyserNodeRef.current);
                        
                        setActiveAudioSources(prev => prev + 1);
                        sourceNode.addEventListener('ended', () => {
                            audioSourcesRef.current.delete(sourceNode)
                            setActiveAudioSources(prev => {
                                const newCount = Math.max(0, prev - 1);
                                if (newCount === 0) {
                                    stopAnimation();
                                }
                                return newCount;
                            });
                        });

                        sourceNode.start(nextStartTimeRef.current);
                        nextStartTimeRef.current += audioBuffer.duration;
                        audioSourcesRef.current.add(sourceNode);
                    }

                    if (message.serverContent?.interrupted) {
                        for (const source of audioSourcesRef.current.values()) source.stop();
                        audioSourcesRef.current.clear();
                        setActiveAudioSources(0);
                        nextStartTimeRef.current = 0;
                        stopAnimation();
                    }
                    
                    if (message.serverContent?.inputTranscription) {
                        currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
                    }
                    if (message.serverContent?.outputTranscription) {
                        currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
                    }
                    if (message.serverContent?.turnComplete) {
                        const fullInput = currentInputTranscriptionRef.current.trim();
                        const fullOutput = currentOutputTranscriptionRef.current.trim();
                        
                        setTranscript(prev => {
                            const newEntries: TranscriptEntry[] = [];
                            if(fullInput) newEntries.push({ speaker: 'user', text: fullInput });
                            if(fullOutput) newEntries.push({ speaker: 'model', text: fullOutput });
                            return [...prev, ...newEntries];
                        });

                        currentInputTranscriptionRef.current = '';
                        currentOutputTranscriptionRef.current = '';
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error('Session error:', e);
                    setStatus('error');
                    stopAudioProcessing();
                },
                onclose: () => {
                    stopAudioProcessing();
                },
            },
        });
    } catch (err) {
        console.error('Failed to start conversation:', err);
        setStatus('error');
    }
  }, [personalityPrompt, stopAudioProcessing, voiceName, animateMouth, stopAnimation, mouthCoordinates]);
  
  // Cleanup effect
  useEffect(() => {
    return () => {
        if(sessionPromiseRef.current) {
            sessionPromiseRef.current.then(s => s.close());
        }
        stopAnimation();
        stopAudioProcessing();
    }
  }, [stopAudioProcessing, stopAnimation]);


  const getStatusIndicator = () => {
    switch(status) {
        case 'live':
            return <div className="flex items-center space-x-2"><div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div><span>Live</span></div>;
        case 'connecting':
            return <div className="flex items-center space-x-2"><div className="w-3 h-3 bg-yellow-500 rounded-full animate-ping"></div><span>Connecting...</span></div>;
        case 'error':
            return <div className="flex items-center space-x-2 text-red-400"><div className="w-3 h-3 bg-red-500 rounded-full"></div><span>Error</span></div>;
        default:
             return <div className="flex items-center space-x-2 text-gray-400"><div className="w-3 h-3 bg-gray-500 rounded-full"></div><span>Idle</span></div>;
    }
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-black">
      <div className="md:w-1/2 lg:w-2/5 flex flex-col items-center justify-center p-8 bg-gray-900">
        <div className="relative w-full max-w-sm">
            <canvas 
              ref={canvasRef}
              className={`w-full h-auto object-contain rounded-lg shadow-2xl shadow-purple-500/20 transition-all duration-300 ${isModelSpeaking ? 'speaking-glow' : ''}`}
            />
            <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-lg text-sm">{getStatusIndicator()}</div>
        </div>

        {status === 'idle' && (
            <button onClick={startConversation} className="mt-8 flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 rounded-full text-lg font-bold transition-transform transform hover:scale-105">
                <MicIcon/> Start Conversation
            </button>
        )}
        {(status === 'live' || status === 'connecting') && (
            <button onClick={endConversation} className="mt-8 px-6 py-3 bg-red-600 hover:bg-red-700 rounded-full text-lg font-bold transition-transform transform hover:scale-105">
                End Conversation
            </button>
        )}
      </div>

      <div className="md:w-1/2 lg:w-3/5 flex flex-col p-4 sm:p-6 bg-gray-800/50">
        <h2 className="text-2xl font-bold mb-4 border-b border-gray-700 pb-2 text-gray-200">Conversation Transcript</h2>
        <div className="flex-grow overflow-y-auto pr-2 space-y-4">
          {transcript.length === 0 && (
            <div className="flex items-center justify-center h-full text-gray-500">
                <p>Your conversation will appear here...</p>
            </div>
          )}
          {transcript.map((entry, index) => (
            <div key={index} className={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-md p-3 rounded-xl ${entry.speaker === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-200 rounded-bl-none'}`}>
                <p className="font-bold capitalize text-sm mb-1">{entry.speaker}</p>
                <p>{entry.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ConversationView;