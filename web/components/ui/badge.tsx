const variants = {
  default: 'bg-surface-300 text-gray-300',
  success: 'bg-green-900/50 text-green-400 border-green-800',
  warning: 'bg-yellow-900/50 text-yellow-400 border-yellow-800',
  danger: 'bg-red-900/50 text-red-400 border-red-800',
  info: 'bg-blue-900/50 text-blue-400 border-blue-800',
  purple: 'bg-purple-900/50 text-purple-400 border-purple-800',
} as const;

interface BadgeProps {
  variant?: keyof typeof variants;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
