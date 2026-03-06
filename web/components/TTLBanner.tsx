'use client';

import { useState, useEffect } from 'react';

interface TTLBannerProps {
  expiresAt: string;
  onExtend?: () => void;
}

export default function TTLBanner({ expiresAt, onExtend }: TTLBannerProps) {
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const expires = new Date(expiresAt).getTime();
      const diff = Math.max(0, Math.floor((expires - now) / 1000));
      setRemaining(diff);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const formatTime = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    return `${minutes}:${pad(seconds)}`;
  };

  const totalMinutes = remaining / 60;

  let colorClasses: string;
  if (remaining <= 0 || totalMinutes <= 5) {
    colorClasses = 'bg-red-900/80 text-red-300 border-b border-red-800';
  } else if (totalMinutes <= 10) {
    colorClasses = 'bg-amber-900/80 text-amber-300 border-b border-amber-800';
  } else {
    colorClasses = 'bg-blue-900/60 text-blue-300 border-b border-blue-800';
  }

  return (
    <div className={`flex items-center justify-between px-4 py-2 text-[13px] ${colorClasses}`}>
      <span>
        {remaining <= 0
          ? 'Session expired'
          : `Session expires in ${formatTime(remaining)}`}
      </span>

      {onExtend && remaining > 0 && (
        <button
          onClick={onExtend}
          className="px-2.5 py-1 rounded text-xs font-medium bg-white/15 border border-current hover:bg-white/25 transition-colors"
        >
          Extend
        </button>
      )}
    </div>
  );
}
