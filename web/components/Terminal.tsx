'use client';

import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react';
import type { Terminal as XTerminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { WebLinksAddon } from '@xterm/addon-web-links';
import { WSManager } from '@/lib/ws';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  sessionId: string;
  onPreviewUrl?: (url: string, port: number) => void;
  onPreviewClose?: (port: number) => void;
}

export interface TerminalHandle {
  focus: () => void;
  fit: () => void;
}

const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  ({ sessionId, onPreviewUrl, onPreviewClose }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XTerminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [connectionLost, setConnectionLost] = useState(false);

    useImperativeHandle(ref, () => ({
      focus: () => termRef.current?.focus(),
      fit: () => fitAddonRef.current?.fit(),
    }));

    useEffect(() => {
      let term: XTerminal;
      let fitAddon: FitAddon;
      let webLinksAddon: WebLinksAddon;
      let ws: WSManager;
      let disposed = false;

      async function init() {
        const { Terminal: XTerm } = await import('@xterm/xterm');
        const { FitAddon: FitAddonClass } = await import('@xterm/addon-fit');
        const { WebLinksAddon: WebLinksAddonClass } = await import('@xterm/addon-web-links');

        if (disposed || !containerRef.current) return;

        term = new XTerm({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
          lineHeight: 1.2,
          theme: {
            background: '#1c1c1e',
            foreground: '#e5e5e7',
            cursor: '#e5e5e7',
            cursorAccent: '#1c1c1e',
            selectionBackground: '#3a3a3c',
            selectionForeground: '#ffffff',
            black: '#1c1c1e',
            red: '#ff453a',
            green: '#30d158',
            yellow: '#ffd60a',
            blue: '#0a84ff',
            magenta: '#bf5af2',
            cyan: '#64d2ff',
            white: '#e5e5e7',
            brightBlack: '#636366',
            brightRed: '#ff6961',
            brightGreen: '#4cd964',
            brightYellow: '#ffe620',
            brightBlue: '#409cff',
            brightMagenta: '#da8aff',
            brightCyan: '#70d7ff',
            brightWhite: '#ffffff',
          },
        });
        termRef.current = term;

        fitAddon = new FitAddonClass();
        fitAddonRef.current = fitAddon;
        term.loadAddon(fitAddon);

        webLinksAddon = new WebLinksAddonClass();
        term.loadAddon(webLinksAddon);

        term.open(containerRef.current);
        fitAddon.fit();

        ws = new WSManager(sessionId);

        term.onData((data: string) => {
          ws.send(data);
        });

        term.onBinary((data: string) => {
          const buffer = new Uint8Array(data.length);
          for (let i = 0; i < data.length; i++) {
            buffer[i] = data.charCodeAt(i) & 0xff;
          }
          ws.send(buffer.buffer);
        });

        ws.on('data', (data: any) => {
          if (typeof data === 'string') {
            term.write(data);
          } else if (data instanceof ArrayBuffer) {
            term.write(new Uint8Array(data));
          }
        });

        ws.on('preview', (msg: any) => {
          if (onPreviewUrl && msg.url && msg.port) {
            onPreviewUrl(msg.url, msg.port);
          }
        });

        ws.on('preview_close', (msg: any) => {
          if (onPreviewClose && msg.port) {
            onPreviewClose(msg.port);
          }
        });

        ws.on('open', () => {
          setConnectionLost(false);
          ws.sendResize(term.rows, term.cols);
        });

        ws.on('max_reconnect', () => {
          setConnectionLost(true);
        });

        ws.connect();

        const handleResize = () => {
          if (!disposed) {
            fitAddon.fit();
            ws.sendResize(term.rows, term.cols);
          }
        };

        term.onResize(({ rows, cols }) => {
          ws.sendResize(rows, cols);
        });

        window.addEventListener('resize', handleResize);

        (init as any)._cleanup = () => {
          window.removeEventListener('resize', handleResize);
        };
      }

      init();

      return () => {
        disposed = true;
        if ((init as any)._cleanup) (init as any)._cleanup();
        ws?.disconnect();
        term?.dispose();
      };
    }, [sessionId, onPreviewUrl, onPreviewClose]);

    return (
      <div className="w-full h-full relative">
        {connectionLost && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
            <div className="text-center">
              <p className="text-red-400 text-base mb-3">
                Connection lost. Please reload the page.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg bg-megh-600 text-white text-sm hover:bg-megh-500 transition-colors"
              >
                Reload
              </button>
            </div>
          </div>
        )}
        <div
          ref={containerRef}
          className="w-full h-full min-h-[400px] bg-[#1c1c1e]"
        />
      </div>
    );
  }
);

Terminal.displayName = 'Terminal';

export default Terminal;
