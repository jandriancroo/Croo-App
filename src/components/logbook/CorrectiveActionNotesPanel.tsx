import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Loader2, Save, Lock, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { NoteBullet } from "@/hooks/useConversationRecorder";

interface Props {
  writeUpId: string;
  notesBullets?: NoteBullet[] | null;
  signedAt?: string | null;
  recordingDurationSeconds?: number | null;
  /**
   * Which transcript gate to use.
   * "manager" (default, Logbook) → get_corrective_action_transcript (manager-tier).
   * "admin" (employee file) → get_corrective_action_transcript_admin (admin+ and never self).
   * "none" → transcript is not offered at all on this surface.
   */
  transcriptAccess?: "manager" | "admin" | "none";
  /** Bullets/transcript are read-only on this surface (employee file). */
  readOnly?: boolean;
  /** Called when the transcript is successfully fetched (for PDF scoping). */
  onTranscriptLoaded?: (text: string) => void;
}

/**
 * Saved-record view of a recorded Corrective Action conversation.
 * Bullets show by default; the verbatim transcript is collapsed and only
 * fetched through the manager-tier RPC when expanded.
 * Both stay editable until the employee signs (signed_at).
 */
export function CorrectiveActionNotesPanel({
  writeUpId, notesBullets, signedAt, recordingDurationSeconds,
  transcriptAccess = "manager", readOnly = false, onTranscriptLoaded,
}: Props) {
  const queryClient = useQueryClient();
  const locked = !!signedAt || readOnly;
  const [bullets, setBullets] = useState<NoteBullet[]>(notesBullets || []);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [transcriptFull, setTranscriptFull] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setBullets(notesBullets || []); }, [notesBullets]);

  const loadTranscript = async () => {
    if (transcript !== null || loadingTranscript) return;
    setLoadingTranscript(true);
    const rpcName =
      transcriptAccess === "admin"
        ? "get_corrective_action_transcript_admin"
        : "get_corrective_action_transcript";
    const { data, error } = await supabase.rpc(rpcName as any, {
      _writeup_id: writeUpId,
    });
    setLoadingTranscript(false);
    if (error) {
      toast.error("You don't have access to the transcript.");
      return;
    }
    const text = (data as string) || "";
    setTranscript(text);
    onTranscriptLoaded?.(text);
  };

  const save = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = { notes_bullets: bullets };
    if (transcript !== null) payload.transcript_text = transcript;
    const { error } = await supabase.from("employee_writeups").update(payload as any).eq("id", writeUpId);
    setSaving(false);
    if (error) {
      toast.error("Could not save: " + error.message);
      return;
    }
    setDirty(false);
    toast.success("Notes updated");
    queryClient.invalidateQueries({ queryKey: ["employee-writeups"] });
  };

  if (!notesBullets?.length && !recordingDurationSeconds) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">Conversation Notes</p>
        <div className="flex items-center gap-2">
          {locked ? (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Lock className="h-3 w-3" /> Signed — locked
            </Badge>
          ) : dirty ? (
            <Button size="sm" variant="secondary" className="h-7" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        {bullets.map((b, i) => (
          <div key={i} className="flex gap-2 items-start">
            <Badge variant="outline" className="text-[10px] shrink-0 mt-1.5 max-w-[45%] truncate">
              {b.speaker}
            </Badge>
            <Textarea
              value={b.text}
              rows={2}
              disabled={locked}
              className="text-sm min-h-0"
              onChange={(e) => {
                setBullets(bullets.map((x, xi) => (xi === i ? { ...x, text: e.target.value } : x)));
                setDirty(true);
              }}
            />
          </div>
        ))}
      </div>

      {transcriptAccess !== "none" && (
      <Collapsible
        open={transcriptOpen}
        onOpenChange={(open) => { setTranscriptOpen(open); if (open) void loadTranscript(); }}
      >
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
            <ChevronDown className={`h-3.5 w-3.5 mr-1 transition-transform ${transcriptOpen ? "rotate-180" : ""}`} />
            {transcriptOpen ? "Hide" : "Show"} full transcript
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          {loadingTranscript ? (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading transcript…
            </p>
          ) : (
            <>
              <Textarea
                value={transcript ?? ""}
                rows={8}
                disabled={locked}
                className="text-xs font-mono"
                onChange={(e) => { setTranscript(e.target.value); setDirty(true); }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs mt-1"
                onClick={() => setTranscriptFull(true)}
              >
                <Maximize2 className="h-3.5 w-3.5 mr-1" />
                Open full view
              </Button>
            </>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">
            Word-for-word transcript. {transcriptAccess === "admin" ? "Admins only." : "Managers only."} Audio was never saved.
          </p>
        </CollapsibleContent>
      </Collapsible>
      )}

      {transcriptAccess !== "none" && (
        <Dialog open={transcriptFull} onOpenChange={setTranscriptFull}>
          <DialogContent className="max-w-3xl h-[90vh] flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>Full transcript</DialogTitle>
              <DialogDescription>
                Word-for-word. {transcriptAccess === "admin" ? "Admins only." : "Managers only."} Audio was never saved.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={transcript ?? ""}
              disabled={locked}
              className="flex-1 min-h-0 resize-none text-sm font-mono leading-relaxed"
              onChange={(e) => { setTranscript(e.target.value); setDirty(true); }}
            />
            <DialogFooter className="gap-2">
              {!locked && dirty && (
                <Button variant="secondary" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  Save
                </Button>
              )}
              <Button variant="outline" onClick={() => setTranscriptFull(false)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
