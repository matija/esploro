import { Sun, Moon, Monitor } from 'lucide-react';
import { useAppStore } from '../../store';
import { cn } from '../../lib/utils';
import type { Theme } from '../../store';

interface ThemeOption {
  value: Theme;
  label: string;
  icon: React.ReactNode;
}

const OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'Tairiki Light', icon: <Sun size={13} /> },
  { value: 'dark',  label: 'Tairiki Dark',  icon: <Moon size={13} /> },
  { value: 'system', label: 'System',       icon: <Monitor size={13} /> },
];

export function AppearanceSettings() {
  const { theme, setTheme } = useAppStore();

  return (
    <section>
      <h3 className="text-[11px] font-medium text-secondary uppercase tracking-[0.06em] mb-3">
        Appearance
      </h3>

      <div className="flex gap-1 p-1 rounded-lg bg-control w-fit">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] transition-colors',
              theme === opt.value
                ? 'bg-content text-label shadow-sm font-medium'
                : 'text-secondary hover:text-label',
            )}
          >
            <span className={theme === opt.value ? 'text-accent' : ''}>{opt.icon}</span>
            {opt.label}
          </button>
        ))}
      </div>
    </section>
  );
}
