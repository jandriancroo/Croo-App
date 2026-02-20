import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Check, Building2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import crooLogo from "@/assets/croo-logo-white.png";

const DEMO_LOCATION = { name: "Palm Springs", store_number: "1223" };

// ─────────────────────────────────────────────
// Option A: Branded Blur Takeover
// ─────────────────────────────────────────────
function OptionA({ active, onTrigger }: { active: boolean; onTrigger: () => void }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center"
          style={{ backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", backgroundColor: "hsla(189,45%,15%,0.85)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          <motion.img
            src={crooLogo}
            alt="Croo"
            className="h-10 mb-8 opacity-90"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
          />
          <motion.div
            className="flex items-center gap-2 mb-3"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <MapPin className="h-5 w-5 text-primary" />
            <span className="text-white/60 text-sm font-medium tracking-widest uppercase">Switching to</span>
          </motion.div>
          <motion.h2
            className="text-white text-3xl font-semibold mb-1"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.28, duration: 0.4 }}
          >
            {DEMO_LOCATION.name}
          </motion.h2>
          <motion.p
            className="text-white/50 text-sm mb-10"
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.34, duration: 0.35 }}
          >
            Store #{DEMO_LOCATION.store_number}
          </motion.p>
          <motion.div
            className="flex gap-1.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
          >
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-primary"
                animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────
