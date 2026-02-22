import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Shield, Calendar, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface DocumentValidationResult {
  quality: {
    is_flat_surface: boolean;
    is_readable: boolean;
    issues: string[];
  };
  name: {
    extracted_name: string;
    matches_employee: boolean;
    confidence: number;
    region: { top: number; left: number; width: number; height: number };
  };
  expiration: {
    date_found: boolean;
    expiration_date?: string;
    is_expired: boolean;
  };
  is_valid_document: boolean;
  summary: string;
}

interface DocumentScanOverlayProps {
  imageUrl: string;
  scanning: boolean;
  result: DocumentValidationResult | null;
  error: string | null;
  onRetake: () => void;
  onAccept: () => void;
}

export function DocumentScanOverlay({
  imageUrl,
  scanning,
  result,
  error,
  onRetake,
  onAccept,
}: DocumentScanOverlayProps) {
  const [scanProgress, setScanProgress] = useState(0);

  // Animate scan bar during scanning
  useEffect(() => {
    if (!scanning) {
      setScanProgress(0);
      return;
    }
    const interval = setInterval(() => {
      setScanProgress((prev) => {
        if (prev >= 100) return 0;
        return prev + 0.8;
      });
    }, 30);
    return () => clearInterval(interval);
  }, [scanning]);

  const nameMatch = result?.name?.matches_employee;
  const expired = result?.expiration?.is_expired;
  const flatSurface = result?.quality?.is_flat_surface;

  return (
    <div className="relative rounded-lg overflow-hidden border-2 border-border bg-black">
      {/* Document image */}
      <div className="relative aspect-[3/2]">
        <img
          src={imageUrl}
          alt="Document scan"
          className="w-full h-full object-contain bg-black"
        />

        {/* Scan bar animation */}
        <AnimatePresence>
          {scanning && (
            <motion.div
              className="absolute left-0 right-0 h-1 z-20"
              style={{
                top: `${scanProgress}%`,
                background:
                  "linear-gradient(180deg, transparent, hsl(var(--primary) / 0.6), hsl(var(--primary)), hsl(var(--primary) / 0.6), transparent)",
                boxShadow: "0 0 20px 8px hsl(var(--primary) / 0.3)",
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          )}
        </AnimatePresence>

        {/* Name bounding box overlay */}
        <AnimatePresence>
          {result?.name?.region && !scanning && (
            <motion.div
              className="absolute z-10 border-2 rounded-sm"
              style={{
                top: `${result.name.region.top}%`,
                left: `${result.name.region.left}%`,
                width: `${result.name.region.width}%`,
                height: `${result.name.region.height}%`,
                borderColor: nameMatch
                  ? "hsl(142.1 76.2% 36.3%)"
                  : "hsl(0 84.2% 60.2%)",
                backgroundColor: nameMatch
                  ? "hsl(142.1 76.2% 36.3% / 0.15)"
                  : "hsl(0 84.2% 60.2% / 0.15)",
              }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.4, ease: "easeOut" }}
            >
              {/* Label tag */}
              <motion.div
                className="absolute -top-6 left-0 px-2 py-0.5 rounded-t text-[10px] font-bold text-white"
                style={{
                  backgroundColor: nameMatch
                    ? "hsl(142.1 76.2% 36.3%)"
                    : "hsl(0 84.2% 60.2%)",
                }}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                {nameMatch ? "✓ NAME MATCH" : "✗ NAME MISMATCH"}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Scanning overlay */}
        {scanning && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-30">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <p className="text-white text-sm font-medium">Scanning document...</p>
            </div>
          </div>
        )}
      </div>

      {/* Results panel */}
      <AnimatePresence>
        {(result || error) && !scanning && (
          <motion.div
            className="p-3 space-y-3 bg-background"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.3 }}
          >
            {error ? (
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-sm">{error}</p>
              </div>
            ) : result ? (
              <>
                {/* Validation checks */}
                <div className="grid grid-cols-1 gap-2">
                  {/* Surface quality */}
                  <ValidationRow
                    label="Surface Quality"
                    passed={flatSurface!}
                    detail={
                      flatSurface
                        ? "Flat surface detected"
                        : result.quality.issues.join(", ") || "Poor surface"
                    }
                    icon={<Shield className="h-3.5 w-3.5" />}
                  />

                  {/* Name match */}
                  <ValidationRow
                    label="Name Verification"
                    passed={nameMatch!}
                    detail={
                      nameMatch
                        ? `"${result.name.extracted_name}" — Match (${result.name.confidence}%)`
                        : `Found "${result.name.extracted_name}" — Does not match`
                    }
                    icon={<User className="h-3.5 w-3.5" />}
                  />

                  {/* Expiration */}
                  <ValidationRow
                    label="Expiration"
                    passed={result.expiration.date_found ? !expired! : true}
                    detail={
                      !result.expiration.date_found
                        ? "No expiration date found"
                        : expired
                        ? `Expired: ${result.expiration.expiration_date}`
                        : `Valid until ${result.expiration.expiration_date}`
                    }
                    icon={<Calendar className="h-3.5 w-3.5" />}
                    warning={!result.expiration.date_found}
                  />
                </div>

                {/* Overall status */}
                <div
                  className={`flex items-center gap-2 p-2 rounded-lg text-sm font-medium ${
                    result.is_valid_document
                      ? "bg-green-500/10 text-green-600 dark:text-green-400"
                      : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {result.is_valid_document ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {result.summary}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={onRetake}
                  >
                    Retake Photo
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={onAccept}
                    variant={result.is_valid_document ? "default" : "destructive"}
                  >
                    {result.is_valid_document ? "Accept" : "Accept Anyway"}
                  </Button>
                </div>
              </>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ValidationRow({
  label,
  passed,
  detail,
  icon,
  warning,
}: {
  label: string;
  passed: boolean;
  detail: string;
  icon: React.ReactNode;
  warning?: boolean;
}) {
  const color = warning
    ? "text-amber-500"
    : passed
    ? "text-green-600 dark:text-green-400"
    : "text-destructive";

  return (
    <div className="flex items-start gap-2 text-xs">
      <div className={`mt-0.5 ${color}`}>
        {warning ? (
          <AlertTriangle className="h-3.5 w-3.5" />
        ) : passed ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <XCircle className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">{label}</p>
        <p className={`${color} truncate`}>{detail}</p>
      </div>
    </div>
  );
}
