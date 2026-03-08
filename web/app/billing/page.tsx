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

const AMOUNT_PRESETS_USD = [5, 10, 25, 50];
const AMOUNT_PRESETS_INR = [500, 1000, 2000, 5000];

function currencySymbol(c: string) {
  return c === 'INR' ? '\u20B9' : '$';
}

export default function BillingPage() {
  const { user, refreshUser } = useAuth();

  const [balanceDisplay, setBalanceDisplay] = useState<number>(0);
  const [monthlyTotalDisplay, setMonthlyTotalDisplay] = useState<number>(0);
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [topupAmount, setTopupAmount] = useState(10);
  const [topping, setTopping] = useState(false);
  const [topupError, setTopupError] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 20;

  // Provider state
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string>(user?.payment_provider || 'stripe');
  const [currency, setCurrency] = useState<string>(user?.currency || 'USD');

  const sym = currencySymbol(currency);
  const amountPresets = currency === 'INR' ? AMOUNT_PRESETS_INR : AMOUNT_PRESETS_USD;

  const fetchData = useCallback(async (pageNum: number) => {
    try {
      const [balanceRes, usageRes] = await Promise.all([
        api.billing.balance(),
        api.billing.usage({
          offset: String(pageNum * pageSize),
          limit: String(pageSize),
        }),
      ]);

      const cur = balanceRes.currency || 'USD';
      setCurrency(cur);
      setBalanceDisplay(balanceRes.balance_display ?? parseFloat(balanceRes.balance_usd ?? '0'));
      setMonthlyTotalDisplay(balanceRes.monthly_total_display ?? balanceRes.monthly_total ?? 0);
      setExchangeRate(balanceRes.exchange_rate ?? 1);

      const records = Array.isArray(usageRes) ? usageRes : (usageRes.events || usageRes.records || []);
      setUsageRecords(records);
      setHasMore(records.length === pageSize);
    } catch (err) {
      console.error('Failed to fetch billing data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch providers on mount
  useEffect(() => {
    async function loadProviders() {
      try {
        const [providersRes, providerRes] = await Promise.all([
          api.billing.providers(),
          api.billing.getProvider(),
        ]);
        setAvailableProviders(providersRes.providers);
        setCurrentProvider(providerRes.provider);
        setCurrency(providerRes.provider === 'razorpay' ? 'INR' : 'USD');
      } catch {
        // Providers endpoint may not be available
      }
    }
    if (user) loadProviders();
  }, [user]);

  useEffect(() => {
    if (user) fetchData(page);
  }, [user, fetchData, page]);

  // Update default topup amount when currency changes
  useEffect(() => {
    setTopupAmount(currency === 'INR' ? 500 : 10);
  }, [currency]);

  const handleProviderChange = async (provider: string) => {
    try {
      await api.billing.setProvider(provider);
      setCurrentProvider(provider);
      const newCurrency = provider === 'razorpay' ? 'INR' : 'USD';
      setCurrency(newCurrency);
      await refreshUser();
      await fetchData(page);
      addToast(`Payment provider set to ${provider === 'razorpay' ? 'Razorpay' : 'Stripe'}`, 'success');
    } catch (err: any) {
      addToast(err.message || 'Failed to change provider', 'error');
    }
  };

  const handleTopup = async () => {
    const min = currency === 'INR' ? 100 : 5;
    const max = currency === 'INR' ? 50000 : 500;
    if (topupAmount < min || topupAmount > max) {
      setTopupError(`Amount must be between ${sym}${min} and ${sym}${max}`);
      return;
    }
    setTopping(true);
    setTopupError('');
    try {
      const res = await api.billing.topup(topupAmount, currency, currentProvider);
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

  const showProviderToggle = availableProviders.length > 1;

  // Convert a USD cost to display currency
  const displayCost = (costUsd: number) => {
    if (currency === 'USD') return costUsd;
    return costUsd * exchangeRate;
  };

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
                    {sym}{(balanceDisplay ?? 0).toFixed(2)}
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    Monthly usage: <span className="text-gray-300">{sym}{(monthlyTotalDisplay ?? 0).toFixed(2)}</span>
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-6 space-y-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Add Funds</p>

                  {/* Provider toggle */}
                  {showProviderToggle && (
                    <div className="flex gap-2">
                      {availableProviders.map((p) => (
                        <button
                          key={p}
                          onClick={() => handleProviderChange(p)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                            currentProvider === p
                              ? 'bg-megh-600 text-white border-megh-500'
                              : 'bg-surface-200 text-gray-400 border-surface-300 hover:bg-surface-300'
                          }`}
                        >
                          {p === 'stripe' ? 'Stripe (USD)' : 'Razorpay (INR)'}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Amount presets */}
                  <div className="flex gap-2">
                    {amountPresets.map((amt) => (
                      <button
                        key={amt}
                        onClick={() => setTopupAmount(amt)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                          topupAmount === amt
                            ? 'bg-megh-600 text-white border-megh-500'
                            : 'bg-surface-200 text-gray-300 border-surface-300 hover:bg-surface-300'
                        }`}
                      >
                        {sym}{amt}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">{sym}</span>
                      <input
                        type="number"
                        min={currency === 'INR' ? 100 : 5}
                        max={currency === 'INR' ? 50000 : 500}
                        value={topupAmount}
                        onChange={(e) => setTopupAmount(Number(e.target.value))}
                        className="w-full pl-7 pr-4 py-2.5 rounded-lg bg-surface-200 border border-surface-300 text-gray-100 focus:outline-none focus:ring-2 focus:ring-megh-500 focus:border-transparent transition-colors"
                      />
                    </div>
                    <Button onClick={handleTopup} disabled={topping}>
                      {topping ? 'Processing...' : 'Top Up'}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    {currency === 'INR'
                      ? `Min ${sym}100, Max ${sym}50,000. Payment via Razorpay.`
                      : `Min ${sym}5, Max ${sym}500. Payment via Stripe.`}
                  </p>
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
                          <TableCell className="text-right text-gray-200 font-medium">
                            {sym}{displayCost(Number(record.cost_usd || 0)).toFixed(4)}
                          </TableCell>
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
