// Push notification handler - non-blocking registration
export const registerPushHandler = () => {
  if (!('serviceWorker' in navigator)) {
    console.log('[Push Handler] Service Worker not supported');
    return;
  }

  // Use a timeout to prevent hanging if service worker never becomes ready
  const timeoutId = setTimeout(() => {
    console.log('[Push Handler] Service Worker ready timeout - continuing without push handler');
  }, 5000);

  navigator.serviceWorker.ready
    .then((registration) => {
      clearTimeout(timeoutId);
      console.log('[Push Handler] Service Worker ready, registering push handler');
      
      // Listen for push events
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'PUSH_RECEIVED') {
          console.log('[Push Handler] Push notification received:', event.data);
        }
      });
    })
    .catch((error) => {
      clearTimeout(timeoutId);
      console.error('[Push Handler] Service Worker ready failed:', error);
    });
};
