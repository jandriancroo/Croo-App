import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Rocket, X } from "lucide-react";

interface Stash {
  deployed_at: string;
  source_location_name: string;
  source_count_label: string;
}

const KEY = "sandboxPostDeploy";
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Slim banner shown on the Inventory landing for ~1 hour after a sandbox fix
 * has been deployed. Reminds the super to spot-check a real location and that
 * Lovable chat-restore is the undo path.
 */
export function SandboxPostDeployBanner() {
  const [stash, setStash] = useState<Stash | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Stash;
      const age = Date.now() - new Date(parsed.deployed_at).getTime();
      if (age > ONE_HOUR_MS) {
        localStorage.removeItem(KEY);
        return;
      }
      setStash(parsed);
    } catch {
      localStorage.removeItem(KEY);
    }
  }, []);

  if (!stash) return null;

  const dismiss = () => {
    localStorage.removeItem(KEY);
    setStash(null);
  };

  return (
    <div className="rounded-lg border-2 border-emerald-500/40 bg-emerald-500/5 p-3 flex items-start gap-3">
      <Rocket className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
      <div className="flex-1 text-sm">
        <div className="font-medium">Recently deployed fix tested in sandbox</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Cloned from{" "}
          <span className="font-medium text-foreground">{stash.source_location_name}</span>{" "}
          / {stash.source_count_label}. Spot-check a real location — restore the
          Lovable chat if values look wrong.
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={dismiss} className="h-7 w-7 p-0">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
