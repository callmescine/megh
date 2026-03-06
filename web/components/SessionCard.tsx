'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { addToast } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

interface Session {
  id: string;
  status: 'active' | 'grace' | 'destroyed' | string;
  ttl_minutes: number;
  port_mappings: Record<string, number> | Array<{ container_port: number; host_port: number }>;
  created_at: string;
  expires_at: string;
}

interface SessionCardProps {
  session: Session;
  onSessionUpdate?: () => void;
}

export default function SessionCard({ session, onSessionUpdate }: SessionCardProps) {
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState('');
  const truncatedId = session.id.slice(0, 12);

  const getTimeRemaining = (): string => {
    const now = Date.now();
    const expires = new Date(session.expires_at).getTime();
    const diff = expires - now;
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  };

  const handleEndSession = useCallback(async () => {
    setEnding(true);
    setError('');
    try {
      await api.sessions.delete(session.id);
      addToast(session.status === 'grace' ? 'Session destroyed' : 'Session ended', 'success');
      onSessionUpdate?.();
    } catch (err: any) {
      setError(err.message || 'Failed to end session');
      addToast(err.message || 'Failed to end session', 'error');
    } finally {
      setEnding(false);
    }
  }, [session.id, session.status, onSessionUpdate]);

  const handleDownload = useCallback(async () => {
    try {
      const blob = await api.sessions.download(session.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session-${session.id}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast('Download started', 'info');
    } catch (err) {
      console.error('Failed to download session:', err);
      addToast('Download failed', 'error');
    }
  }, [session.id]);

  const portEntries: [string, number][] = Array.isArray(session.port_mappings)
    ? session.port_mappings.map((pm) => [String(pm.container_port), pm.host_port])
    : Object.entries(session.port_mappings || {});

  const statusVariant = (status: string) => {
    const map: Record<string, 'success' | 'warning' | 'danger'> = {
      active: 'success', grace: 'warning', destroyed: 'danger',
    };
    return map[status] || 'danger';
  };

  const createdDate = new Date(session.created_at).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="relative border border-surface-300 rounded-xl p-4 bg-surface-100 flex flex-col gap-3 hover:border-surface-400 hover:shadow-card transition-all duration-200">
      {ending && (
        <div className="absolute inset-0 bg-surface-0/80 rounded-xl flex items-center justify-center z-10">
          <div className="flex items-center gap-3">
            <Spinner size="sm" />
            <span className="text-sm text-gray-300">
              {session.status === 'grace' ? 'Destroying session...' : 'Ending session...'}
            </span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <code className="text-sm text-gray-200 font-mono">{truncatedId}</code>
          <span className="flex items-center gap-1.5">
            {session.status === 'active' && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            )}
            <Badge variant={statusVariant(session.status)}>{session.status}</Badge>
          </span>
        </div>
        <span className="text-xs text-gray-500">{createdDate}</span>
      </div>

      {/* Container Specs + TTL */}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-gray-400">TTL: {session.ttl_minutes}m</span>
        <span className="text-gray-500">{getTimeRemaining()}</span>
        <span className="text-gray-600">|</span>
        <Badge variant="info">2 vCPU</Badge>
        <Badge variant="info">2 GB</Badge>
      </div>

      {/* Port Mappings */}
      {portEntries.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {portEntries.map(([containerPort, hostPort]) => {
            const previewUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/preview/${session.id}/${hostPort}/`;
            return (
              <a
                key={containerPort}
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded-full text-xs font-medium bg-megh-900/40 text-megh-400 hover:bg-megh-800/60 hover:text-megh-300 border border-megh-700/30 transition-all"
              >
                :{containerPort} &rarr; Preview
              </a>
            );
          })}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-xs text-red-400 bg-red-900/30 border border-red-800 rounded px-2 py-1">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-1">
        {session.status === 'active' && (
          <>
            <Link href={`/terminal/${session.id}`}>
              <Button size="sm">Open Terminal</Button>
            </Link>
            <Button variant="destructive" size="sm" onClick={handleEndSession} disabled={ending}>
              End Session
            </Button>
          </>
        )}

        {(session.status === 'active' || session.status === 'grace') && (
          <Button variant="outline" size="sm" onClick={handleDownload}>
            Download
          </Button>
        )}

        {session.status === 'grace' && (
          <Button variant="destructive" size="sm" onClick={handleEndSession} disabled={ending}>
            Destroy
          </Button>
        )}
      </div>
    </div>
  );
}
