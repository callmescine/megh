'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { MeghLogo } from '@/components/MeghLogo';

function useDetectedCurrency(): { sym: string; price: string } {
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      // If timezone is clearly not Asia/Kolkata (Indian), use USD
      if (tz && !tz.startsWith('Asia/Kolkata') && !tz.startsWith('Asia/Calcutta')) {
        setCurrency('USD');
      }
    } catch {
      // default INR
    }
  }, []);

  return currency === 'INR'
    ? { sym: '\u20B9', price: '49' }
    : { sym: '$', price: '0.49' };
}

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { sym, price } = useDetectedCurrency();

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard');
    }
  }, [user, loading, router]);

  if (loading || user) return null;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="border-b border-surface-300 bg-surface-50/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <MeghLogo size="sm" />
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">
              Sign In
            </Link>
            <Link
              href="/register"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-megh-600 text-white hover:bg-megh-500 shadow-sm hover:shadow-glow-sm active:scale-[0.98] transition-all"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 py-20 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-megh-600/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-3xl text-center space-y-6 relative z-10">
          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight text-white animate-fade-up">
            Cloud AI Agents,{' '}
            <span className="bg-gradient-to-r from-megh-300 to-megh-500 bg-clip-text text-transparent">On Demand</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-xl mx-auto animate-fade-up-delay-1">
            Launch isolated Claude CLI containers in seconds. Full terminal access,
            file management, web previews, and pay-per-use billing.
          </p>
          <div className="flex items-center justify-center gap-4 pt-4 animate-fade-up-delay-2">
            <Link
              href="/register"
              className="px-8 py-3 rounded-lg text-sm font-medium bg-megh-600 text-white hover:bg-megh-500 hover:shadow-glow-sm active:scale-[0.98] transition-all"
            >
              Start Building
            </Link>
            <Link
              href="/login"
              className="px-8 py-3 rounded-lg text-sm font-medium bg-white/5 backdrop-blur-sm text-gray-200 border border-white/10 hover:bg-white/10 transition-all"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-surface-300 bg-surface-50/50 py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-12">Why Megh?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                title: 'Ephemeral Containers',
                desc: 'Each session runs in an isolated Docker container with Claude Code pre-installed. Start, use, and destroy — no residual state.',
              },
              {
                title: 'Full Terminal Access',
                desc: 'WebSocket-powered terminal with resize support, file upload/download, and real-time web preview link detection.',
              },
              {
                title: 'Pay Per Use',
                desc: 'Transparent per-hour or per-session pricing. Monitor usage in real time and top up instantly.',
              },
            ].map((f) => (
              <div key={f.title} className="bg-surface-100 border border-surface-300 rounded-xl p-6 space-y-3 hover:border-megh-500/30 hover:-translate-y-1 hover:shadow-glow-sm transition-all duration-300">
                <h3 className="text-lg font-semibold text-white">{f.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing overview */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h2 className="text-2xl font-bold text-white">Simple Pricing</h2>
          <p className="text-gray-400">
            Pay only for what you use. No subscriptions, no hidden fees.
          </p>
          <div className="inline-block rounded-2xl p-8 shadow-glow-md animate-pulse-glow">
            <div className="inline-flex items-baseline gap-2 text-5xl font-bold bg-gradient-to-r from-megh-300 to-megh-500 bg-clip-text text-transparent">
              {sym}{price}
              <span className="text-lg text-gray-500 font-normal bg-none text-transparent bg-clip-text" style={{ backgroundImage: 'none', color: 'rgb(107 114 128)' }}>/hour</span>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            2 vCPU, 2 GB RAM, full Claude CLI access. Volume pricing available for teams.
          </p>
          <Link
            href="/register"
            className="inline-block mt-4 px-8 py-3 rounded-lg text-sm font-medium bg-megh-600 text-white hover:bg-megh-500 hover:shadow-glow-sm active:scale-[0.98] transition-all"
          >
            Get Started Free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-surface-300 py-8 px-4">
        <div className="max-w-6xl mx-auto flex flex-col items-center gap-3 text-sm text-gray-600">
          <MeghLogo size="sm" className="opacity-60" />
          <span>Self-hosted infrastructure. Your code stays on your servers.</span>
          <span className="text-gray-700 text-xs">Built & maintained by <a href="https://www.linkedin.com/in/nitin-mamidala-891a69299/" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-megh-400 transition-colors">Nitin Mamidala</a></span>
        </div>
      </footer>
    </div>
  );
}
