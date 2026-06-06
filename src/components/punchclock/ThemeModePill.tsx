import { Moon, Sun } from 'lucide-react';

interface ThemeModePillProps {
  isDayMode: boolean;
  onChange: (next: boolean) => void;
}

export function ThemeModePill({ isDayMode, onChange }: ThemeModePillProps) {
  return (
    <div
      className={`inline-flex items-center rounded-full border p-0.5 backdrop-blur-sm ${
        isDayMode
          ? 'border-slate-200 bg-slate-100/90'
          : 'border-white/10 bg-white/5'
      }`}
    >
      <button
        type="button"
        onClick={() => onChange(true)}
        aria-pressed={isDayMode}
        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition-all ${
          isDayMode ? 'bg-amber-500 text-amber-950' : 'text-slate-400 hover:text-white'
        }`}
      >
        <Sun className="h-3 w-3" />
        Light
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        aria-pressed={!isDayMode}
        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition-all ${
          !isDayMode ? 'bg-amber-500 text-amber-950' : 'text-slate-400 hover:text-white'
        }`}
      >
        <Moon className="h-3 w-3" />
        Dark
      </button>
    </div>
  );
}