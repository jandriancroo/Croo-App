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
    <AnimatePresence mode="wait">
      {visible && (
        <motion.div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
          style={{ background: "hsl(var(--background))", transformOrigin: "center center" }}
          // CRT turn-on: starts as a horizontal line (scaleY:0) then expands
          initial={{ scaleY: 0, scaleX: 1, opacity: 1 }}
          animate={{ 
            scaleY: [0, 0.005, 1],
            scaleX: [0.6, 1, 1],
            opacity: 1,
          }}
          exit={{
            // CRT turn-off: collapse to line then dot then gone
            scaleY: [1, 0.005, 0],
            scaleX: [1, 0.8, 0],
            opacity: [1, 1, 0],
          }}
          transition={{
            duration: 0.4,
            ease: [0.4, 0, 0.2, 1],
            times: [0, 0.4, 1],
          }}
        >
          {/* Scanline glow effect during transition */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "linear-gradient(180deg, transparent 0%, hsl(var(--primary)/0.03) 50%, transparent 100%)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.6, 0] }}
            transition={{ duration: 0.8, delay: 0.2 }}
          />

          {/* Content fades in after the CRT opens */}
          <motion.div
            className="flex flex-col items-center justify-center text-center px-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.25, ease: "easeOut" }}
          >
            {/* Logo */}
            {logoUrl && (
              <div
                className="w-14 h-14 rounded-xl overflow-hidden mb-5"
                style={{ border: "1px solid hsl(var(--border))" }}
              >
                <img src={logoUrl} alt="" className="w-full h-full object-contain p-1.5" />
              </div>
            )}

            {/* Location name */}
            <h1
              className="text-3xl font-bold tracking-tight"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {locationName}
            </h1>

            {/* Store number */}
            {storeNumber && (
              <p
                className="text-sm mt-1.5"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Store #{storeNumber}
              </p>
            )}

            {/* Pulsing dots */}
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
  );
}
