'use client';

import { useState, useEffect } from 'react';
import { adminApi } from '@/lib/admin-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { addToast } from '@/lib/toast';

const defaultSettings = [
  { key: 'domain', label: 'Platform Domain', type: 'text' },
  { key: 'allowed_models', label: 'Allowed Models (comma-separated)', type: 'text' },
  { key: 'container_image', label: 'Container Image', type: 'text' },
  { key: 'container_cpu', label: 'Container CPU Cores', type: 'number' },
  { key: 'container_memory', label: 'Container Memory', type: 'text' },
  { key: 'max_concurrent', label: 'Max Concurrent Sessions', type: 'number' },
];

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    adminApi.settings.list()
      .then((data) => {
        const map: Record<string, any> = {};
        data.settings.forEach((s: any) => { map[s.key] = s.value; });
        setSettings(map);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (key: string) => {
    setSaving(key);
    try {
      await adminApi.settings.update(key, settings[key]);
      addToast(`Setting "${key}" updated`, 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Platform Settings" description="Configure global platform settings" />

      <Card>
        <CardContent className="space-y-6 py-6">
          {defaultSettings.map((s) => (
            <div key={s.key} className="flex items-end gap-3">
              <div className="flex-1">
                <Input
                  label={s.label}
                  type={s.type}
                  value={typeof settings[s.key] === 'object' ? JSON.stringify(settings[s.key]) : (settings[s.key] ?? '')}
                  onChange={(e) => setSettings({ ...settings, [s.key]: e.target.value })}
                />
              </div>
              <Button
                variant="secondary"
                size="md"
                disabled={saving === s.key}
                onClick={() => handleSave(s.key)}
              >
                {saving === s.key ? 'Saving...' : 'Save'}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
