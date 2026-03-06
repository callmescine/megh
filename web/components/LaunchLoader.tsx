'use client';

import { useEffect, useState } from 'react';
import { MeghLogo } from '@/components/MeghLogo';

const STEPS = [
  'Allocating resources...',
  'Provisioning container...',
  'Installing Claude CLI...',
  'Configuring network...',
  'Starting terminal...',
];

export function LaunchLoader() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-surface-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 animate-fade-up">
        {/* Animated logo */}
        <div className="relative">
          <div className="absolute inset-0 bg-megh-500/20 rounded-full blur-[40px] animate-pulse-glow" />
          <MeghLogo size="xl" showText={false} className="relative z-10" />
        </div>

        {/* Progress steps */}
        <div className="flex flex-col items-center gap-4">
          <p className="text-lg font-medium text-white animate-fade-up-delay-1">
            Launching Session
          </p>

          <div className="flex flex-col items-center gap-2 min-h-[80px]">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className={`flex items-center gap-2 text-sm transition-all duration-300 ${
                  i < step ? 'text-megh-400' : i === step ? 'text-gray-200' : 'text-gray-600'
                }`}
                style={{ opacity: i <= step ? 1 : 0, transform: i <= step ? 'translateY(0)' : 'translateY(8px)', transition: 'all 0.3s ease-out' }}
              >
                {i < step ? (
                  <svg className="w-4 h-4 text-megh-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : i === step ? (
                  <svg className="w-4 h-4 animate-spin text-megh-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <div className="w-4 h-4" />
                )}
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Shimmer bar */}
        <div className="w-48 h-1 bg-surface-200 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-megh-500 to-megh-300 rounded-full animate-shimmer bg-[length:200%_100%]" />
        </div>
      </div>
    </div>
  );
}
