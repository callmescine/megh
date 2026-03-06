interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 'w-4 h-4 border',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-2',
};

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <div className={`${sizes[size]} border-megh-400 border-t-transparent rounded-full animate-spin ${className}`} />
  );
}
