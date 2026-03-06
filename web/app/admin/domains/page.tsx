'use client';

import { useState, useEffect } from 'react';
import { adminApi } from '@/lib/admin-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { addToast } from '@/lib/toast';

export default function AdminDomainsPage() {
  const [domains, setDomains] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);

  const fetchDomains = () => {
    adminApi.domains.list()
      .then((data) => setDomains(data.domains))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchDomains(); }, []);

  const handleAdd = async () => {
    if (!newDomain.trim()) return;
    setAdding(true);
    try {
      await adminApi.domains.add(newDomain.trim());
      addToast('Domain added', 'success');
      setNewDomain('');
      fetchDomains();
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleVerify = async (id: string) => {
    setVerifying(id);
    try {
      await adminApi.domains.verify(id);
      addToast('Domain verified!', 'success');
      fetchDomains();
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setVerifying(null);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remove this domain?')) return;
    try {
      await adminApi.domains.remove(id);
      addToast('Domain removed', 'success');
      fetchDomains();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const statusVariant = (status: string) => {
    const map: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
      active: 'success',
      verifying: 'warning',
      pending: 'info',
      failed: 'danger',
    };
    return map[status] || 'default';
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Custom Domains" description="Connect your own domain to the platform" />

      {/* Add domain */}
      <Card>
        <CardHeader><h3 className="font-semibold text-white">Add Domain</h3></CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Input
                label="Domain"
                placeholder="app.example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
              />
            </div>
            <Button onClick={handleAdd} disabled={adding || !newDomain.trim()}>
              {adding ? 'Adding...' : 'Add Domain'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Domain list */}
      <div className="space-y-4">
        {domains.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-gray-500">
              No custom domains configured
            </CardContent>
          </Card>
        ) : (
          domains.map((d) => (
            <Card key={d.id}>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                    <span className="font-medium text-white">{d.domain}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.status === 'pending' && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleVerify(d.id)}
                        disabled={verifying === d.id}
                      >
                        {verifying === d.id ? 'Verifying...' : 'Verify'}
                      </Button>
                    )}
                    <Button variant="destructive" size="sm" onClick={() => handleRemove(d.id)}>
                      Remove
                    </Button>
                  </div>
                </div>

                {d.status === 'pending' && d.verification_token && (
                  <div className="bg-surface-200 rounded-lg p-4 text-sm space-y-2">
                    <p className="text-gray-300 font-medium">DNS Verification Required</p>
                    <p className="text-gray-400">
                      Add a TXT record to your DNS configuration:
                    </p>
                    <div className="bg-surface-300 rounded p-3 font-mono text-xs">
                      <div className="text-gray-400">Host/Name:</div>
                      <div className="text-megh-400 mb-2">_megh-verify.{d.domain}</div>
                      <div className="text-gray-400">Value:</div>
                      <div className="text-megh-400">{d.verification_token}</div>
                    </div>
                    <p className="text-gray-500 text-xs">
                      DNS changes can take up to 48 hours to propagate. Click &quot;Verify&quot; once the record is live.
                    </p>
                  </div>
                )}

                {d.status === 'active' && (
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {d.ssl_status && (
                        <>
                          <span className="text-gray-400">SSL:</span>
                          <Badge variant={d.ssl_status === 'active' ? 'success' : 'warning'}>
                            {d.ssl_status}
                          </Badge>
                        </>
                      )}
                      {d.verified_at && (
                        <>
                          <span className="text-gray-600">|</span>
                          <span className="text-gray-500">
                            Verified {new Date(d.verified_at).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          const data = await adminApi.domains.nginxConfig(d.id);
                          const blob = new Blob([data.nginx_config], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${d.domain}.nginx.conf`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        } catch (err: any) {
                          addToast(err.message, 'error');
                        }
                      }}
                    >
                      Download Nginx Config
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
