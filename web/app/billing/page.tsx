'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { UserLayout } from '@/components/layouts/user-layout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeaderCell } from '@/components/ui/table';
import { Spinner } from '@/components/ui/spinner';
import { addToast } from '@/lib/toast';

interface UsageRecord {
  id: string;
  created_at: string;
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

const AMOUNT_PRESETS = [5, 10, 25, 50];

export default function BillingPage() {
  const { user, refreshUser } = useAuth();

  const [balance, setBalance] = useState<number | null>(null);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [totalUsage, setTotalUsage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [topupAmount, setTopupAmount] = useState(10);
  const [topping, setTopping] = useState(false);
  const [topupError, setTopupError] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 20;

  const fetchData = useCallback(async (pageNum: number) => {
    try {
      const [balanceRes, usageRes] = await Promise.all([
        api.billing.balance(),
        api.billing.usage({
          offset: String(pageNum * pageSize),
          limit: String(pageSize),
        }),
      ]);
      setBalance(parseFloat(balanceRes.balance_usd ?? '0'));
      const records = Array.isArray(usageRes) ? usageRes : (usageRes.events || usageRes.records || []);
      setUsageRecords(records);
      setHasMore(records.length === pageSize);
      setTotalUsage(balanceRes.monthly_total ?? 0);
    } catch (err) {
      console.error('Failed to fetch billing data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchData(page);
  }, [user, fetchData, page]);

  const handleTopup = async () => {
    if (topupAmount < 5 || topupAmount > 500) {
      setTopupError('Amount must be between $5 and $500');
      return;
    }
    setTopping(true);
    setTopupError('');
    try {
      const res = await api.billing.topup(topupAmount);
      if (res.checkout_url || res.url) {
        window.location.href = res.checkout_url || res.url;
      } else {
        await refreshUser();
        await fetchData(page);
        addToast('Balance updated', 'success');
      }
    } catch (err: any) {
      setTopupError(err.message || 'Top-up failed');
    } finally {
      setTopping(false);
    }
  };

  const displayBalance = balance !== null ? balance : (user?.balance ?? 0);

  return (
    <UserLayout>
      <div className="space-y-8">
        <h1 className="text-2xl font-bold text-white">Billing</h1>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* Balance & Top-up */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardContent className="py-6">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Current Balance</p>
                  <p className="text-4xl font-bold mt-2 bg-gradient-to-r from-green-400 to-emerald-300 bg-clip-text text-transparent">
                    ${(displayBalance ?? 0).toFixed(2)}
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    Monthly usage: <span className="text-gray-300">${(totalUsage ?? 0).toFixed(2)}</span>
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-6 space-y-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Add Funds</p>

                  {/* Amount presets */}
                  <div className="flex gap-2">
                    {AMOUNT_PRESETS.map((amt) => (
                      <button
                        key={amt}
                        onClick={() => setTopupAmount(amt)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                          topupAmount === amt
                            ? 'bg-megh-600 text-white border-megh-500'
                            : 'bg-surface-200 text-gray-300 border-surface-300 hover:bg-surface-300'
                        }`}
                      >
                        ${amt}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input
                        type="number"
                        min={5}
                        max={500}
                        value={topupAmount}
                        onChange={(e) => setTopupAmount(Number(e.target.value))}
                        className="w-full pl-7 pr-4 py-2.5 rounded-lg bg-surface-200 border border-surface-300 text-gray-100 focus:outline-none focus:ring-2 focus:ring-megh-500 focus:border-transparent transition-colors"
                      />
                    </div>
                    <Button onClick={handleTopup} disabled={topping}>
                      {topping ? 'Processing...' : 'Top Up'}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">Min $5, Max $500. Payment via Stripe.</p>
                  {topupError && <p className="text-sm text-red-400">{topupError}</p>}
                </CardContent>
              </Card>
            </div>

            {/* Usage History */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-white">Usage History</h2>
                  <Link href="/billing/invoices" className="text-sm text-megh-400 hover:text-megh-300 transition-colors">
                    View Invoices &rarr;
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Date</TableHeaderCell>
                      <TableHeaderCell>Session</TableHeaderCell>
                      <TableHeaderCell>Model</TableHeaderCell>
                      <TableHeaderCell className="text-right">Input Tokens</TableHeaderCell>
                      <TableHeaderCell className="text-right">Output Tokens</TableHeaderCell>
                      <TableHeaderCell className="text-right">Cost</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {usageRecords.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                          No usage records yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      usageRecords.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="text-gray-300 whitespace-nowrap">
                            {new Date(record.created_at).toLocaleDateString(undefined, {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </TableCell>
                          <TableCell className="text-gray-400 font-mono">
                            <Link href={`/dashboard/sessions/${record.session_id}`} className="hover:text-megh-400 transition-colors">
                              {record.session_id?.slice(0, 8) || '-'}
                            </Link>
                          </TableCell>
                          <TableCell className="text-gray-400">{record.model || '-'}</TableCell>
                          <TableCell className="text-right text-gray-300">{Number(record.input_tokens || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right text-gray-300">{Number(record.output_tokens || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right text-gray-200 font-medium">${Number(record.cost_usd || 0).toFixed(4)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>

                {(page > 0 || hasMore) && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-surface-300">
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                      Previous
                    </Button>
                    <span className="text-sm text-gray-500">Page {page + 1}</span>
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={!hasMore}>
                      Next
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </UserLayout>
  );
}
