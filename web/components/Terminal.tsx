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
}

export interface TerminalHandle {
  focus: () => void;
  fit: () => void;
}

const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  ({ sessionId, onPreviewUrl }, ref) => {
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
          fontSize: 14,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: '#1a1b26',
            foreground: '#a9b1d6',
            cursor: '#c0caf5',
            selectionBackground: '#33467c',
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
    }, [sessionId, onPreviewUrl]);

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
          className="w-full h-full min-h-[400px] bg-[#1a1b26]"
        />
      </div>
    );
  }
);

Terminal.displayName = 'Terminal';

export default Terminal;
