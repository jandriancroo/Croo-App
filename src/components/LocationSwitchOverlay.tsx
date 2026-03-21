import { motion, AnimatePresence } from "framer-motion";

interface LocationSwitchOverlayProps {
  visible: boolean;
  locationName: string;
  storeNumber?: string | null;
  logoUrl?: string | null;
  brandName?: string | null;
}

export function LocationSwitchOverlay({ visible, locationName, storeNumber, logoUrl, brandName }: LocationSwitchOverlayProps) {
  return (
    <>
      {logoUrl && <link rel="preload" as="image" href={logoUrl} />}

      <AnimatePresence>
        {visible && (
          <>
            {/* Dimmed backdrop */}
            <motion.div
              className="fixed inset-0 z-[9998]"
              style={{ background: "hsl(var(--foreground)/0.4)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />

            {/* Bottom card */}
            <motion.div
              className="fixed bottom-0 left-0 right-0 z-[9999] rounded-t-2xl overflow-hidden"
              style={{ background: "hsl(var(--card))" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 300 }}
            >
              {/* Handle pill */}
              <div
                className="h-1 w-10 rounded-full mx-auto mt-3"
                style={{ background: "hsl(var(--border))" }}
              />

              <div className="px-6 pt-6 pb-14 flex flex-col items-center text-center">
                {logoUrl && (
                  <div
                    className="w-12 h-12 rounded-xl overflow-hidden mb-4"
                    style={{ border: "1px solid hsl(var(--border))" }}
                  >
                    <img src={logoUrl} alt="" className="w-full h-full object-contain p-1.5" />
                  </div>
                )}

                <p
                  className="text-xs font-medium tracking-widest uppercase mb-1"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Switching to
                </p>

                <h2
                  className="text-2xl font-bold tracking-tight"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {locationName}
                </h2>

                {storeNumber && (
                  <p
                    className="text-sm mt-0.5"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Store #{storeNumber}
                  </p>
                )}

                {/* Center line growing outwards */}
                <div className="mt-6 w-full max-w-[200px] flex items-center justify-center">
                  <motion.div
                    className="h-[2px] rounded-full"
                    style={{ background: "hsl(var(--primary))" }}
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 1.4, ease: [0.25, 0.1, 0.25, 1] }}
                  />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
