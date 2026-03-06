'use client';

import { useState, useEffect } from 'react';
import { adminApi } from '@/lib/admin-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function AdminHealthPage() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHealth = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const data = await adminApi.health();
      setHealth(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchHealth(); }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (!health) return <div className="text-gray-400">Failed to load health data</div>;

  const checks = health.checks || {};
  const services = [
    { key: 'postgres', label: 'PostgreSQL', icon: '🗄️' },
    { key: 'redis', label: 'Redis', icon: '⚡' },
    { key: 'docker', label: 'Docker', icon: '🐳' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Health"
        description="Monitor platform service status"
        actions={
          <Button variant="outline" size="sm" onClick={() => fetchHealth(true)} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        }
      />

      {/* Overall status */}
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <span className="text-gray-400 text-sm">Overall Status</span>
            <Badge variant={health.status === 'healthy' ? 'success' : 'danger'}>
              {health.status}
            </Badge>
          </div>
          <div className="text-sm text-gray-400">
            Uptime: <span className="text-white font-medium">{formatUptime(health.uptime)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Individual service checks */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {services.map(({ key, label, icon }) => {
          const check = checks[key];
          const isHealthy = check?.status === 'ok' || check?.status === 'healthy' || check?.connected === true;

          return (
            <Card key={key}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <span>{icon}</span> {label}
                  </h3>
                  <Badge variant={isHealthy ? 'success' : 'danger'}>
                    {isHealthy ? 'Healthy' : 'Unhealthy'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {check ? (
                  Object.entries(check).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-gray-400">{k.replace(/_/g, ' ')}</span>
                      <span className="text-gray-300 font-mono text-xs">
                        {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-gray-500">No data available</span>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
