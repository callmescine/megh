'use client';

import { useState, useRef, useEffect } from 'react';

interface PreviewLink {
  port: number;
  url: string;
}

interface PreviewLinksProps {
  links: PreviewLink[];
}

export default function PreviewLinks({ links }: PreviewLinksProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!links || links.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-gray-300 border border-surface-300 hover:bg-surface-200 hover:text-white transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        Preview
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-600 text-white text-[10px] font-bold">
          {links.length}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[240px] rounded-lg border border-surface-300 bg-surface-100 shadow-xl py-1">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Running Ports
          </div>
          {links.map((link) => (
            <a
              key={link.port}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-200 transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-green-900/60 border border-green-700">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-mono text-white">:{link.port}</span>
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
