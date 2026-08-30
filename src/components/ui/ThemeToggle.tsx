import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { isDark, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
      title={isDark ? 'Mode terang' : 'Mode gelap'}
      className={`relative w-9 h-9 rounded-xl flex items-center justify-center
        transition-all duration-300
        ${isDark
          ? 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-amber-300'
          : 'bg-slate-200 text-slate-500 hover:bg-slate-300 hover:text-amber-500'
        }
        ${className}`}
    >
      <div className="relative w-5 h-5">
        <Sun
          size={20}
          className={`absolute inset-0 transition-all duration-300
            ${isDark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'}`}
        />
        <Moon
          size={20}
          className={`absolute inset-0 transition-all duration-300
            ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'}`}
        />
      </div>
    </button>
  );
}
