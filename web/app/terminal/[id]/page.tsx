'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, isTarFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addToast } from '@/lib/toast';
import Terminal from '@/components/Terminal';
import type { TerminalHandle } from '@/components/Terminal';
import TTLBanner from '@/components/TTLBanner';
import PreviewLinks from '@/components/PreviewLinks';
import { MeghLogo } from '@/components/MeghLogo';

interface PreviewLink {
  port: number;
  url: string;
}

export default function TerminalPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const sessionId = params.id as string;
  const terminalRef = useRef<TerminalHandle>(null);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previewLinks, setPreviewLinks] = useState<PreviewLink[]>([]);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (!user) return;

    const fetchSession = async () => {
      try {
        const data = await api.sessions.get(sessionId);
        setSession(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Session not found';
        setError(message);
        setTimeout(() => router.push('/dashboard'), 2000);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [sessionId, router, user, authLoading]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const handlePreviewUrl = useCallback((url: string, port: number) => {
    setPreviewLinks((prev) => {
      if (prev.some((l) => l.port === port)) return prev;
      return [...prev, { port, url }];
    });
  }, []);

  const handleDownload = async () => {
    try {
      const blob = await api.sessions.download(sessionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session-${sessionId}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  const handleEndSession = async () => {
    try {
      await api.sessions.delete(sessionId);
      router.push('/dashboard');
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  };

  const handleUploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const isTar = files.length === 1 && isTarFile(files[0].name);
      if (isTar) {
        await api.sessions.upload(sessionId, files[0]);
      } else {
        await api.sessions.uploadMedia(sessionId, files);
      }
      addToast(`${files.length} file(s) uploaded to workspace`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      addToast(message, 'error');
    } finally {
      setUploading(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#1c1c1e] gap-6">
        <div className="relative">
          <div className="absolute inset-0 bg-megh-500/20 rounded-full blur-[40px] animate-pulse-glow" />
          <MeghLogo size="xl" showText={false} className="relative z-10" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-gray-400 animate-fade-up">Connecting to terminal...</p>
          <div className="w-32 h-1 bg-neutral-700 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-megh-500 to-megh-300 rounded-full animate-shimmer bg-[length:200%_100%]" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1c1c1e]">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (!session || !user) return null;

  const truncatedId = sessionId.length > 12 ? sessionId.slice(0, 12) + '...' : sessionId;

  return (
    <div className="h-screen flex flex-col bg-[#1c1c1e]">
      {/* macOS-style title bar */}
      <div className="flex-shrink-0 h-11 bg-[#2d2d2f] border-b border-[#3a3a3c] flex items-center px-4 select-none">
        {/* Left: traffic lights + nav */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Traffic lights */}
          <div className="flex items-center gap-[7px]">
            {showEndConfirm ? (
              <>
                <button
                  onClick={handleEndSession}
                  title="End session"
                  className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors flex items-center justify-center group"
                >
                  <svg width="6" height="6" viewBox="0 0 6 6" className="opacity-0 group-hover:opacity-100 transition-opacity" stroke="#4a0000" strokeWidth="1.2">
                    <line x1="1" y1="1" x2="5" y2="5" /><line x1="5" y1="1" x2="1" y2="5" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowEndConfirm(false)}
                  className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-400 transition-colors flex items-center justify-center group"
                  title="Cancel"
                >
                  <svg width="6" height="6" viewBox="0 0 6 6" className="opacity-0 group-hover:opacity-100 transition-opacity" stroke="#5a4500" strokeWidth="1.2">
                    <line x1="1" y1="3" x2="5" y2="3" />
                  </svg>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setShowEndConfirm(true)}
                  title="End session"
                  className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-110 transition-all"
                />
                <button
                  onClick={() => router.push('/dashboard')}
                  title="Back to dashboard"
                  className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-110 transition-all"
                />
                <div className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-110 transition-all" />
              </>
            )}
          </div>

          <div className="h-4 w-px bg-[#3a3a3c]" />

          <button
            onClick={() => router.push('/dashboard')}
            className="text-[11px] text-[#98989d] hover:text-white transition-colors"
          >
            Dashboard
          </button>
        </div>

        {/* Center: session info */}
        <div className="flex items-center gap-2">
          <MeghLogo size="sm" showText={false} />
          <span className="text-[11px] text-[#98989d] font-mono">{truncatedId}</span>
          <span className="text-[10px] text-[#636366] px-1.5 py-0.5 rounded bg-[#3a3a3c]">2 vCPU</span>
          <span className="text-[10px] text-[#636366] px-1.5 py-0.5 rounded bg-[#3a3a3c]">2 GB</span>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5 flex-1 justify-end">
          <PreviewLinks links={previewLinks} />

          <input
            ref={uploadInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleUploadFiles(Array.from(e.target.files));
              }
              e.target.value = '';
            }}
          />
          <button
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploading}
            title={uploading ? 'Uploading...' : 'Upload files'}
            className="p-1.5 rounded-md text-[#98989d] hover:text-white hover:bg-[#3a3a3c] transition-colors disabled:opacity-40"
          >
            {uploading ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <path d="M12 2v4m0 12v4m-7.07-14.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            )}
          </button>

          <button
            onClick={handleDownload}
            title="Download workspace"
            className="p-1.5 rounded-md text-[#98989d] hover:text-white hover:bg-[#3a3a3c] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>

          {showEndConfirm && (
            <span className="text-[10px] text-[#ff453a] ml-1 animate-pulse">
              Click red to confirm
            </span>
          )}
        </div>
      </div>

      {/* TTL Banner */}
      {session.expires_at && (
        <div className="flex-shrink-0">
          <TTLBanner expiresAt={session.expires_at} />
        </div>
      )}

      {/* Terminal */}
      <div className="flex-1 min-h-0">
        <Terminal
          ref={terminalRef}
          sessionId={sessionId}
          onPreviewUrl={handlePreviewUrl}
        />
      </div>
    </div>
  );
}
