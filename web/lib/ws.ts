'use client';

import { api } from './api';

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

type MessageHandler = (data: any) => void;

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

export class WSManager {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string;
  private reconnectAttempts = 0;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async connect(): Promise<void> {
    try {
      // Fetch one-time WS ticket (1.4)
      const { ticket } = await api.auth.wsTicket(this.sessionId);
      this.ws = new WebSocket(`${getWsUrl()}/ws?session=${this.sessionId}&ticket=${ticket}`);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.reconnectAttempts = 0; // Reset on successful connection (2.5)
        this.emit('open', null);
      };

      this.ws.onclose = (e) => {
        this.emit('close', e);
        if (e.code !== 1000) this.scheduleReconnect();
      };

      this.ws.onerror = (e) => {
        this.emit('error', e);
      };

      this.ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          try {
            const msg = JSON.parse(e.data);
            this.emit(msg.type, msg);
          } catch {
            this.emit('data', e.data);
          }
        } else {
          this.emit('data', e.data);
        }
      };
    } catch (err) {
      this.emit('error', err);
      this.scheduleReconnect();
    }
  }

  send(data: string | ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  sendResize(rows: number, cols: number): void {
    this.send(JSON.stringify({ type: 'resize', rows, cols }));
  }

  on(event: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  private emit(event: string, data: any): void {
    this.handlers.get(event)?.forEach((h) => h(data));
  }

  // Exponential backoff with jitter (2.5)
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emit('max_reconnect', {
        message: 'Connection lost. Please reload the page.',
      });
      return;
    }

    const delay = Math.min(
      BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      MAX_DELAY_MS,
    );
    // Add jitter (0-25% of delay)
    const jitter = Math.random() * delay * 0.25;
    const totalDelay = delay + jitter;

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, totalDelay);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
  }
}
