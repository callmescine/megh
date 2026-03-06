const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('megh_token');
}

async function adminFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || 'Request failed');
  }
  return res.json();
}

export const adminApi = {
  users: {
    list(params?: { page?: number; limit?: number; search?: string }) {
      const query = params
        ? '?' + new URLSearchParams(
            Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
          ).toString()
        : '';
      return adminFetch<{ users: any[]; total: number; page: number; limit: number }>(`/api/admin/users${query}`);
    },
    get(id: string) {
      return adminFetch<{ user: any; sessions: any[] }>(`/api/admin/users/${id}`);
    },
    update(id: string, data: Record<string, any>) {
      return adminFetch<{ message: string }>(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },
  },

  sessions: {
    list(params?: { page?: number; limit?: number; status?: string }) {
      const query = params
        ? '?' + new URLSearchParams(
            Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
          ).toString()
        : '';
      return adminFetch<{ sessions: any[]; total: number; page: number; limit: number }>(`/api/admin/sessions${query}`);
    },
    destroy(id: string) {
      return adminFetch<{ message: string }>(`/api/admin/sessions/${id}`, { method: 'DELETE' });
    },
  },

  metrics() {
    return adminFetch<{
      total_users: number;
      active_sessions: number;
      revenue_today: number;
      revenue_total: number;
    }>('/api/admin/metrics');
  },

  settings: {
    list() {
      return adminFetch<{ settings: any[] }>('/api/admin/settings');
    },
    update(key: string, value: any) {
      return adminFetch<{ message: string }>(`/api/admin/settings/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
    },
  },

  pricing: {
    list() {
      return adminFetch<{ pricing: any[] }>('/api/admin/pricing');
    },
    create(data: Record<string, any>) {
      return adminFetch<any>('/api/admin/pricing', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    update(id: string, data: Record<string, any>) {
      return adminFetch<any>(`/api/admin/pricing/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },
  },

  domains: {
    list() {
      return adminFetch<{ domains: any[] }>('/api/admin/domains');
    },
    add(domain: string) {
      return adminFetch<any>('/api/admin/domains', {
        method: 'POST',
        body: JSON.stringify({ domain }),
      });
    },
    verify(id: string) {
      return adminFetch<any>(`/api/admin/domains/${id}/verify`, { method: 'POST' });
    },
    remove(id: string) {
      return adminFetch<{ message: string }>(`/api/admin/domains/${id}`, { method: 'DELETE' });
    },
    nginxConfig(id: string) {
      return adminFetch<{ domain: string; nginx_config: string }>(`/api/admin/domains/${id}/nginx-config`);
    },
  },

  health() {
    return adminFetch<{ status: string; checks: Record<string, any>; uptime: number }>('/api/admin/health');
  },
};
