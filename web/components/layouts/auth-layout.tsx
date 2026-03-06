import Link from 'next/link';
import { MeghLogo } from '@/components/MeghLogo';

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-megh-600/8 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center">
          <Link href="/">
            <MeghLogo size="lg" className="justify-center" />
          </Link>
        </div>
        <div className="bg-surface-50/80 backdrop-blur-xl border border-surface-300 rounded-2xl p-8 shadow-elevated animate-scale-in">
          {children}
        </div>
      </div>
    </div>
  );
}
