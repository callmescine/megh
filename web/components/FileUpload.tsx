'use client';

import { useState, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { addToast } from '@/lib/toast';

interface FileUploadProps {
  sessionId: string;
  onUploadComplete?: () => void;
  disabled?: boolean;
}

type UploadState = 'idle' | 'dragover' | 'uploading' | 'done' | 'error';

export default function FileUpload({ sessionId, onUploadComplete, disabled = false }: FileUploadProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedTypes = ['.tar', '.tar.gz', '.tgz'];

  const isValidFile = (file: File): boolean => {
    const name = file.name.toLowerCase();
    return acceptedTypes.some((ext) => name.endsWith(ext));
  };

  const handleUpload = useCallback(
    async (file: File) => {
      if (!isValidFile(file)) {
        setState('error');
        setErrorMessage('Invalid file type. Accepted: .tar, .tar.gz, .tgz');
        return;
      }

      setFileName(file.name);
      setState('uploading');
      setErrorMessage('');
      setProgress(0);

      try {
        await api.sessions.upload(sessionId, file, (percent) => {
          setProgress(percent);
        });
        setState('done');
        setProgress(100);
        addToast('File uploaded successfully', 'success');
        onUploadComplete?.();
        setTimeout(() => setState('idle'), 3000);
      } catch (err: any) {
        setState('error');
        setErrorMessage(err.message || 'Upload failed');
        addToast(err.message || 'Upload failed', 'error');
      }
    },
    [sessionId, onUploadComplete]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setState('dragover');
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState('idle');
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      setState('idle');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleUpload(files[0]);
      }
    },
    [disabled, handleUpload]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleUpload(files[0]);
      }
    },
    [handleUpload]
  );

  const handleClick = useCallback(() => {
    if (!disabled && state !== 'uploading') {
      fileInputRef.current?.click();
    }
  }, [disabled, state]);

  const borderClass =
    state === 'dragover' ? 'border-blue-500 bg-blue-500/10'
    : state === 'uploading' ? 'border-amber-500'
    : state === 'done' ? 'border-green-500 bg-green-500/10'
    : state === 'error' ? 'border-red-500 bg-red-500/10'
    : 'border-surface-400';

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`border-2 border-dashed rounded-lg p-6 text-center transition-all ${borderClass} ${
        disabled || state === 'uploading' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".tar,.tgz,application/gzip,application/x-tar,application/x-gzip,application/x-compressed-tar"
        onChange={handleFileSelect}
        className="hidden"
      />

      {state === 'idle' && (
        <div>
          <p className="text-sm text-gray-400">
            Drag and drop a file here, or click to select
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Accepted: .tar, .tar.gz, .tgz
          </p>
        </div>
      )}

      {state === 'dragover' && (
        <p className="text-sm text-blue-400">Drop file to upload</p>
      )}

      {state === 'uploading' && (
        <div>
          <p className="text-sm text-amber-400">
            Uploading {fileName}... {progress}%
          </p>
          <div className="mt-2 h-1 bg-surface-300 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {state === 'done' && (
        <p className="text-sm text-green-400">Upload complete!</p>
      )}

      {state === 'error' && (
        <p className="text-sm text-red-400">{errorMessage}</p>
      )}
    </div>
  );
}
