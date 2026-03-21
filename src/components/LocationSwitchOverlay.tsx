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
          <motion.div
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
            style={{ background: "hsl(var(--background))" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <motion.div
              className="flex flex-col items-center text-center px-8"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08, duration: 0.25, ease: "easeOut" }}
            >
              {logoUrl && (
                <div
                  className="w-14 h-14 rounded-xl overflow-hidden mb-5"
                  style={{ border: "1px solid hsl(var(--border))" }}
                >
                  <img src={logoUrl} alt="" className="w-full h-full object-contain p-1.5" />
                </div>
              )}

              <h1
                className="text-3xl font-bold tracking-tight"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {locationName}
              </h1>

              {storeNumber && (
                <p
                  className="text-sm mt-1.5"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Store #{storeNumber}
                </p>
              )}

              {/* Apple-style spinner — thin rotating arc */}
              <div className="mt-8">
                <motion.svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, rotate: 360 }}
                  transition={{
                    opacity: { duration: 0.3 },
                    rotate: { duration: 0.8, repeat: Infinity, ease: "linear" },
                  }}
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    fill="none"
                    stroke="hsl(var(--muted-foreground)/0.2)"
                    strokeWidth="2.5"
                  />
                  <motion.circle
                    cx="12"
                    cy="12"
                    r="10"
                    fill="none"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray="62.83"
                    strokeDashoffset="47"
                  />
                </motion.svg>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
