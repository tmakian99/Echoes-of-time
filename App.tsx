import React, { useState, useCallback } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import LandingPage from './components/LandingPage';
import ConversationView from './components/ConversationView';
import { blobToBase64 } from './utils/file';

type AppState = 'upload' | 'generating' | 'conversation';

interface MouthCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('upload');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [personalityPrompt, setPersonalityPrompt] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState<string>('Zephyr'); // Default voice
  const [mouthCoordinates, setMouthCoordinates] = useState<MouthCoordinates | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStartJourney = useCallback(async (photoFile: File, mediaFile: File | null) => {
    setAppState('generating');
    setError(null);
    try {
      const photoBase64 = await blobToBase64(photoFile);
      const photoUrl = URL.createObjectURL(photoFile);
      setPhotoUrl(photoUrl);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      
      const imagePart = {
        inlineData: {
          mimeType: photoFile.type,
          data: photoBase64,
        },
      };

      // 1. Generate Persona
      const personaResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: { parts: [imagePart, {
            text: `Analyze this old photograph of a person. Based on their attire, expression, and the photo's style, create a detailed persona for them. Describe their likely personality, era they lived in, potential profession, and hobbies. Formulate this as a system instruction for a conversational AI, starting with 'You are...'. The persona should be warm and engaging. Respond from a first-person perspective as if you are this person. Keep it concise, under 150 words.`
          }] }
      });
      const generatedPrompt = personaResponse.text;
      setPersonalityPrompt(generatedPrompt);

      // 2. Detect mouth coordinates for lip-sync
      const mouthCoordsResponse = await ai.models.generateContent({
        model: 'gemini-2.5-pro', // Using a more powerful model for better visual analysis
        contents: { parts: [imagePart, {
            text: "Analyze this image and identify the person's mouth. Provide a tight bounding box that precisely encloses only the lips. The chin and nose should not be in the box. Respond only with a JSON object like `{\"x\": number, \"y\": number, \"width\": number, \"height\": number}` where the values are percentages of the image's total width and height, from the top-left corner."
          }] },
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    x: { type: Type.NUMBER },
                    y: { type: Type.NUMBER },
                    width: { type: Type.NUMBER },
                    height: { type: Type.NUMBER },
                },
                required: ['x', 'y', 'width', 'height']
            }
        }
      });
      
      try {
        const coordsText = mouthCoordsResponse.text.trim();
        const coords = JSON.parse(coordsText);
        if (coords.x && coords.y && coords.width && coords.height) {
            setMouthCoordinates(coords);
        }
      } catch(e) {
        console.warn("Could not parse mouth coordinates, lip-sync will be disabled.", e);
        setMouthCoordinates(null);
      }


      // 3. If no media file, detect gender to select voice
      if (!mediaFile) {
        const genderResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: { parts: [imagePart, {
            text: "Analyze the person in this image. Is their gender more likely to be male or female? Respond with a JSON object containing a single key 'gender' with the value 'male' or 'female'."
          }]},
          config: {
              responseMimeType: 'application/json',
              responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                      gender: { 
                          type: Type.STRING,
                          enum: ['male', 'female']
                      }
                  },
                  required: ['gender']
              }
          }
        });
        
        try {
            const genderText = genderResponse.text.trim();
            const genderObj = JSON.parse(genderText);
            const gender = genderObj.gender;
            // Select voice based on gender (Kore=Female, Zephyr=Male)
            if (gender === 'female') {
              setVoiceName('Kore');
            } else {
              setVoiceName('Zephyr');
            }
        } catch(e) {
            console.warn("Could not determine gender, using default voice.", e);
            setVoiceName('Zephyr'); // Fallback to default
        }
      } else {
        // Use default voice if media is provided
        setVoiceName('Zephyr');
      }

      setAppState('conversation');
    } catch (err) {
      console.error(err);
      setError('Could not generate a persona. Please check your API key and try again.');
      setAppState('upload');
    }
  }, []);

  const handleEndConversation = () => {
    setAppState('upload');
    setPhotoUrl(null);
    setPersonalityPrompt(null);
    setError(null);
    setMouthCoordinates(null);
  };

  const renderContent = () => {
    switch (appState) {
      case 'conversation':
        if (photoUrl && personalityPrompt) {
          return (
            <ConversationView
              photoUrl={photoUrl}
              personalityPrompt={personalityPrompt}
              voiceName={voiceName}
              mouthCoordinates={mouthCoordinates}
              onEnd={handleEndConversation}
            />
          );
        }
        // Fallback to upload if state is inconsistent
        setAppState('upload');
        return null;
      case 'generating':
      case 'upload':
      default:
        return (
          <LandingPage
            onStart={handleStartJourney}
            isLoading={appState === 'generating'}
            error={error}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans">
      {renderContent()}
    </div>
  );
};

export default App;