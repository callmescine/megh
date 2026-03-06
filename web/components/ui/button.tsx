import { ButtonHTMLAttributes, forwardRef } from 'react';

const variants = {
  primary: 'bg-megh-600 text-white hover:bg-megh-500 shadow-sm hover:shadow-glow-sm',
  secondary: 'bg-surface-200 text-gray-200 border border-surface-300 hover:bg-surface-300',
  destructive: 'bg-red-600 text-white hover:bg-red-500',
  ghost: 'text-gray-400 hover:text-white hover:bg-surface-200',
  outline: 'border border-surface-300 text-gray-300 hover:bg-surface-200 hover:text-white',
} as const;

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-sm',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-megh-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
