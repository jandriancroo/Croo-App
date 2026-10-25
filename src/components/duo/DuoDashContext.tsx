import { createContext, useContext } from 'react';

export const DuoDashContext = createContext(false);
export const useDuoDashPresentation = () => useContext(DuoDashContext);