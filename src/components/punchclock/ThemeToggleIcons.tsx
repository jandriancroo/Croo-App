import type { SyntheticEvent, TouchEvent } from 'react';
import { Sun, Moon } from 'lucide-react';

interface ThemeToggleIconsProps {
  isDayMode: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}

/**
 * Shared light/dark toggle — two icons floating in the bottom-right
 * of the screen. Used on both the PunchClock keypad and the Manager
 * Dashboard so theme switching lives in a consistent spot.
 */
export function ThemeToggleIcons({ isDayMode, onChange, className = '' }: ThemeToggleIconsProps) {
  const baseBtn =
    'flex h-9 w-9 items-center justify-center rounded-full transition-all cursor-pointer';
  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
  };
  const stopTouch = (e: TouchEvent) => {
    e.stopPropagation();
  };
  return (
    <div
      onPointerDown={stop}
      onClick={stop}
      onTouchStart={stopTouch}
      onTouchEnd={stopTouch}
      className={`fixed bottom-4 right-4 z-[300] flex items-center gap-1 rounded-full p-1 backdrop-blur pointer-events-auto ${
        isDayMode
          ? 'bg-background/80 border border-border'
          : 'bg-neutral-800/80 border border-neutral-700'
      } ${className}`}
    >
      <button
        type="button"
        aria-label="Light mode"
        onPointerDown={stop}
        onTouchStart={stopTouch}
        onTouchEnd={stopTouch}
        onClick={(e) => { stop(e); onChange(true); }}
        className={`${baseBtn} ${
          isDayMode
            ? 'bg-primary text-primary-foreground'
            : 'text-neutral-400 hover:text-white'
        }`}
      >
        <Sun className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Dark mode"
        onPointerDown={stop}
        onTouchStart={stopTouch}
        onTouchEnd={stopTouch}
        onClick={(e) => { stop(e); onChange(false); }}
        className={`${baseBtn} ${
          !isDayMode
            ? 'bg-white text-neutral-900'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Moon className="h-4 w-4" />
      </button>
    </div>
  );
}
