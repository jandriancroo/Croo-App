import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Mic, Square, Loader2, ChevronDown, Trash2, AlertTriangle } from "lucide-react";
import { useConversationRecorder, MAX_RECORDING_SECONDS, type NoteBullet } from "@/hooks/useConversationRecorder";
import { toast } from "sonner";

export interface RecordingResult {
  transcript: string;
  bullets: NoteBullet[];
  consentConfirmedAt: string | null;
  durationSeconds: number;
  sttModel: "mini" | "standard" | null;
}

interface Props {
  employeeId: string | null;
  employeeName: string;
  managerName: string;
  value: RecordingResult | null;
  onChange: (value: RecordingResult | null) => void;
  locked?: boolean;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function CorrectiveActionRecorder({
  employeeId, employeeName, managerName, value, onChange, locked,
}: Props) {
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [consentAt, setConsentAt] = useState<string | null>(null);

  const rec = useConversationRecorder({ managerName, employeeName: employeeName || "Employee" });

  // Push results up as soon as the pipeline finishes, and on every edit.
  useEffect(() => {
    if (rec.status === "done") {
      onChange({
        transcript: rec.transcript,
        bullets: rec.bullets,
        consentConfirmedAt: consentAt,
        durationSeconds: rec.durationSeconds,
        sttModel: rec.sttModel,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.status, rec.transcript, rec.bullets, rec.sttModel, consentAt]);

  useEffect(() => {
    if (rec.autoStopped && rec.status === "processing") {
      toast.info("Recording stopped — keeping what was captured.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.autoStopped]);

  const beginConsent = () => {
    if (!employeeId) {
      toast.error("Pick the employee first, then record.");
      return;
    }
    setConsentChecked(false);
    setConsentOpen(true);
  };

  const confirmConsentAndRecord = async () => {
    const stamp = new Date().toISOString();
    setConsentAt(stamp);
    setConsentOpen(false);
    const ok = await rec.start();
    if (!ok) setConsentAt(null);
  };

  const discard = () => {
    rec.reset();
    setConsentAt(null);
    setTranscriptOpen(false);
    onChange(null);
  };

  const updateBulletText = (index: number, text: string) => {
    const next = rec.bullets.map((b, i) => (i === index ? { ...b, text } : b));
    rec.setBullets(next);
  };

  const hasResult = rec.status === "done" && (rec.transcript || rec.bullets.length > 0);

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Mic className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium">Record the conversation</span>
          <Badge variant="outline" className="text-[10px]">Optional</Badge>
        </div>

        {!locked && rec.status === "idle" && (
          <Button size="sm" variant="outline" onClick={beginConsent} disabled={!employeeId}>
            <Mic className="h-4 w-4 mr-1" />
            Record
          </Button>
        )}

        {rec.isRecording && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm font-mono">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
              {fmt(rec.elapsed)}
            </span>
            <Button size="sm" variant="destructive" onClick={rec.stop}>
              <Square className="h-3.5 w-3.5 mr-1" />
              Stop
            </Button>
          </div>
        )}

        {rec.status === "processing" && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Writing notes…
          </span>
        )}

        {(hasResult || rec.status === "error") && !locked && (
          <Button size="sm" variant="ghost" onClick={discard}>
            <Trash2 className="h-4 w-4 mr-1" />
            Discard
          </Button>
        )}
      </div>

      {rec.isRecording && (
        <p className="text-xs text-muted-foreground">
          Stops automatically at {fmt(MAX_RECORDING_SECONDS)}. Audio is deleted right after it is turned into text.
        </p>
      )}

      {!employeeId && rec.status === "idle" && (
        <p className="text-xs text-muted-foreground">Select the employee above to enable recording.</p>
      )}

      {rec.error && (
        <p className="text-xs text-amber-600 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {rec.error}
        </p>
      )}

      {hasResult && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-[10px]">
              {fmt(rec.durationSeconds)} recorded
            </Badge>
            {rec.sttModel && (
              <Badge variant="outline" className="text-[10px]">
                {rec.sttModel === "mini" ? "Standard transcription" : "High-accuracy transcription"}
              </Badge>
            )}
            {consentAt && <span>Employee told before recording</span>}
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Notes</Label>
            {rec.bullets.length === 0 && (
              <p className="text-xs text-muted-foreground">No bullets were generated — edit the transcript or type notes below.</p>
            )}
            {rec.bullets.map((b, i) => (
              <div key={i} className="flex gap-2 items-start">
                <Badge variant="outline" className="text-[10px] shrink-0 mt-1.5 max-w-[45%] truncate">
                  {b.speaker}
                </Badge>
                <Textarea
                  value={b.text}
                  onChange={(e) => updateBulletText(i, e.target.value)}
                  disabled={locked}
                  rows={2}
                  className="text-sm min-h-0"
                />
              </div>
            ))}
          </div>

          <Collapsible open={transcriptOpen} onOpenChange={setTranscriptOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                <ChevronDown className={`h-3.5 w-3.5 mr-1 transition-transform ${transcriptOpen ? "rotate-180" : ""}`} />
                {transcriptOpen ? "Hide" : "Show"} full transcript
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <Textarea
                value={rec.transcript}
                onChange={(e) => rec.setTranscript(e.target.value)}
                disabled={locked}
                rows={8}
                className="text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Word-for-word transcript. Managers only — the employee's copy shows the notes.
              </p>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* Per-recording consent gate */}
      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Before you record</DialogTitle>
            <DialogDescription>
              Say this out loud to {employeeName || "the employee"}:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm bg-muted/50 p-3 rounded-lg italic">
              "I'm recording this conversation so I can take accurate notes. Are you okay with that?"
            </p>
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={consentChecked} onCheckedChange={(c) => setConsentChecked(!!c)} className="mt-0.5" />
              <span className="text-sm">
                I told {employeeName || "the employee"} this is being recorded and they agreed.
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              The audio is deleted as soon as it becomes text. Nothing is kept as a sound file.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsentOpen(false)}>Cancel</Button>
            <Button onClick={confirmConsentAndRecord} disabled={!consentChecked}>
              <Mic className="h-4 w-4 mr-1" />
              Start recording
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
