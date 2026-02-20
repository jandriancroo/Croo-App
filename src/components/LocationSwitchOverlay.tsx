import { motion, AnimatePresence } from "framer-motion";
import { MapPin } from "lucide-react";

interface LocationSwitchOverlayProps {
  visible: boolean;
  locationName: string;
  storeNumber?: string | null;
  logoUrl?: string | null;
  brandName?: string | null;
}

export function LocationSwitchOverlay({ visible, locationName, storeNumber, logoUrl, brandName }: LocationSwitchOverlayProps) {
  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Blurred backdrop */}
          <motion.div
            className="fixed inset-0 z-[9998]"
            style={{
              backdropFilter: "blur(18px)",
              WebkitBackdropFilter: "blur(18px)",
              background: "hsl(var(--foreground)/0.35)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          />

          {/* Slide-up card */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-[9999] rounded-t-3xl overflow-hidden"
            style={{ background: "hsl(var(--card))" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 36, stiffness: 190 }}
          >
            {/* Handle pill */}
            <div
              className="h-1 w-10 rounded-full mx-auto mt-3 mb-6"
              style={{ background: "hsl(var(--border))" }}
            />

            <div className="px-6 pb-16 flex flex-col items-center text-center">
              {/* Brand logo */}
              <motion.div
                className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5 overflow-hidden"
                style={!logoUrl
                  ? { background: "hsl(var(--primary)/0.12)" }
                  : { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }
                }
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.18, type: "spring", damping: 16, stiffness: 180 }}
              >
                {logoUrl ? (
                  <img src={logoUrl} alt="Brand logo" className="w-full h-full object-contain p-2.5" />
                ) : (
                  <MapPin className="h-8 w-8" style={{ color: "hsl(var(--primary))" }} />
                )}
              </motion.div>

              {/* Brand name */}
              {brandName && (
                <motion.p
                  className="text-base font-semibold mb-1"
                  style={{ color: "hsl(var(--primary))" }}
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.28, duration: 0.55 }}
                >
                  {brandName}
                </motion.p>
              )}

              {/* "Switching to" label */}
              <motion.p
                className="text-xs font-medium tracking-widest uppercase mb-1.5"
                style={{ color: "hsl(var(--muted-foreground))" }}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.36, duration: 0.55 }}
              >
                Switching to
              </motion.p>

              {/* Location name */}
              <motion.h2
                className="text-2xl font-semibold mb-1"
                style={{ color: "hsl(var(--foreground))" }}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.44, duration: 0.55 }}
              >
                {locationName}
              </motion.h2>

              {/* Store number */}
              {storeNumber && (
                <motion.div
                  className="flex items-center gap-1.5 mb-8"
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.52, duration: 0.5 }}
                >
                  <MapPin className="h-3.5 w-3.5" style={{ color: "hsl(var(--muted-foreground))" }} />
                  <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Store #{storeNumber}
                  </p>
                </motion.div>
              )}

              {!storeNumber && <div className="mb-8" />}

              {/* Progress bar */}
              <motion.div
                className="w-full max-w-[260px] h-1.5 rounded-full overflow-hidden"
                style={{ background: "hsl(var(--muted))" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.56 }}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "hsl(var(--primary))" }}
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 3.0, ease: "easeInOut", delay: 0.6 }}
                />
              </motion.div>

              <motion.p
                className="text-xs mt-3"
                style={{ color: "hsl(var(--muted-foreground))" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.65 }}
              >
                Loading dashboard…
              </motion.p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
