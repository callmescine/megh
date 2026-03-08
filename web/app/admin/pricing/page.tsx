'use client';

import { useState, useEffect } from 'react';
import { adminApi } from '@/lib/admin-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { addToast } from '@/lib/toast';

function currencySymbol(c: string) {
  return c === 'INR' ? '\u20B9' : '$';
}

export default function AdminPricingPage() {
  const [configs, setConfigs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    tier: 'default',
    pricing_model: 'per_hour',
    price_per_hour: '0.49',
    price_per_session: '0',
    token_markup_multiplier: '1.0',
    currency: 'USD',
  });

  const fetchPricing = () => {
    adminApi.pricing.list()
      .then((data) => setConfigs(data.pricing))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchPricing(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await adminApi.pricing.create({
        tier: form.tier,
        pricing_model: form.pricing_model,
        price_per_hour: parseFloat(form.price_per_hour),
        price_per_session: parseFloat(form.price_per_session),
        token_markup_multiplier: parseFloat(form.token_markup_multiplier),
        currency: form.currency,
      });
      addToast('Pricing config created', 'success');
      fetchPricing();
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (id: string, active: boolean) => {
    try {
      await adminApi.pricing.update(id, { active: !active });
      addToast(`Pricing ${active ? 'deactivated' : 'activated'}`, 'success');
      fetchPricing();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  // Update default price when currency changes
  const handleCurrencyChange = (newCurrency: string) => {
    setForm({
      ...form,
      currency: newCurrency,
      price_per_hour: newCurrency === 'INR' ? '49' : '0.49',
      price_per_session: newCurrency === 'INR' ? '49' : '0.49',
    });
  };

  const sym = currencySymbol(form.currency);

  return (
    <div className="space-y-6">
      <PageHeader title="Pricing" description="Configure pricing tiers for sessions (per currency)" />

      {/* Create new pricing */}
      <Card>
        <CardHeader><h3 className="font-semibold text-white">New Pricing Tier</h3></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Input label="Tier" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} />
            <Select label="Currency" value={form.currency} onChange={(e) => handleCurrencyChange(e.target.value)}>
              <option value="USD">USD ($)</option>
              <option value="INR">INR ({'\u20B9'})</option>
            </Select>
            <Select label="Pricing Model" value={form.pricing_model} onChange={(e) => setForm({ ...form, pricing_model: e.target.value })}>
              <option value="per_hour">Per Hour</option>
              <option value="per_session">Per Session</option>
              <option value="token_markup">Token Markup</option>
            </Select>
            <Input label={`Price/Hour (${sym})`} type="number" value={form.price_per_hour} onChange={(e) => setForm({ ...form, price_per_hour: e.target.value })} />
            <Input label={`Price/Session (${sym})`} type="number" value={form.price_per_session} onChange={(e) => setForm({ ...form, price_per_session: e.target.value })} />
            <Input label="Token Markup Multiplier" type="number" value={form.token_markup_multiplier} onChange={(e) => setForm({ ...form, token_markup_multiplier: e.target.value })} />
          </div>
          <div className="mt-4">
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating...' : 'Create Pricing Tier'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Existing pricing configs */}
      <div className="space-y-3">
        {configs.map((c) => {
          const cSym = currencySymbol(c.currency || 'USD');
          return (
            <Card key={c.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <Badge variant={c.active ? 'success' : 'default'}>{c.active ? 'Active' : 'Inactive'}</Badge>
                  <span className="font-medium text-white">{c.tier}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-surface-300 text-gray-300">{c.currency || 'USD'}</span>
                  <span className="text-sm text-gray-400">{c.pricing_model}</span>
                </div>
                <div className="flex items-center gap-4">
                  {c.pricing_model === 'per_hour' && (
                    <span className="text-sm text-gray-300">{cSym}{parseFloat(c.price_per_hour).toFixed(2)}/hr</span>
                  )}
                  {c.pricing_model === 'per_session' && (
                    <span className="text-sm text-gray-300">{cSym}{parseFloat(c.price_per_session).toFixed(2)}/session</span>
                  )}
                  {c.pricing_model === 'token_markup' && (
                    <span className="text-sm text-gray-300">{c.token_markup_multiplier}x markup</span>
                  )}
                  <Button variant="outline" size="sm" onClick={() => toggleActive(c.id, c.active)}>
                    {c.active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
