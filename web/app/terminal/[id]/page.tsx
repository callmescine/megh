'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addToast } from '@/lib/toast';
import Terminal from '@/components/Terminal';
import type { TerminalHandle } from '@/components/Terminal';
import TTLBanner from '@/components/TTLBanner';
import PreviewLinks from '@/components/PreviewLinks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
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
      } catch (err: any) {
        setError(err.message || 'Session not found');
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
      const isTar = files.length === 1 && /\.(tar|tar\.gz|tgz)$/i.test(files[0].name);
      if (isTar) {
        await api.sessions.upload(sessionId, files[0]);
      } else {
        await api.sessions.uploadMedia(sessionId, files);
      }
      addToast(`${files.length} file(s) uploaded to workspace`, 'success');
    } catch (err: any) {
      addToast(err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-surface-0 gap-6">
        <div className="relative">
          <div className="absolute inset-0 bg-megh-500/20 rounded-full blur-[40px] animate-pulse-glow" />
          <MeghLogo size="xl" showText={false} className="relative z-10" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-gray-400 animate-fade-up">Connecting to terminal...</p>
          <div className="w-32 h-1 bg-surface-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-megh-500 to-megh-300 rounded-full animate-shimmer bg-[length:200%_100%]" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-0">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (!session || !user) return null;

  const truncatedId = sessionId.length > 12 ? sessionId.slice(0, 12) + '...' : sessionId;

  return (
    <div className="h-screen flex flex-col bg-surface-0">
      {/* Header Bar */}
      <div className="flex-shrink-0 h-10 bg-surface-50 border-b border-surface-300 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <MeghLogo size="sm" showText={false} />
          <button
            onClick={() => router.push('/dashboard')}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            &larr; Dashboard
          </button>
          <code className="text-xs text-gray-600 font-mono">{truncatedId}</code>
          <Badge variant="info">2 vCPU</Badge>
          <Badge variant="info">2 GB</Badge>
        </div>

        <div className="flex items-center gap-2">
          {previewLinks.length > 0 && <PreviewLinks links={previewLinks} />}

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>

          <Button variant="outline" size="sm" onClick={handleDownload}>
            Download
          </Button>

          {showEndConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Confirm?</span>
              <Button variant="destructive" size="sm" onClick={handleEndSession}>
                Yes, End
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowEndConfirm(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="destructive" size="sm" onClick={() => setShowEndConfirm(true)}>
              End Session
            </Button>
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
