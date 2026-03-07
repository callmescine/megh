const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('megh_token');
}

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|; )megh_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let refreshPromise: Promise<string> | null = null;

async function refreshToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
  });
  if (!res.ok) throw new Error('Token refresh failed');
  const data = await res.json();
  if (data.token) {
    localStorage.setItem('megh_token', data.token);
  }
  return data.token;
}

async function apiFetch<T>(path: string, opts: RequestInit = {}, retried = false): Promise<T> {
  const token = getToken();
  const csrfToken = getCsrfToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers,
    credentials: 'include',
  });

  // Token refresh on 401 (2.4) — skip for auth endpoints (login/register return 401 for bad credentials)
  const isAuthEndpoint = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register');
  if (res.status === 401 && !retried && !isAuthEndpoint) {
    try {
      if (!refreshPromise) {
        refreshPromise = refreshToken();
      }
      await refreshPromise;
      refreshPromise = null;
      return apiFetch<T>(path, opts, true);
    } catch {
      refreshPromise = null;
      // Redirect to login
      if (typeof window !== 'undefined') {
        localStorage.removeItem('megh_token');
        window.location.href = '/login';
      }
      throw new ApiError(401, 'Session expired');
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || 'Request failed');
  }
  return res.json();
}

async function apiFetchBlob(path: string, opts: RequestInit = {}): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = {
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
    throw new ApiError(res.status, body.error || 'Request failed');
  }
  return res.blob();
}

// Upload with real progress (5.5)
function apiUpload<T>(
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const csrfToken = getCsrfToken();
    const xhr = new XMLHttpRequest();

    xhr.open('POST', `${API_URL}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve({} as T);
        }
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new ApiError(xhr.status, body.error || 'Upload failed'));
        } catch {
          reject(new ApiError(xhr.status, 'Upload failed'));
        }
      }
    };

    xhr.onerror = () => reject(new ApiError(0, 'Network error'));

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });
}

// Upload multiple files with real progress
function apiUploadMultiple<T>(
  path: string,
  files: File[],
  onProgress?: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const csrfToken = getCsrfToken();
    const xhr = new XMLHttpRequest();

    xhr.open('POST', `${API_URL}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve({} as T);
        }
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new ApiError(xhr.status, body.error || 'Upload failed'));
        } catch {
          reject(new ApiError(xhr.status, 'Upload failed'));
        }
      }
    };

    xhr.onerror = () => reject(new ApiError(0, 'Network error'));

    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    xhr.send(formData);
  });
}

export const api = {
  auth: {
    register(email: string, password: string) {
      return apiFetch<{ token: string; user: any }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
    },
    login(email: string, password: string) {
      return apiFetch<{ token: string; user: any }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
    },
    refresh() {
      return apiFetch<{ token: string }>('/api/auth/refresh', {
        method: 'POST',
      });
    },
    logout() {
      return apiFetch<{ message: string }>('/api/auth/logout', {
        method: 'POST',
      });
    },
    me() {
      return apiFetch<{ user: any; billing: any }>('/api/auth/me');
    },
    wsTicket(sessionId: string) {
      return apiFetch<{ ticket: string }>('/api/auth/ws-ticket', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
    },
  },

  sessions: {
    list(params?: { page?: number; limit?: number }) {
      const query = params ? '?' + new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
      ).toString() : '';
      return apiFetch<{ sessions: any[]; total: number; page: number; limit: number } | any[]>(`/api/sessions${query}`);
    },
    create(ttlMinutes?: number) {
      return apiFetch<any>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(ttlMinutes !== undefined ? { ttl_minutes: ttlMinutes } : {}),
      });
    },
    get(id: string) {
      return apiFetch<any>(`/api/sessions/${id}`);
    },
    delete(id: string) {
      return apiFetch<any>(`/api/sessions/${id}`, {
        method: 'DELETE',
      });
    },
    upload(id: string, file: File, onProgress?: (percent: number) => void) {
      return apiUpload<any>(`/api/sessions/${id}/upload`, file, onProgress);
    },
    uploadMedia(id: string, files: File[], onProgress?: (percent: number) => void) {
      return apiUploadMultiple<{ message: string; files: string[] }>(
        `/api/sessions/${id}/upload-media`,
        files,
        onProgress,
      );
    },
    download(id: string) {
      return apiFetchBlob(`/api/sessions/${id}/download`);
    },
  },

  billing: {
    balance() {
      return apiFetch<{ balance_usd: string; monthly_total: number }>('/api/billing/balance');
    },
    usage(params?: Record<string, string>) {
      const query = params ? '?' + new URLSearchParams(params).toString() : '';
      return apiFetch<any>(`/api/billing/usage${query}`);
    },
    sessionUsage(sessionId: string) {
      return apiFetch<any>(`/api/billing/usage/${sessionId}`);
    },
    topup(amount: number) {
      return apiFetch<any>('/api/billing/topup', {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });
    },
    invoices() {
      return apiFetch<any>('/api/billing/invoices');
    },
  },
};

export function isTarFile(name: string): boolean {
  return /\.(tar|tar\.gz|tgz)$/i.test(name);
}

export { ApiError };
