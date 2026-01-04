import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

interface DockToastContextType {
  message: string | null;
  isVisible: boolean;
  showDockToast: (message: string, duration?: number) => void;
}

const DockToastContext = createContext<DockToastContextType | undefined>(undefined);

// Store reference to showDockToast for use outside React
let globalShowDockToast: ((message: string, duration?: number) => void) | null = null;

export function DockToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showDockToast = useCallback((msg: string, duration = 2000) => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setMessage(msg);
    setIsVisible(true);

    timeoutRef.current = setTimeout(() => {
      setIsVisible(false);
      // Clear message after animation completes
      setTimeout(() => setMessage(null), 300);
    }, duration);
  }, []);

  // Register global reference
  React.useEffect(() => {
    globalShowDockToast = showDockToast;
    return () => {
      globalShowDockToast = null;
    };
  }, [showDockToast]);

  return (
    <DockToastContext.Provider value={{ message, isVisible, showDockToast }}>
      {children}
    </DockToastContext.Provider>
  );
}

export function useDockToast() {
  const context = useContext(DockToastContext);
  if (context === undefined) {
    throw new Error('useDockToast must be used within a DockToastProvider');
  }
  return context;
}

// Helper for triggering dock toast from anywhere (falls back to console if not in provider)
export const dockToast = (message: string, duration?: number) => {
  if (globalShowDockToast) {
    globalShowDockToast(message, duration);
  } else {
    console.log('Dock toast:', message);
  }
};
