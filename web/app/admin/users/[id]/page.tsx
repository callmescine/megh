'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { adminApi } from '@/lib/admin-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { addToast } from '@/lib/toast';

export default function AdminUserDetailPage() {
  const params = useParams();
  const userId = params.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    try {
      const result = await adminApi.users.get(userId);
      setData(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUser(); }, [userId]);

  const handleAction = async (action: Record<string, any>, label: string) => {
    try {
      await adminApi.users.update(userId, action);
      addToast(`User ${label}`, 'success');
      fetchUser();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (!data) return <div className="text-gray-400">User not found</div>;

  const { user, sessions } = data;

  return (
    <div className="space-y-6">
      <PageHeader title={user.email} description={`ID: ${user.id}`} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><h3 className="font-semibold text-white">User Info</h3></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Status</span>
              <Badge variant={user.status === 'active' ? 'success' : 'danger'}>{user.status}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Role</span>
              <Badge variant={user.role === 'admin' ? 'purple' : 'default'}>{user.role}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Tier</span>
              <span className="text-gray-300">{user.tier}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Joined</span>
              <span className="text-gray-300">{new Date(user.created_at).toLocaleDateString()}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold text-white">Billing</h3></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Balance</span>
              <span className="text-green-400 font-medium">${parseFloat(user.balance_usd || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Monthly Usage</span>
              <span className="text-gray-300">${parseFloat(user.current_month_usage || 0).toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold text-white">Actions</h3></CardHeader>
          <CardContent className="space-y-2">
            {user.status === 'active' ? (
              <Button variant="destructive" size="sm" className="w-full" onClick={() => handleAction({ status: 'suspended' }, 'suspended')}>
                Suspend
              </Button>
            ) : (
              <Button variant="primary" size="sm" className="w-full" onClick={() => handleAction({ status: 'active' }, 'activated')}>
                Activate
              </Button>
            )}
            {user.role !== 'admin' ? (
              <Button variant="outline" size="sm" className="w-full" onClick={() => handleAction({ role: 'admin' }, 'promoted to admin')}>
                Promote to Admin
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="w-full" onClick={() => handleAction({ role: 'user' }, 'demoted to user')}>
                Demote to User
              </Button>
            )}
            <Button variant="ghost" size="sm" className="w-full" onClick={() => handleAction({ balance_adjustment: 5 }, 'credited $5')}>
              Add $5 Credit
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h3 className="font-semibold text-white">Recent Sessions ({sessions.length})</h3></CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-gray-500">No sessions</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between text-sm py-2 border-b border-surface-300 last:border-0">
                  <span className="text-gray-400 font-mono text-xs">{s.id.slice(0, 8)}</span>
                  <Badge variant={s.status === 'active' ? 'success' : s.status === 'destroyed' ? 'danger' : 'warning'}>
                    {s.status}
                  </Badge>
                  <span className="text-gray-500">{s.ttl_minutes}m</span>
                  <span className="text-gray-500">{new Date(s.started_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
