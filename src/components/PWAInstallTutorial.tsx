import { useState, useEffect } from 'react';
import { ChevronDown, Share, Download, Smartphone, Apple } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallTutorial() {
  const [hidden, setHidden] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android'>('android');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setPlatform(iOS ? 'ios' : 'android');
    setHidden(false);


    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setHidden(true));

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setHidden(true);
    setDeferredPrompt(null);
  };

  if (hidden) return null;

  return (
    <div className="w-full max-w-md mt-4">
      <div className="rounded-2xl border-2 border-primary/30 bg-primary/10 backdrop-blur-xl shadow-xl overflow-hidden ring-1 ring-primary/20">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-primary/10 transition-colors"
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-sm">
            <Share className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-tight text-foreground">Install CrooHQ</p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Add to home screen for the full app experience
            </p>
          </div>
          {deferredPrompt && (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleInstall();
              }}
              className="h-8 text-xs gap-1 mr-1"
            >
              <Download className="h-3.5 w-3.5" />
              Install
            </Button>
          )}
          <ChevronDown
            className={`h-5 w-5 text-primary transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 pt-1 border-t border-border/60 space-y-3">
                {/* Platform toggle */}
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/60">
                  <button
                    onClick={() => setPlatform('ios')}
                    className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      platform === 'ios' ? 'bg-background shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    <Apple className="h-3.5 w-3.5" /> iOS
                  </button>
                  <button
                    onClick={() => setPlatform('android')}
                    className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      platform === 'android' ? 'bg-background shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    <Smartphone className="h-3.5 w-3.5" /> Android
                  </button>
                </div>

                {platform === 'ios' ? (
                  <div className="space-y-1.5">
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
                  <div className="space-y-1.5">
                    <Step n={1}>
                      Tap <strong>⋮</strong> menu in your browser
                    </Step>
                    <Step n={2}>
                      Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>
                    </Step>
                    <Step n={3}>Tap <strong>"Install"</strong> to confirm</Step>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
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
