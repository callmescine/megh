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
  const [uploadLabel, setUploadLabel] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isTarFile = (file: File): boolean => {
    const name = file.name.toLowerCase();
    return name.endsWith('.tar') || name.endsWith('.tar.gz') || name.endsWith('.tgz');
  };

  const handleUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      // If single tar file, use the existing tar upload endpoint
      if (files.length === 1 && isTarFile(files[0])) {
        setUploadLabel(files[0].name);
        setState('uploading');
        setErrorMessage('');
        setProgress(0);

        try {
          await api.sessions.upload(sessionId, files[0], (percent) => {
            setProgress(percent);
          });
          setState('done');
          setProgress(100);
          addToast('Archive uploaded successfully', 'success');
          onUploadComplete?.();
          setTimeout(() => setState('idle'), 3000);
        } catch (err: any) {
          setState('error');
          setErrorMessage(err.message || 'Upload failed');
          addToast(err.message || 'Upload failed', 'error');
        }
        return;
      }

      // Otherwise, use the media upload endpoint for individual files
      const label = files.length === 1 ? files[0].name : `${files.length} files`;
      setUploadLabel(label);
      setState('uploading');
      setErrorMessage('');
      setProgress(0);

      try {
        await api.sessions.uploadMedia(sessionId, files, (percent) => {
          setProgress(percent);
        });
        setState('done');
        setProgress(100);
        addToast(`${files.length} file(s) uploaded successfully`, 'success');
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
      const fileList = e.dataTransfer.files;
      if (fileList.length > 0) {
        handleUpload(Array.from(fileList));
      }
    },
    [disabled, handleUpload]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (fileList && fileList.length > 0) {
        handleUpload(Array.from(fileList));
      }
      // Reset so the same files can be selected again
      e.target.value = '';
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
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {state === 'idle' && (
        <div>
          <p className="text-sm text-gray-400">
            Drag and drop files here, or click to select
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Any file type supported — images, videos, documents, archives, etc.
          </p>
        </div>
      )}

      {state === 'dragover' && (
        <p className="text-sm text-blue-400">Drop files to upload</p>
      )}

      {state === 'uploading' && (
        <div>
          <p className="text-sm text-amber-400">
            Uploading {uploadLabel}... {progress}%
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
