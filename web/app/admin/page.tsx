'use client';

import { useState, useEffect } from 'react';
import { adminApi } from '@/lib/admin-api';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/ui/page-header';
import { Spinner } from '@/components/ui/spinner';

export default function AdminDashboardPage() {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.metrics()
      .then(setMetrics)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Platform metrics at a glance" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={metrics?.total_users ?? 0} />
        <StatCard label="Active Sessions" value={metrics?.active_sessions ?? 0} />
        <StatCard
          label="Revenue Today"
          value={`$${(metrics?.revenue_today ?? 0).toFixed(2)}`}
        />
        <StatCard
          label="Revenue Total"
          value={`$${(metrics?.revenue_total ?? 0).toFixed(2)}`}
        />
      </div>
    </div>
  );
}
