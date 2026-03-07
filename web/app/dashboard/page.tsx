'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api, isTarFile } from '@/lib/api';
import { addToast } from '@/lib/toast';
import { UserLayout } from '@/components/layouts/user-layout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import SessionCard from '@/components/SessionCard';
import { DashboardSkeleton } from '@/components/Skeleton';
import { LaunchLoader } from '@/components/LaunchLoader';

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [ttl, setTtl] = useState(60);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [preloadFiles, setPreloadFiles] = useState<File[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [pastPage, setPastPage] = useState(1);
  const [estimatedCost, setEstimatedCost] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PAST_PAGE_SIZE = 10;

  const fetchSessions = useCallback(async () => {
    try {
      const data = await api.sessions.list();
      const sessionList = Array.isArray(data) ? data : data.sessions || [];
      setSessions(sessionList);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const fetchPricing = useCallback(async (ttlMinutes: number) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/api/sessions/pricing?ttl_minutes=${ttlMinutes}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('megh_token')}`,
          },
        },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.estimated_cost > 0) {
          setEstimatedCost(`$${data.estimated_cost.toFixed(2)}`);
        } else {
          setEstimatedCost(null);
        }
      }
    } catch {
      setEstimatedCost(null);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      fetchSessions();
      fetchPricing(ttl);
      pollRef.current = setInterval(fetchSessions, 10_000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [user, authLoading, router, fetchSessions, fetchPricing, ttl]);

  useEffect(() => {
    fetchPricing(ttl);
  }, [ttl, fetchPricing]);

  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchError('');

    try {
      const session = await api.sessions.create(ttl);

      if (preloadFiles.length > 0) {
        try {
          // If single tar file, use the tar upload endpoint
          const isTar = preloadFiles.length === 1 && isTarFile(preloadFiles[0].name);
          if (isTar) {
            await api.sessions.upload(session.id, preloadFiles[0]);
          } else {
            await api.sessions.uploadMedia(session.id, preloadFiles);
          }
          addToast('Session launched with files uploaded', 'success');
        } catch {
          addToast('Session launched but file upload failed', 'warning');
        }
      } else {
        addToast('Session launched successfully', 'success');
      }

      router.push(`/terminal/${session.id}`);
    } catch (err: any) {
      setLaunchError(err.message || 'Failed to launch session');
      addToast(err.message || 'Failed to launch session', 'error');
    } finally {
      setLaunching(false);
    }
  };

  if (authLoading || !user) return null;

  if (launching) return <LaunchLoader />;

  const activeSessions = sessions.filter((s) => s.status === 'active' || s.status === 'grace');
  const allPastSessions = sessions.filter((s) => s.status !== 'active' && s.status !== 'grace');
  const totalPastPages = Math.ceil(allPastSessions.length / PAST_PAGE_SIZE);
  const pastSessions = allPastSessions.slice((pastPage - 1) * PAST_PAGE_SIZE, pastPage * PAST_PAGE_SIZE);
  const secondsAgo = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);

  return (
    <UserLayout>
      <div className="space-y-8">
        <PageHeader
          title="Welcome back"
          description={`Balance: $${(user.balance ?? 0).toFixed(2)}`}
        />

        {/* New Session */}
        <div className="bg-gradient-to-r from-megh-500 to-megh-400 p-[1px] rounded-xl">
        <Card className="!border-0 !rounded-xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">New Session</h2>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Badge variant="info">2 vCPU</Badge>
                <Badge variant="info">2 GB RAM</Badge>
                <Badge variant="info">megh-agent</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Select
                  label="Session TTL"
                  value={ttl}
                  onChange={(e) => setTtl(Number(e.target.value))}
                >
                  <option value={30}>30 minutes</option>
                  <option value={60}>60 minutes</option>
                  <option value={120}>2 hours</option>
                  <option value={240}>4 hours</option>
                  <option value={480}>8 hours</option>
                </Select>
                {estimatedCost && (
                  <p className="text-xs text-gray-400">
                    Estimated cost: <span className="text-megh-400 font-medium">{estimatedCost}</span>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">
                  Pre-load files (optional)
                </label>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    preloadFiles.length > 0
                      ? 'border-green-600 bg-green-900/10'
                      : 'border-surface-300 hover:border-surface-500'
                  }`}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.multiple = true;
                    input.onchange = (e) => {
                      const fileList = (e.target as HTMLInputElement).files;
                      if (fileList && fileList.length > 0) {
                        const selected = Array.from(fileList);
                        setPreloadFiles((prev) => [...prev, ...selected]);
                        const label = selected.length === 1 ? selected[0].name : `${selected.length} files`;
                        addToast(`Selected: ${label}`, 'info');
                      }
                    };
                    input.click();
                  }}
                >
                  {preloadFiles.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {preloadFiles.map((f, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-xs bg-surface-200 text-green-400 rounded px-2 py-1">
                            {f.name}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreloadFiles((prev) => prev.filter((_, j) => j !== i));
                              }}
                              className="text-gray-500 hover:text-red-400 transition-colors ml-1"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPreloadFiles([]); }}
                        className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                      >
                        Clear all
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-400">Click to select files</p>
                      <p className="text-xs text-gray-600 mt-1">Any file type — images, code, archives, etc.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {launchError && (
              <div className="mt-4 p-3 rounded-lg bg-red-900/50 border border-red-800 text-red-300 text-sm">
                {launchError}
              </div>
            )}

            <div className="mt-4">
              <Button onClick={handleLaunch} disabled={launching} size="lg">
                {launching ? 'Launching...' : 'Launch Session'}
              </Button>
            </div>
          </CardContent>
        </Card>
        </div>

        {/* Active Sessions */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Active Sessions
              {activeSessions.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-400">({activeSessions.length})</span>
              )}
            </h2>
            <span className="text-xs text-gray-600">
              Updated {secondsAgo < 5 ? 'just now' : `${secondsAgo}s ago`}
            </span>
          </div>

          {sessionsLoading ? (
            <DashboardSkeleton />
          ) : activeSessions.length === 0 ? (
            <EmptyState title="No active sessions" description="Launch one above to get started." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeSessions.map((session) => (
                <SessionCard key={session.id} session={session} onSessionUpdate={fetchSessions} />
              ))}
            </div>
          )}
        </div>

        {/* Past Sessions */}
        {allPastSessions.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-400">
              Past Sessions <span className="text-sm font-normal">({allPastSessions.length})</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pastSessions.map((session) => (
                <SessionCard key={session.id} session={session} onSessionUpdate={fetchSessions} />
              ))}
            </div>

            {totalPastPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPastPage((p) => Math.max(1, p - 1))}
                  disabled={pastPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-500">
                  Page {pastPage} of {totalPastPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPastPage((p) => Math.min(totalPastPages, p + 1))}
                  disabled={pastPage === totalPastPages}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </UserLayout>
  );
}
