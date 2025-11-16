import React, { useState } from 'react';
import FileUpload from './FileUpload';
import { UploadIcon } from './icons/UploadIcon';
import { VideoIcon } from './icons/VideoIcon';

interface LandingPageProps {
  onStart: (photo: File, mediaFile: File | null) => void;
  isLoading: boolean;
  error: string | null;
}

const LandingPage: React.FC<LandingPageProps> = ({ onStart, isLoading, error }) => {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);

  const handleSubmit = () => {
    if (photoFile) {
      onStart(photoFile, mediaFile);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 sm:p-6 bg-gradient-to-br from-gray-900 via-gray-800 to-black">
      <div className="w-full max-w-4xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-600 mb-4">
          Echoes of Time
        </h1>
        <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto mb-8">
          Bring a cherished photograph to life. Upload an old photo to start a conversation with a digital echo of the past. You can also provide a short audio or video clip to help create a more authentic voice.
        </p>
        
        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg relative mb-6" role="alert">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <FileUpload
            id="photo-upload"
            label="Upload an Old Photo"
            onFileChange={setPhotoFile}
            accept="image/*"
            icon={<UploadIcon />}
          />
          <FileUpload
            id="media-upload"
            label="Upload Reference Audio or Video (Optional)"
            onFileChange={setMediaFile}
            accept="video/*, audio/*"
            icon={<VideoIcon />}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!photoFile || isLoading}
          className="relative inline-flex items-center justify-center p-0.5 mb-2 me-2 overflow-hidden text-sm font-medium text-gray-900 rounded-lg group bg-gradient-to-br from-purple-600 to-blue-500 group-hover:from-purple-600 group-hover:to-blue-500 hover:text-white dark:text-white focus:ring-4 focus:outline-none focus:ring-blue-300 dark:focus:ring-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="relative px-8 py-4 text-lg transition-all ease-in duration-75 bg-white dark:bg-gray-900 rounded-md group-hover:bg-opacity-0">
            {isLoading ? (
              <div className="flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Generating Persona...
              </div>
            ) : "Begin the Journey"}
          </span>
        </button>
      </div>
    </div>
  );
};

export default LandingPage;
