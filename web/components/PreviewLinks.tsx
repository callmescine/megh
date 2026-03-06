'use client';

interface PreviewLink {
  port: number;
  url: string;
}

interface PreviewLinksProps {
  links: PreviewLink[];
}

export default function PreviewLinks({ links }: PreviewLinksProps) {
  if (!links || links.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap py-2">
      {links.map((link) => (
        <a
          key={link.port}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-900/60 text-blue-400 border border-blue-700 hover:bg-blue-800/60 transition-colors"
        >
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-600 text-white">
            :{link.port}
          </span>
          <span>{link.url}</span>
        </a>
      ))}
    </div>
  );
}
