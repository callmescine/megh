'use client';

import { useEffect, useState } from 'react';
import { subscribeToasts, removeToast, type Toast } from '@/lib/toast';

const typeStyles: Record<string, string> = {
  success: 'bg-emerald-900/90 border-emerald-700 text-emerald-200',
  error: 'bg-red-900/90 border-red-700 text-red-200',
  info: 'bg-blue-900/90 border-blue-700 text-blue-200',
  warning: 'bg-amber-900/90 border-amber-700 text-amber-200',
};

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return subscribeToasts(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-4 py-3 rounded-lg border text-sm shadow-lg flex items-center justify-between gap-3 animate-in slide-in-from-right ${typeStyles[toast.type] || typeStyles.info}`}
        >
          <span>{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-current opacity-60 hover:opacity-100 transition-opacity text-lg leading-none"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
