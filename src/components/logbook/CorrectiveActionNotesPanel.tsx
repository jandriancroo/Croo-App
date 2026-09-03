import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Loader2, Save, Lock } from "lucide-react";
import { toast } from "sonner";
import type { NoteBullet } from "@/hooks/useConversationRecorder";

interface Props {
  writeUpId: string;
  notesBullets?: NoteBullet[] | null;
  signedAt?: string | null;
  recordingDurationSeconds?: number | null;
}

/**
 * Saved-record view of a recorded Corrective Action conversation.
 * Bullets show by default; the verbatim transcript is collapsed and only
 * fetched through the manager-tier RPC when expanded.
 * Both stay editable until the employee signs (signed_at).
 */
export function CorrectiveActionNotesPanel({
  writeUpId, notesBullets, signedAt, recordingDurationSeconds,
}: Props) {
  const queryClient = useQueryClient();
  const locked = !!signedAt;
  const [bullets, setBullets] = useState<NoteBullet[]>(notesBullets || []);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setBullets(notesBullets || []); }, [notesBullets]);

  const loadTranscript = async () => {
    if (transcript !== null || loadingTranscript) return;
    setLoadingTranscript(true);
    const { data, error } = await supabase.rpc("get_corrective_action_transcript", {
      _writeup_id: writeUpId,
    });
    setLoadingTranscript(false);
    if (error) {
      toast.error("You don't have access to the transcript.");
      return;
    }
    setTranscript((data as string) || "");
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
            <Textarea
              value={transcript ?? ""}
              rows={8}
              disabled={locked}
              className="text-xs font-mono"
              onChange={(e) => { setTranscript(e.target.value); setDirty(true); }}
            />
          )}
          <p className="text-[10px] text-muted-foreground mt-1">
            Word-for-word transcript. Managers only. Audio was never saved.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
