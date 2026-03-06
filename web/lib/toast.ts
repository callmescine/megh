'use client';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

type ToastListener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let listeners: Set<ToastListener> = new Set();
let nextId = 0;

function notify() {
  listeners.forEach((l) => l([...toasts]));
}

export function addToast(message: string, type: ToastType = 'info'): void {
  const id = String(++nextId);
  toasts = [...toasts, { id, message, type }];
  notify();

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    removeToast(id);
  }, 5000);
}

export function removeToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}

export type { Toast, ToastType };
