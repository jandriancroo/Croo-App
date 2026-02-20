import { motion, AnimatePresence } from "framer-motion";
import { Building2, MapPin } from "lucide-react";

interface LocationSwitchOverlayProps {
  visible: boolean;
  locationName: string;
  storeNumber?: string | null;
}

export function LocationSwitchOverlay({ visible, locationName, storeNumber }: LocationSwitchOverlayProps) {
  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[9998]"
            style={{ background: "hsl(var(--foreground)/0.45)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          />

          {/* Slide-up card */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-[9999] rounded-t-3xl overflow-hidden"
            style={{ background: "hsl(var(--card))" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
          >
            {/* Handle pill */}
            <div
              className="h-1 w-10 rounded-full mx-auto mt-3 mb-5"
              style={{ background: "hsl(var(--border))" }}
            />

            <div className="px-6 pb-12 flex flex-col items-center text-center">
              {/* Icon */}
              <motion.div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "hsl(var(--primary)/0.12)" }}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.08, type: "spring", damping: 20 }}
              >
                <Building2 className="h-7 w-7" style={{ color: "hsl(var(--primary))" }} />
              </motion.div>

              {/* Label */}
              <motion.p
                className="text-xs font-medium tracking-widest uppercase mb-1"
                style={{ color: "hsl(var(--muted-foreground))" }}
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.14 }}
              >
                Switching to
              </motion.p>

              {/* Location name */}
              <motion.h2
                className="text-2xl font-semibold mb-1"
                style={{ color: "hsl(var(--foreground))" }}
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                {locationName}
              </motion.h2>

              {/* Store number */}
              {storeNumber && (
                <motion.div
                  className="flex items-center gap-1.5 mb-6"
                  initial={{ y: 6, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.25 }}
                >
                  <MapPin className="h-3.5 w-3.5" style={{ color: "hsl(var(--muted-foreground))" }} />
                  <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Store #{storeNumber}
                  </p>
                </motion.div>
              )}

              {!storeNumber && <div className="mb-6" />}

              {/* Progress bar */}
              <motion.div
                className="w-full max-w-[220px] h-1.5 rounded-full overflow-hidden"
                style={{ background: "hsl(var(--muted))" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "hsl(var(--primary))" }}
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 1.3, ease: "easeInOut", delay: 0.32 }}
                />
              </motion.div>

              <motion.p
                className="text-xs mt-3"
                style={{ color: "hsl(var(--muted-foreground))" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                Taking you to the dashboard…
              </motion.p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
