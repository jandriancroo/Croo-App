import React, { createContext, useContext, useState } from 'react';

interface DockContentState {
  type: 'inventory-count';
  totalValue: number;
  countedItems: number;
  totalItems: number;
  isSaving: boolean;
  isListening: boolean;
  isVoiceSupported: boolean;
  isEditing: boolean;
  elapsedSeconds: number;
  lastSavedAt: Date | null;
  onSave: () => void;
  onToggleVoice?: () => void;
}

interface DockToastContextType {
  // Smart dock content (inventory counting, etc.)
  dockContent: DockContentState | null;
  setDockContent: (content: DockContentState | null) => void;
  // Legacy compat — these are now no-ops, toasts go through Sonner
  message: string | null;
  isVisible: boolean;
  showDockToast: (message: string, duration?: number) => void;
}

const DockToastContext = createContext<DockToastContextType | undefined>(undefined);

export function DockToastProvider({ children }: { children: React.ReactNode }) {
  const [dockContent, setDockContent] = useState<DockContentState | null>(null);

  // No-op — toasts now go through Sonner uniformly
  const showDockToast = () => {};

  return (
    <DockToastContext.Provider value={{ 
      message: null, 
      isVisible: false, 
      showDockToast, 
      dockContent, 
      setDockContent 
    }}>
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

// Legacy export — now a no-op, Sonner handles all toasts
export const dockToast = (_message: string, _duration?: number) => {};
