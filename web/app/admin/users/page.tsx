'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { adminApi } from '@/lib/admin-api';
import { PageHeader } from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeaderCell } from '@/components/ui/table';
import { Spinner } from '@/components/ui/spinner';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.users.list({ page, search: search || undefined });
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const statusBadge = (status: string) => {
    const map: Record<string, 'success' | 'warning' | 'danger'> = {
      active: 'success', suspended: 'warning', banned: 'danger',
    };
    return <Badge variant={map[status] || 'default'}>{status}</Badge>;
  };

  const roleBadge = (role: string) => (
    <Badge variant={role === 'admin' ? 'purple' : 'default'}>{role}</Badge>
  );

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-6">
      <PageHeader title="Users" description={`${total} total users`} />

      <div className="max-w-sm">
        <Input
          placeholder="Search by email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Email</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Tier</TableHeaderCell>
              <TableHeaderCell>Balance</TableHeaderCell>
              <TableHeaderCell>Joined</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <Link href={`/admin/users/${user.id}`} className="text-megh-400 hover:underline">
                    {user.email}
                  </Link>
                </TableCell>
                <TableCell>{statusBadge(user.status)}</TableCell>
                <TableCell>{roleBadge(user.role)}</TableCell>
                <TableCell className="text-gray-400">{user.tier}</TableCell>
                <TableCell className="text-green-400">${parseFloat(user.balance_usd || 0).toFixed(2)}</TableCell>
                <TableCell className="text-gray-500">{new Date(user.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
            Previous
          </Button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
