'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { UserLayout } from '@/components/layouts/user-layout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import FileUpload from '@/components/FileUpload';
import { addToast } from '@/lib/toast';

export default function SessionDetailPage() {
  const params = useParams();
  const { user } = useAuth();
  const sessionId = params.id as string;

  const [session, setSession] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ending, setEnding] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sessionData, usageData] = await Promise.all([
        api.sessions.get(sessionId),
        api.billing.sessionUsage(sessionId).catch(() => null),
      ]);
      setSession(sessionData);
      setUsage(usageData);
    } catch (err: any) {
      setError(err.message || 'Failed to load session');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && sessionId) fetchData();
  }, [user, sessionId]);

  const handleEndSession = async () => {
    if (!confirm('Are you sure you want to end this session?')) return;
    setEnding(true);
    try {
      await api.sessions.delete(sessionId);
      addToast('Session ended', 'success');
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to end session');
    } finally {
      setEnding(false);
    }
  };

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
    } catch (err: any) {
      setError(err.message || 'Failed to download');
    }
  };

  const statusVariant = (status: string) => {
    const map: Record<string, 'success' | 'warning' | 'danger'> = {
      active: 'success', grace: 'warning', destroyed: 'danger',
    };
    return map[status] || 'danger';
  };

  return (
    <UserLayout>
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : error && !session ? (
        <div className="text-center space-y-4 py-20">
          <p className="text-red-400">{error}</p>
          <Link href="/dashboard" className="text-megh-400 hover:text-megh-300 text-sm">
            Back to Dashboard
          </Link>
        </div>
      ) : session ? (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
                &larr; Back to Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-white mt-2">Session Details</h1>
              <code className="text-sm text-gray-400 mt-1 block font-mono">{session.id}</code>
            </div>
            <Badge variant={statusVariant(session.status)}>{session.status}</Badge>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-900/50 border border-red-800 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Session Info + Container Specs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><h3 className="font-semibold text-white">Information</h3></CardHeader>
              <CardContent className="text-sm divide-y divide-surface-300">
                <div className="flex justify-between py-3">
                  <span className="text-gray-400">Status</span>
                  <Badge variant={statusVariant(session.status)}>{session.status}</Badge>
                </div>
                <div className="flex justify-between py-3">
                  <span className="text-gray-400">TTL</span>
                  <span className="text-gray-200">{session.ttl_minutes} minutes</span>
                </div>
                <div className="flex justify-between py-3">
                  <span className="text-gray-400">Created</span>
                  <span className="text-gray-200">{new Date(session.created_at).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-3">
                  <span className="text-gray-400">Expires</span>
                  <span className="text-gray-200">{new Date(session.expires_at).toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><h3 className="font-semibold text-white">Container Specs</h3></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">CPU</span>
                  <Badge variant="info">2 vCPU</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Memory</span>
                  <Badge variant="info">2 GB RAM</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Image</span>
                  <span className="text-gray-200 font-mono text-xs">megh-agent:latest</span>
                </div>
                {session.port_mappings && (Array.isArray(session.port_mappings) ? session.port_mappings : Object.entries(session.port_mappings)).length > 0 && (
                  <div>
                    <span className="text-gray-400 block mb-1">Ports</span>
                    <div className="flex flex-col gap-2">
                      {(Array.isArray(session.port_mappings)
                        ? session.port_mappings.map((pm: any) => [pm.container_port, pm.host_port])
                        : Object.entries(session.port_mappings)
                      ).map(([cp, hp]: any) => {
                        const previewUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/preview/${session.id}/${hp}/`;
                        return (
                          <div key={cp} className="flex items-center gap-2">
                            <Badge variant="default">:{cp}</Badge>
                            <a
                              href={previewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-megh-400 hover:text-megh-300 underline truncate"
                            >
                              {previewUrl}
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Usage Stats */}
          {usage && (
            <Card>
              <CardHeader><h3 className="font-semibold text-white">Usage</h3></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Input Tokens</p>
                    <p className="text-gray-200 mt-1">{(usage.total_input_tokens || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Output Tokens</p>
                    <p className="text-gray-200 mt-1">{(usage.total_output_tokens || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Total Cost</p>
                    <p className="text-gray-200 mt-1">{user?.currency === 'INR' ? '\u20B9' : '$'}{((usage.total_cost || 0) / 100).toFixed(4)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Requests</p>
                    <p className="text-gray-200 mt-1">{(usage.request_count || 0).toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            {session.status === 'active' && (
              <Link href={`/terminal/${session.id}`}>
                <Button>Open Terminal</Button>
              </Link>
            )}
            {(session.status === 'active' || session.status === 'grace') && (
              <Button variant="outline" onClick={handleDownload}>Download Files</Button>
            )}
            {(session.status === 'active' || session.status === 'grace') && (
              <Button variant="destructive" onClick={handleEndSession} disabled={ending}>
                {ending ? 'Ending...' : 'End Session'}
              </Button>
            )}
          </div>

          {/* File Upload */}
          {session.status === 'active' && (
            <Card>
              <CardHeader><h3 className="font-semibold text-white">Upload Files</h3></CardHeader>
              <CardContent>
                <FileUpload sessionId={session.id} onUploadComplete={fetchData} />
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
    </UserLayout>
  );
}
