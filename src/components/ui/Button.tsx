import { type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth,
  className = '',
  children,
  disabled,
  ...props
}: ButtonProps) {
  const base =
    variant === 'primary' ? 'btn-primary' :
    variant === 'ghost' ? 'btn-ghost' :
    variant === 'outline' ? 'btn-outline' :
    variant === 'danger' ? 'btn-danger' :
    'btn bg-white/5 text-slate-200 hover:bg-white/10';

  const sizes = {
    sm: 'text-xs px-3 py-2',
    md: 'text-sm px-4 py-2.5',
    lg: 'text-base px-5 py-3',
  };

  return (
    <button
      className={`${base} ${sizes[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : icon}
      {children}
    </button>
  );
}
