'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminApi } from '@/lib/admin-api';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeaderCell } from '@/components/ui/table';
import { Spinner } from '@/components/ui/spinner';
import { addToast } from '@/lib/toast';

export default function AdminSessionsPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.sessions.list({ page, status: statusFilter || undefined });
      setSessions(data.sessions);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const handleDestroy = async (id: string) => {
    if (!confirm('Destroy this session?')) return;
    try {
      await adminApi.sessions.destroy(id);
      addToast('Session destroyed', 'success');
      fetchSessions();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-6">
      <PageHeader title="Sessions" description={`${total} total sessions`} />

      <div className="max-w-xs">
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="grace">Grace</option>
          <option value="destroyed">Destroyed</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>ID</TableHeaderCell>
              <TableHeaderCell>User</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>TTL</TableHeaderCell>
              <TableHeaderCell>Started</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.id.slice(0, 8)}</TableCell>
                <TableCell>{s.user_email}</TableCell>
                <TableCell>
                  <Badge variant={s.status === 'active' ? 'success' : s.status === 'grace' ? 'warning' : 'danger'}>
                    {s.status}
                  </Badge>
                </TableCell>
                <TableCell>{s.ttl_minutes}m</TableCell>
                <TableCell className="text-gray-500">{new Date(s.started_at).toLocaleString()}</TableCell>
                <TableCell>
                  {(s.status === 'active' || s.status === 'grace') && (
                    <Button variant="destructive" size="sm" onClick={() => handleDestroy(s.id)}>
                      Destroy
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}
    </div>
  );
}
