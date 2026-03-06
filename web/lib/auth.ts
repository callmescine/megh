'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import React from 'react';
import { api } from './api';

interface User {
  id: string;
  email: string;
  tier: string;
  status: string;
  role: string;
  balance: number;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.auth.me();
      setUser({
        id: data.user.id,
        email: data.user.email,
        tier: data.user.tier,
        status: data.user.status,
        role: data.user.role || 'user',
        balance: parseFloat(data.billing?.balance_usd ?? '0') || 0,
      });
    } catch {
      setUser(null);
      localStorage.removeItem('megh_token');
    }
  }, []);

  // Proactive token refresh every 20 minutes (2.4)
  const startRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(async () => {
      try {
        const res = await api.auth.refresh();
        if (res.token) {
          localStorage.setItem('megh_token', res.token);
        }
      } catch {
        // Token expired, will redirect on next API call
      }
    }, 20 * 60 * 1000); // 20 minutes
  }, []);

  const stopRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('megh_token');
    if (token) {
      refreshUser().finally(() => setLoading(false));
      startRefreshTimer();
    } else {
      setLoading(false);
    }
    return () => stopRefreshTimer();
  }, [refreshUser, startRefreshTimer, stopRefreshTimer]);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const res = await api.auth.login(email, password);
    // Still store token in localStorage for backward compat (cookie is also set)
    if (res.token) localStorage.setItem('megh_token', res.token);
    const u: User = {
      id: res.user.id,
      email: res.user.email,
      tier: res.user.tier,
      status: res.user.status,
      role: res.user.role || 'user',
      balance: Number(res.user.balance) || 0,
    };
    setUser(u);
    refreshUser();
    startRefreshTimer();
    return u;
  }, [refreshUser, startRefreshTimer]);

  const register = useCallback(async (email: string, password: string) => {
    const res = await api.auth.register(email, password);
    if (res.token) localStorage.setItem('megh_token', res.token);
    setUser({ ...res.user, balance: res.user.balance ?? 0 });
    refreshUser();
    startRefreshTimer();
  }, [refreshUser, startRefreshTimer]);

  const logout = useCallback(async () => {
    stopRefreshTimer();
    try {
      await api.auth.logout();
    } catch {
      // Best effort
    }
    localStorage.removeItem('megh_token');
    setUser(null);
    window.location.href = '/login';
  }, [stopRefreshTimer]);

  return React.createElement(
    AuthContext.Provider,
    { value: { user, loading, login, register, logout, refreshUser } },
    children
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
