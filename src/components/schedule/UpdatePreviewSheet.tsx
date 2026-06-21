import { useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Minus, Clock, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Profile {
  id: string;
  full_name: string;
  nickname?: string | null;
  profile_photo_url: string | null;
}

interface ShiftLike {
  id: string;
  user_id: string | null;
  start_time: string | null;
  end_time: string | null;
  shift_date: string | null;
  day_of_week: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publishedSnapshot: ShiftLike[];
  currentShifts: ShiftLike[];
  profiles: Profile[];
  onConfirm: () => void | Promise<void>;
  isSending?: boolean;
}

type ChangeType = "added" | "removed" | "time_changed" | "date_changed" | "reassigned_to" | "reassigned_from";

interface PersonChange {
  type: ChangeType;
  oldShift: ShiftLike | null;
  newShift: ShiftLike | null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const fmtTime = (t: string | null) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "p" : "a";
  const hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ampm}` : `${hh}${ampm}`;
};

const dayLabel = (s: ShiftLike) => {
  if (s.shift_date) {
    const d = new Date(s.shift_date + "T00:00:00");
    return DAYS[d.getDay()];
  }
  return typeof s.day_of_week === "number" ? DAYS[(s.day_of_week + 1) % 7] : "";
};

const shiftLabel = (s: ShiftLike) =>
  `${dayLabel(s)} ${fmtTime(s.start_time)}–${fmtTime(s.end_time)}`.trim();

function getInitials(p?: Profile | null) {
  if (!p) return "—";
  const name = p.nickname || p.full_name || "?";
  return name.split(" ").map(n => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export function UpdatePreviewSheet({
  open,
  onOpenChange,
  publishedSnapshot,
  currentShifts,
  profiles,
  onConfirm,
  isSending,
}: Props) {
  const { byUser, totalChanges, affectedCount } = useMemo(() => {
    const oldMap = new Map(publishedSnapshot.map(s => [s.id, s]));
    const newMap = new Map(currentShifts.map(s => [s.id, s]));
    const grouped = new Map<string, PersonChange[]>();
    const push = (uid: string | null, c: PersonChange) => {
      const key = uid || "__unassigned__";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    };

    // removed
    publishedSnapshot.forEach(o => {
      if (!newMap.has(o.id)) push(o.user_id, { type: "removed", oldShift: o, newShift: null });
    });
    // added / modified
    currentShifts.forEach(n => {
      const o = oldMap.get(n.id);
      if (!o) {
        push(n.user_id, { type: "added", oldShift: null, newShift: n });
      } else {
        if (o.user_id !== n.user_id) {
          if (o.user_id) push(o.user_id, { type: "reassigned_from", oldShift: o, newShift: n });
          if (n.user_id) push(n.user_id, { type: "reassigned_to", oldShift: o, newShift: n });
        } else if (o.start_time !== n.start_time || o.end_time !== n.end_time) {
          push(n.user_id, { type: "time_changed", oldShift: o, newShift: n });
        } else if (o.shift_date !== n.shift_date || o.day_of_week !== n.day_of_week) {
          push(n.user_id, { type: "date_changed", oldShift: o, newShift: n });
        }
      }
    });

    const total = Array.from(grouped.values()).reduce((sum, list) => sum + list.length, 0);
    const affected = Array.from(grouped.keys()).filter(k => k !== "__unassigned__").length;
    return { byUser: grouped, totalChanges: total, affectedCount: affected };
  }, [publishedSnapshot, currentShifts]);

  const profileById = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach(p => m.set(p.id, p));
    return m;
  }, [profiles]);

  const entries = Array.from(byUser.entries()).sort(([a], [b]) => {
    if (a === "__unassigned__") return 1;
    if (b === "__unassigned__") return -1;
    const an = profileById.get(a)?.full_name || "";
    const bn = profileById.get(b)?.full_name || "";
    return an.localeCompare(bn);
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl max-h-[92vh] overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-lg sm:mx-auto"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">Send schedule update?</SheetTitle>
          <SheetDescription className="text-xs">
            {totalChanges === 0
              ? "No pending changes to send."
              : <>Preview <b>{totalChanges}</b> change{totalChanges === 1 ? "" : "s"} affecting <b>{affectedCount}</b> team member{affectedCount === 1 ? "" : "s"}. They'll get a push notification when you send.</>}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 pt-2 max-h-[55vh] overflow-y-auto pr-1">
          {entries.map(([uid, changes]) => {
            const profile = uid === "__unassigned__" ? null : profileById.get(uid);
            return (
              <div key={uid} className="rounded-xl border border-border/50 bg-card p-3">
                <div className="flex items-center gap-2.5 mb-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    {profile?.profile_photo_url && <AvatarImage src={profile.profile_photo_url} />}
                    <AvatarFallback className="text-xs">{getInitials(profile)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {profile ? (profile.nickname || profile.full_name) : "Unassigned"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {changes.length} change{changes.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5 pl-1">
                  {changes.map((c, i) => <ChangeRow key={i} change={c} />)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 pt-3">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={isSending}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={() => onConfirm()}
            disabled={isSending || totalChanges === 0}
          >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {totalChanges === 0 ? "Nothing to send" : `Send to ${affectedCount}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ChangeRow({ change }: { change: PersonChange }) {
  const { type, oldShift, newShift } = change;
  const config = {
    added:           { icon: Plus,  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", label: "Added" },
    removed:         { icon: Minus, color: "text-destructive",                       bg: "bg-destructive/10", label: "Removed" },
    time_changed:    { icon: Clock, color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-500/10",   label: "Time" },
    date_changed:    { icon: Clock, color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-500/10",   label: "Day" },
    reassigned_to:   { icon: Plus,  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", label: "Reassigned in" },
    reassigned_from: { icon: Minus, color: "text-destructive",                       bg: "bg-destructive/10", label: "Reassigned out" },
  }[type];
  const Icon = config.icon;

  return (
    <div className="flex items-start gap-2 text-xs">
      <div className={cn("p-1 rounded shrink-0", config.bg)}>
        <Icon className={cn("h-3 w-3", config.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <Badge variant="secondary" className="text-[9px] h-4 px-1.5 mr-1.5">{config.label}</Badge>
        {type === "added" || type === "reassigned_to" ? (
          <span className="text-foreground">{newShift && shiftLabel(newShift)}</span>
        ) : type === "removed" || type === "reassigned_from" ? (
          <span className="text-muted-foreground line-through">{oldShift && shiftLabel(oldShift)}</span>
        ) : (
          <span className="text-foreground">
            <span className="text-muted-foreground line-through mr-1">{oldShift && shiftLabel(oldShift)}</span>
            → {newShift && shiftLabel(newShift)}
          </span>
        )}
      </div>
    </div>
  );
}
