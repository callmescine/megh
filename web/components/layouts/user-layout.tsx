'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui/spinner';
import { MeghLogo } from '@/components/MeghLogo';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/billing', label: 'Billing' },
];

export function UserLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen">
      <nav className="border-b border-surface-300 bg-surface-50/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard">
              <MeghLogo size="sm" />
            </Link>
            <div className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative px-3 py-1.5 rounded-md text-sm transition-colors ${
                    pathname === item.href || pathname?.startsWith(item.href + '/')
                      ? 'text-white bg-surface-200'
                      : 'text-gray-400 hover:text-white hover:bg-surface-200'
                  }`}
                >
                  {item.label}
                  {(pathname === item.href || pathname?.startsWith(item.href + '/')) && (
                    <span className="absolute -bottom-[9px] left-1/2 -translate-x-1/2 w-4/5 h-0.5 bg-megh-500 rounded-full" />
                  )}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-gray-400">{user.email}</span>
            <span className="text-sm font-medium text-green-400">
              ${(user.balance ?? 0).toFixed(2)}
            </span>
            <button
              onClick={logout}
              className="text-sm text-gray-400 hover:text-red-400 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
