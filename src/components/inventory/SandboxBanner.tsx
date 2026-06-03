import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Beaker, RotateCw, Wrench, Rocket, Copy, Check, Search } from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/useUserRole";

interface SandboxBannerProps {
  count: {
    id: string;
    is_sandbox: boolean;
    sandbox_owner: string | null;
    cloned_from_location_id: string | null;
    cloned_from_count_id: string | null;
    cloned_at: string | null;
  };
}

/**
 * Banner shown at top of a sandbox inventory count.
 *
 * Three actions:
 *  - Re-clone     : re-runs clone_count_to_sandbox against the original source
 *  - Request fix  : opens a dialog to capture a bug description, then builds
 *                   a prompt that the user pastes into Lovable chat.
 *                   Writes a sandbox_active_fix row (requested_at).
 *  - Deploy fix   : opens a dialog that builds a "remove the sandbox gate"
 *                   prompt. Disabled until the super has visually verified
 *                   the fix in sandbox (last_viewed_at > requested_at).
 *
 * On mount this component stamps last_viewed_at on any outstanding
 * sandbox_active_fix for this count, which is what enables the Deploy button.
 */
export function SandboxBanner({ count }: SandboxBannerProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isSuperAdmin } = useUserRole();
  const [requestOpen, setRequestOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLocationId, setPickerLocationId] = useState<string>("");
  const [pickerCountId, setPickerCountId] = useState<string>("");
  const [bugText, setBugText] = useState("");
  const [copied, setCopied] = useState(false);

  // Source metadata (for human-readable prompts and the post-deploy banner)
  const { data: source } = useQuery({
    queryKey: ["sandbox-source", count.cloned_from_location_id, count.cloned_from_count_id],
    queryFn: async () => {
      if (!count.cloned_from_location_id || !count.cloned_from_count_id) return null;
      const [loc, src] = await Promise.all([
        supabase.from("locations").select("name").eq("id", count.cloned_from_location_id).maybeSingle(),
        supabase
          .from("inventory_counts")
          .select("period_type, count_date")
          .eq("id", count.cloned_from_count_id)
          .maybeSingle(),
      ]);
      return {
        location_name: loc.data?.name ?? "Unknown",
        count_label: src.data
          ? `${src.data.period_type ?? "count"} ${src.data.count_date}`
          : "Unknown count",
      };
    },
    enabled: !!count.cloned_from_location_id && !!count.cloned_from_count_id,
  });

  // Outstanding (non-deployed) fix for this sandbox count
  const { data: activeFix, refetch: refetchFix } = useQuery({
    queryKey: ["sandbox-active-fix", count.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("sandbox_active_fix")
        .select("*")
        .eq("sandbox_count_id", count.id)
        .is("deployed_at", null)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  // Stamp last_viewed_at when the super views the sandbox count
  useEffect(() => {
    if (!activeFix?.id) return;
    supabase
      .from("sandbox_active_fix")
      .update({ last_viewed_at: new Date().toISOString() })
      .eq("id", activeFix.id)
      .then(() => refetchFix());
  }, [activeFix?.id, refetchFix]);

  const reclone = useMutation({
    mutationFn: async () => {
      if (!count.cloned_from_location_id || !count.cloned_from_count_id) {
        throw new Error("Missing source — cannot re-clone");
      }
      const { data, error } = await supabase.rpc("clone_count_to_sandbox", {
        _source_location_id: count.cloned_from_location_id,
        _source_count_id: count.cloned_from_count_id,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Sandbox re-cloned from source");
      queryClient.invalidateQueries({ queryKey: ["inventory-count-details"] });
      queryClient.invalidateQueries({ queryKey: ["sandbox-active-fix"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Picker: list real (non-sandbox) locations
  const { data: pickerLocations = [] } = useQuery({
    queryKey: ["sandbox-picker-locations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("locations")
        .select("id, name")
        .eq("requires_super_admin", false)
        .order("name");
      return data ?? [];
    },
    enabled: pickerOpen,
  });

  // Picker: recent counts at the selected location
  const { data: pickerCounts = [] } = useQuery({
    queryKey: ["sandbox-picker-counts", pickerLocationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_counts")
        .select("id, count_date, period_type, status")
        .eq("location_id", pickerLocationId)
        .eq("is_sandbox", false)
        .order("count_date", { ascending: false })
        .limit(50);
      return data ?? [];
    },
    enabled: pickerOpen && !!pickerLocationId,
  });

  const cloneFromPicker = useMutation({
    mutationFn: async () => {
      if (!pickerLocationId || !pickerCountId) {
        throw new Error("Pick a location and a count");
      }
      const { data, error } = await supabase.rpc("clone_count_to_sandbox", {
        _source_location_id: pickerLocationId,
        _source_count_id: pickerCountId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (newCountId) => {
      toast.success("Cloned to sandbox");
      setPickerOpen(false);
      setPickerLocationId("");
      setPickerCountId("");
      const { data: sandbox } = await supabase
        .from("locations")
        .select("id")
        .eq("name", "Sandbox")
        .eq("requires_super_admin", true)
        .maybeSingle();
      if (sandbox?.id) {
        navigate(`/inventory/${sandbox.id}/count/${newCountId}`);
      }
      queryClient.invalidateQueries({ queryKey: ["inventory-count-details"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canDeploy = useMemo(() => {
    if (!activeFix) return false;
    if (!activeFix.last_viewed_at) return false;
    return new Date(activeFix.last_viewed_at).getTime() >
      new Date(activeFix.requested_at).getTime();
  }, [activeFix]);

  const hasSource = !!(count.cloned_from_location_id && count.cloned_from_count_id);

  const requestPrompt = useMemo(
    () => buildRequestPrompt({ count, source, bug: bugText }),
    [count, source, bugText]
  );
  const deployPrompt = useMemo(
    () => buildDeployPrompt({ count, source, fix: activeFix }),
    [count, source, activeFix]
  );

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRegisterFix = async () => {
    if (!bugText.trim()) {
      toast.error("Describe the bug first");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("sandbox_active_fix").insert({
      sandbox_owner: user.id,
      sandbox_count_id: count.id,
      source_location_id: count.cloned_from_location_id!,
      source_count_id: count.cloned_from_count_id!,
      source_location_name: source?.location_name ?? null,
      source_count_label: source?.count_label ?? null,
      bug_description: bugText.trim(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await copy(requestPrompt);
    toast.success("Fix registered + prompt copied. Paste it into Lovable chat.");
    setRequestOpen(false);
    setBugText("");
    refetchFix();
  };

  const handleMarkDeployed = async () => {
    if (!activeFix) return;
    await supabase
      .from("sandbox_active_fix")
      .update({ deployed_at: new Date().toISOString() })
      .eq("id", activeFix.id);
    // Stash the post-deploy banner context for Inventory.tsx to display
    try {
      localStorage.setItem(
        "sandboxPostDeploy",
        JSON.stringify({
          deployed_at: new Date().toISOString(),
          source_location_name: source?.location_name ?? "Unknown",
          source_count_label: source?.count_label ?? "Unknown count",
        })
      );
    } catch {}
    await copy(deployPrompt);
    toast.success("Marked deployed + prompt copied. Paste it into Lovable chat.");
    setDeployOpen(false);
    refetchFix();
  };

  if (!count.is_sandbox || !isSuperAdmin) return null;

  return (
    <>
      <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Beaker className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">
              Sandbox count — isolated testbed
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {hasSource ? (
                <>
                  Cloned from{" "}
                  <span className="font-medium text-foreground">
                    {source?.location_name ?? "…"}
                  </span>{" "}
                  · {source?.count_label ?? "…"}
                  {count.cloned_at && (
                    <> · {new Date(count.cloned_at).toLocaleString()}</>
                  )}
                </>
              ) : (
                <>
                  No source recorded. This sandbox count wasn&apos;t created via
                  Clone to Sandbox — open a real count and use the{" "}
                  <span className="font-medium text-foreground">Clone to Sandbox</span>{" "}
                  button to seed one.
                </>
              )}
            </div>
            {activeFix && (
              <div className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">
                Active fix requested {new Date(activeFix.requested_at).toLocaleString()}
                {canDeploy ? " · verified ✓" : " · awaiting your visual verification"}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => reclone.mutate()}
            disabled={reclone.isPending || !hasSource}
            title={!hasSource ? "No source recorded for this sandbox count" : ""}
          >
            <RotateCw className="h-3.5 w-3.5 mr-1.5" />
            Re-clone from source
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRequestOpen(true)}
            disabled={!hasSource}
            title={!hasSource ? "Clone a real count into the sandbox first" : ""}
          >
            <Wrench className="h-3.5 w-3.5 mr-1.5" />
            Request fix for testing
          </Button>
          <Button
            size="sm"
            onClick={() => setDeployOpen(true)}
            disabled={!canDeploy}
            title={
              !activeFix
                ? "No fix registered"
                : !canDeploy
                ? "View the sandbox count after the fix lands before deploying"
                : ""
            }
          >
            <Rocket className="h-3.5 w-3.5 mr-1.5" />
            Deploy fix
          </Button>
        </div>
      </div>

      {/* Request fix dialog */}
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Request fix for sandbox testing</DialogTitle>
            <DialogDescription>
              Describe the bug. We&apos;ll register a fix record + copy a prompt
              for you to paste into Lovable chat. The fix must be gated to
              sandbox only — real data stays untouched.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={bugText}
            onChange={(e) => setBugText(e.target.value)}
            placeholder="e.g. Inner-pack count rolling up wrong: 2 inner packs of a 12-unit pack should equal 24 units, not 6."
            rows={5}
          />
          {bugText && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Preview prompt
              </summary>
              <pre className="mt-2 p-3 rounded bg-muted text-[10px] whitespace-pre-wrap max-h-64 overflow-auto">
                {requestPrompt}
              </pre>
            </details>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRequestOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRegisterFix} disabled={!bugText.trim()}>
              {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
              Register + copy prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deploy fix dialog */}
      <Dialog open={deployOpen} onOpenChange={setDeployOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Deploy sandbox fix globally</DialogTitle>
            <DialogDescription>
              This removes the sandbox-only gate around the verified fix so it
              applies to every real location. Undo is Lovable chat-restore — if
              real numbers look wrong post-deploy, restore the chat point just
              before pasting this prompt.
            </DialogDescription>
          </DialogHeader>
          <pre className="p-3 rounded bg-muted text-[10px] whitespace-pre-wrap max-h-72 overflow-auto">
            {deployPrompt}
          </pre>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeployOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleMarkDeployed}>
              <Copy className="h-4 w-4 mr-1.5" />
              Mark deployed + copy prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Prompt builders (single source of truth — the most important deliverable)
// ---------------------------------------------------------------------------

function buildRequestPrompt(args: {
  count: SandboxBannerProps["count"];
  source: { location_name: string; count_label: string } | null | undefined;
  bug: string;
}) {
  const { count, source, bug } = args;
  return `# SANDBOX FIX REQUEST

## Sandbox context (do not deviate)
- sandbox_count_id   : ${count.id}
- sandbox_location_id: (super-admin-only "Sandbox" location)
- cloned_from        : ${source?.location_name ?? "?"} / ${source?.count_label ?? "?"}
- source_location_id : ${count.cloned_from_location_id ?? "?"}
- source_count_id    : ${count.cloned_from_count_id ?? "?"}
- cloned_at          : ${count.cloned_at ?? "?"}

## Bug
${bug}

## Hard constraints
1. **Gate the fix at the LOWEST possible level** — inside the calculation
   function itself, keyed off \`count.is_sandbox === true\` or
   \`location.requires_super_admin === true\`. Do NOT branch in the UI layer.
2. **Zero changes to RLS, schema, or migrations.** No SQL.
3. **Zero changes to real-data code paths.** The non-sandbox branch must be
   byte-identical to what it is right now.
4. If threading the gate would require edits in 2+ files, STOP and tell me —
   that means the gate belongs deeper (e.g. add \`is_sandbox\` to the source
   query once so every consumer reads it for free). I will decide.
5. Touch no locked features (3D Data Cubes, voice counting, PFG sync, dock
   animations, version update system, support ticket system).

## Deliverables
- The diff (file:line for the gate, the corrected math, nothing else).
- Verification steps I should run in the sandbox count (${count.id}) to
  confirm the fix works.
- A one-line note describing which non-sandbox branch you left unchanged.

Do not write any code outside the sandbox-gated branch. Do not refactor.`;
}

function buildDeployPrompt(args: {
  count: SandboxBannerProps["count"];
  source: { location_name: string; count_label: string } | null | undefined;
  fix: { bug_description: string; requested_at: string } | null | undefined;
}) {
  const { count, source, fix } = args;
  return `# SANDBOX FIX DEPLOY

## Context
The fix below was tested in sandbox count ${count.id}, cloned from
${source?.location_name ?? "?"} / ${source?.count_label ?? "?"}.
It has been visually verified in sandbox by the super admin.

Original bug:
${fix?.bug_description ?? "(no description on record)"}

Requested at: ${fix?.requested_at ?? "?"}

## Task
Remove ONLY the sandbox gate branch you added when implementing this fix.
Keep the corrected math. The previously non-sandbox branch — which was the
buggy original — should be deleted, not preserved.

## Hard constraints
1. **No RLS or schema changes.** No migrations.
2. **No refactoring** beyond removing the \`if (is_sandbox) { ... } else { ... }\`
   gate and collapsing it to a single corrected expression.
3. **Do not change behavior for sandbox counts.** Sandbox counts should
   continue to read identically to real counts after deploy.
4. Touch no locked features.

## Safety net
If real-location values look wrong after I paste this prompt, my undo is
Lovable chat-restore to the point just before pasting. Make this diff small
and obvious so a restore is clean.

## Deliverables
- The single diff that removes the gate.
- A one-line confirmation that the sandbox and real-location code paths are
  now byte-identical (modulo the corrected expression).`;
}