// Option B: Slide-Up Card
// ─────────────────────────────────────────────
function OptionB({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <>
          <motion.div
            className="absolute inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
          <motion.div
            className="absolute bottom-0 left-0 right-0 z-50 rounded-t-3xl overflow-hidden"
            style={{ background: "hsl(var(--card))" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
          >
            <div className="h-1 w-10 rounded-full bg-border mx-auto mt-3 mb-6" />
            <div className="px-6 pb-10 flex flex-col items-center text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "hsl(var(--primary)/0.12)" }}
              >
                <Building2 className="h-7 w-7" style={{ color: "hsl(var(--primary))" }} />
              </div>
              <p className="text-sm mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Loading location</p>
              <h2 className="text-2xl font-semibold mb-1" style={{ color: "hsl(var(--foreground))" }}>
                {DEMO_LOCATION.name}
              </h2>
              <p className="text-sm mb-6" style={{ color: "hsl(var(--muted-foreground))" }}>Store #{DEMO_LOCATION.store_number}</p>
              <div className="w-full max-w-[200px] h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "hsl(var(--primary))" }}
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 1.4, ease: "easeInOut" }}
                />
              </div>
              <p className="text-xs mt-3" style={{ color: "hsl(var(--muted-foreground))" }}>Taking you to the dashboard…</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────
// Option C: Full-Screen Flash Transition
// ─────────────────────────────────────────────
function OptionC({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<"idle" | "cover" | "reveal">("idle");

  useEffect(() => {
    if (active) {
      setPhase("cover");
      const t = setTimeout(() => setPhase("reveal"), 700);
      return () => clearTimeout(t);
    } else {
      setPhase("idle");
    }
  }, [active]);

  return (
    <AnimatePresence>
      {phase !== "idle" && (
        <motion.div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center"
          style={{ background: "hsl(var(--foreground))" }}
          initial={{ clipPath: "circle(0% at 50% 50%)" }}
          animate={
            phase === "cover"
              ? { clipPath: "circle(150% at 50% 50%)" }
              : { clipPath: "circle(0% at 50% 50%)" }
          }
          exit={{ clipPath: "circle(0% at 50% 50%)" }}
          transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
        >
          {phase === "cover" && (
            <motion.div
              className="flex flex-col items-center gap-3"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
            >
              <img src={crooLogo} alt="Croo" className="h-8 opacity-80 mb-2" />
              <div className="flex items-center gap-2 text-white/70 text-sm">
                <MapPin className="h-4 w-4" style={{ color: "hsl(var(--primary))" }} />
                <span>{DEMO_LOCATION.name} #{DEMO_LOCATION.store_number}</span>
                <ArrowRight className="h-4 w-4 opacity-50" />
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────
// Option D: Minimal Top Banner
// ─────────────────────────────────────────────
function OptionD({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 shadow-lg"
          style={{ background: "hsl(var(--primary))" }}
          initial={{ y: "-100%" }}
          animate={{ y: 0 }}
          exit={{ y: "-100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 320 }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: "hsl(var(--primary-foreground)/0.2)" }}
            >
              <MapPin className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-white/70 text-xs leading-none mb-0.5">Switching to</p>
              <p className="text-white font-semibold text-sm leading-none">
                {DEMO_LOCATION.name} #{DEMO_LOCATION.store_number}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <motion.div
              className="flex gap-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-white/60"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </motion.div>
          </div>
          <motion.div
            className="absolute bottom-0 left-0 h-0.5"
            style={{ background: "hsl(var(--primary-foreground)/0.4)" }}
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 1.5, ease: "easeInOut" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────
// Preview Card Wrapper
// ─────────────────────────────────────────────
interface PreviewCardProps {
  letter: string;
  label: string;
  description: string;
  children: (active: boolean, trigger: () => void) => React.ReactNode;
}

function PreviewCard({ letter, label, description, children }: PreviewCardProps) {
  const [active, setActive] = useState(false);

  const trigger = () => {
    setActive(true);
    setTimeout(() => setActive(false), 2000);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5"
          style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
        >
          {letter}
        </div>
        <div>
          <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>{label}</h3>
          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{description}</p>
        </div>
      </div>

      {/* Phone mockup */}
      <div
        className="relative rounded-2xl overflow-hidden mx-auto"
        style={{
          width: 200,
          height: 320,
          background: "hsl(var(--background))",
          border: "1px solid hsl(var(--border))",
          boxShadow: "0 8px 32px hsl(var(--foreground)/0.08)"
        }}
      >
        {/* Fake page content */}
        <div className="p-4 space-y-2.5">
          <div className="h-5 rounded-md w-3/4" style={{ background: "hsl(var(--muted))" }} />
          <div className="h-3 rounded-md w-full" style={{ background: "hsl(var(--muted))" }} />
          <div className="h-3 rounded-md w-5/6" style={{ background: "hsl(var(--muted))" }} />
          <div className="h-16 rounded-xl mt-2" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
          <div className="h-10 rounded-xl" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
          <div className="h-10 rounded-xl" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
        </div>
        {children(active, trigger)}
      </div>

      <Button
        size="sm"
        variant="outline"
        className="mx-auto text-xs h-8 px-4"
        onClick={trigger}
        disabled={active}
      >
        {active ? (
          <><Check className="h-3 w-3 mr-1.5" /> Playing…</>
        ) : (
          "▶ Preview"
        )}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────
export default function LocationSwitchPreview() {
  return (
    <div
      className="min-h-screen py-10 px-4"
      style={{ background: "hsl(var(--background))" }}
    >
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8 text-center">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-4"
            style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))" }}
          >
            <MapPin className="h-3 w-3" />
            Location Switch Transition — 4 Options
          </div>
          <h1 className="text-2xl font-semibold mb-2" style={{ color: "hsl(var(--foreground))" }}>
            Which feels right?
          </h1>
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            Preview each option then let me know your pick — or mix and match ideas
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 gap-8">
          <PreviewCard
            letter="A"
            label="Branded Blur Takeover"
            description="Frosted glass overlay with Croo logo, location name, and animated dots. Full-screen, cinematic."
          >
            {(active, trigger) => <OptionA active={active} onTrigger={trigger} />}
          </PreviewCard>

          <PreviewCard
            letter="B"
            label="Slide-Up Card"
            description="Sheet slides up from bottom with a progress bar. Familiar mobile pattern, feels native."
          >
            {(active) => <OptionB active={active} />}
          </PreviewCard>

          <PreviewCard
            letter="C"
            label="Full-Screen Flash"
            description="Dark circle expands to cover screen, then shrinks away to reveal the dashboard. Bold & dramatic."
          >
            {(active) => <OptionC active={active} />}
          </PreviewCard>

          <PreviewCard
            letter="D"
            label="Minimal Top Banner"
            description="A slim primary-colored bar slides down from the top with a loading line. Subtle, non-intrusive."
          >
            {(active) => <OptionD active={active} />}
          </PreviewCard>
        </div>

        <div className="mt-10 text-center">
          <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
            All options auto-dismiss after ~1.5s once the dashboard has loaded
          </p>
        </div>
      </div>
    </div>
  );
}
