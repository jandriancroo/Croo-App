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
          {/* Logo */}
          {logoUrl && (
            <motion.div
              className="w-14 h-14 rounded-xl overflow-hidden mb-5"
              style={{ border: "1px solid hsl(var(--border))" }}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.3, ease: "easeOut" }}
            >
              <img src={logoUrl} alt="" className="w-full h-full object-contain p-1.5" />
            </motion.div>
          )}

          {/* Location name — big and centered */}
          <motion.h1
            className="text-3xl font-bold tracking-tight text-center px-8"
            style={{ color: "hsl(var(--foreground))" }}
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.12, duration: 0.3, ease: "easeOut" }}
          >
            {locationName}
          </motion.h1>

          {/* Store number */}
          {storeNumber && (
            <motion.p
              className="text-sm mt-1.5"
              style={{ color: "hsl(var(--muted-foreground))" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.3 }}
            >
              Store #{storeNumber}
            </motion.p>
          )}

          {/* Subtle pulsing dots */}
          <motion.div
            className="flex gap-1.5 mt-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.3 }}
          >
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
