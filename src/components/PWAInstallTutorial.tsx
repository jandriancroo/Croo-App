import { useState, useEffect } from 'react';
import { X, Share, Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallTutorial() {
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Already running as PWA — never show
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) return;

    // Dismissed this session already
    if (sessionStorage.getItem('pwa-tutorial-dismissed')) return;

    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(iOS);

    // Small delay so it doesn't flash on load
    const timer = setTimeout(() => setVisible(true), 2000);

    // Listen for Android install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    window.addEventListener('appinstalled', () => {
      setVisible(false);
    });

    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    sessionStorage.setItem('pwa-tutorial-dismissed', '1');
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setVisible(false);
      }
      setDeferredPrompt(null);
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 80 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 80 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-20 left-3 right-3 z-[9999] sm:left-auto sm:right-4 sm:max-w-sm"
        >
          <div className="relative rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
            {/* Top accent bar */}
            <div className="h-1 bg-gradient-to-r from-primary to-primary/60" />

            <button
              onClick={dismiss}
              className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>

            <div className="p-4 pt-3">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Smartphone className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-card-foreground leading-tight">
                    Install CrooHQ
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Get the full app experience
                  </p>
                </div>
              </div>

              {isIOS ? (
                <div className="space-y-2 mb-3">
                  <Step n={1}>
                    Tap <Share className="h-3.5 w-3.5 inline -mt-0.5" /> <strong>Share</strong> in Safari
                  </Step>
                  <Step n={2}>
                    Scroll &amp; tap <strong>"Add to Home Screen"</strong>
                  </Step>
                  <Step n={3}>
                    Tap <strong>"Add"</strong> to confirm
                  </Step>
                </div>
              ) : (
                <div className="space-y-2 mb-3">
                  {deferredPrompt ? (
                    <p className="text-xs text-muted-foreground">
                      Install CrooHQ for quick access, push notifications, and offline support.
                    </p>
                  ) : (
                    <>
                      <Step n={1}>
                        Tap <strong>⋮</strong> menu in your browser
                      </Step>
                      <Step n={2}>
                        Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>
                      </Step>
                    </>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={dismiss}
                  className="flex-1 text-xs h-8"
                >
                  Not now
                </Button>
                {deferredPrompt && !isIOS ? (
                  <Button
                    size="sm"
                    onClick={handleInstall}
                    className="flex-1 text-xs h-8 gap-1.5"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Install
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={dismiss}
                    className="flex-1 text-xs h-8"
                  >
                    Got it
                  </Button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold mt-0.5">
        {n}
      </div>
      <p className="text-xs text-card-foreground leading-snug">{children}</p>
    </div>
  );
}
