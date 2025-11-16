import React, { useState, useRef } from 'react';
import { AudioIcon } from './icons/AudioIcon';

interface FileUploadProps {
  id: string;
  label: string;
  onFileChange: (file: File | null) => void;
  accept: string;
  icon: React.ReactNode;
}

const FileUpload: React.FC<FileUploadProps> = ({ id, label, onFileChange, accept, icon }) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] || null;
    if (selectedFile) {
      setFile(selectedFile);
      setPreview(URL.createObjectURL(selectedFile));
      onFileChange(selectedFile);
    }
  };

  const handleClear = (event: React.MouseEvent) => {
    event.stopPropagation();
    setFile(null);
    setPreview(null);
    onFileChange(null);
    if (inputRef.current) {
        inputRef.current.value = "";
    }
  };

  return (
    <div 
      className="relative border-2 border-dashed border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-purple-500 transition-colors duration-300 h-64 flex flex-col items-center justify-center bg-gray-800/50"
      onClick={() => inputRef.current?.click()}
    >
      <input
        id={id}
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
        accept={accept}
      />
      {preview ? (
        <div className="relative w-full h-full">
          {file?.type.startsWith('image/') ? (
            <img src={preview} alt="Preview" className="w-full h-full object-contain rounded-md" />
          ) : file?.type.startsWith('video/') ? (
            <video src={preview} className="w-full h-full object-contain rounded-md" muted autoPlay loop />
          ) : file?.type.startsWith('audio/') ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <div className="w-16 h-16">
                    <AudioIcon />
                </div>
                <p className="mt-2 text-sm text-gray-300 break-all px-2 text-center">{file.name}</p>
            </div>
          ) : (
             <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <p>Unsupported file type</p>
                <p className="mt-2 text-sm text-gray-300 break-all px-2 text-center">{file?.name}</p>
            </div>
          )}
          <button
            onClick={handleClear}
            className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-1.5 hover:bg-red-700 transition-colors z-10"
            aria-label="Remove file"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="text-gray-400">
          <div className="mx-auto h-12 w-12 text-gray-500">{icon}</div>
          <p className="mt-2 font-semibold text-gray-300">{label}</p>
          <p className="text-xs text-gray-500">Click or drag file to this area</p>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
