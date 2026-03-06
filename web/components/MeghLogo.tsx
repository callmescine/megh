interface MeghLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

const sizeMap = { sm: 20, md: 28, lg: 36, xl: 48 };

export function MeghLogo({ size = 'md', showText = true, className = '' }: MeghLogoProps) {
  const s = sizeMap[size];
  const textSize = size === 'sm' ? 'text-sm' : size === 'md' ? 'text-lg' : size === 'lg' ? 'text-2xl' : 'text-3xl';

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width={s} height={s} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="megh-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a5b4fc" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        {/* Cloud shape: 3 overlapping circles + flat base */}
        <ellipse cx="24" cy="28" rx="18" ry="10" fill="url(#megh-grad)" />
        <circle cx="16" cy="22" r="10" fill="url(#megh-grad)" />
        <circle cx="28" cy="18" r="12" fill="url(#megh-grad)" />
        <circle cx="36" cy="24" r="8" fill="url(#megh-grad)" />
        {/* Inner highlight for depth */}
        <ellipse cx="26" cy="20" rx="10" ry="7" fill="white" fillOpacity="0.15" />
      </svg>
      {showText && (
        <span className={`font-bold text-white tracking-tight ${textSize}`}>Megh</span>
      )}
    </span>
  );
}
