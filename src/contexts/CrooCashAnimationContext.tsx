import { createContext, useContext, useState, ReactNode } from 'react';

interface CrooCashAnimationContextType {
  triggerAnimation: (amount: number) => void;
  animationAmount: number | null;
  clearAnimation: () => void;
}

const CrooCashAnimationContext = createContext<CrooCashAnimationContextType | undefined>(undefined);

export function CrooCashAnimationProvider({ children }: { children: ReactNode }) {
  const [animationAmount, setAnimationAmount] = useState<number | null>(null);

  const triggerAnimation = (amount: number) => {
    setAnimationAmount(amount);
    // Auto-clear after animation completes
    setTimeout(() => {
      setAnimationAmount(null);
    }, 3000);
  };

  const clearAnimation = () => {
    setAnimationAmount(null);
  };

  return (
    <CrooCashAnimationContext.Provider value={{ triggerAnimation, animationAmount, clearAnimation }}>
      {children}
    </CrooCashAnimationContext.Provider>
  );
}

export function useCrooCashAnimation() {
  const context = useContext(CrooCashAnimationContext);
  if (context === undefined) {
    throw new Error('useCrooCashAnimation must be used within a CrooCashAnimationProvider');
  }
  return context;
}
