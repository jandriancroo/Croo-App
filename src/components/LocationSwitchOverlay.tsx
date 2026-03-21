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
      {/* Preload logo so it's in browser cache before overlay shows */}
      {logoUrl && (
        <link rel="preload" as="image" href={logoUrl} />
      )}

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

              <div className="flex gap-1.5 mt-8">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "hsl(var(--primary))" }}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{
                      duration: 0.9,
                      repeat: Infinity,
                      delay: i * 0.15,
                      ease: "easeInOut",
                    }}
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
