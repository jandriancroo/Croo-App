import { useMemo } from 'react';

export const useIsIOS = () => {
  return useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  }, []);
};
