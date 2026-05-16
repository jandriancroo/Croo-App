import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { getDisplayName } from "@/utils/displayName";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, X, Clock, Pencil, Trash2, ChevronDown } from "lucide-react";
import type { AvailabilityRequest } from "@/hooks/useAvailabilityData";

interface AvailabilityRequestCardProps {
  request: AvailabilityRequest;
  canApproveRequests: boolean;
  userId: string | undefined;
  formatTimeScope: (r: AvailabilityRequest) => string;
  formatDayOfWeek: (r: AvailabilityRequest) => string;
  formatRequestedDate: (createdAt: string) => string;
  onSetStatus: (requestId: string, status: string) => void;
  onEdit: (request: AvailabilityRequest) => void;
  onEmployeeEdit: (request: AvailabilityRequest) => void;
  onDelete: (requestId: string) => void;
}

export function AvailabilityRequestCard({
  request,
  canApproveRequests,
  userId,
  formatTimeScope,
  formatDayOfWeek,
  formatRequestedDate,
  onSetStatus,
  onEdit,
  onEmployeeEdit,
  onDelete,
}: AvailabilityRequestCardProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const statusLabel = request.status.charAt(0).toUpperCase() + request.status.slice(1);
  const noteText = (request.notes || "").trim();
  const NOTE_PREVIEW_LIMIT = 40;
  const noteIsLong = noteText.length > NOTE_PREVIEW_LIMIT;
  const notePreview = noteIsLong ? `${noteText.slice(0, NOTE_PREVIEW_LIMIT).trim()}…` : noteText;

  const StatusButton = (
    <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer hover:opacity-80 ${
      request.status === "approved"
        ? "bg-primary text-primary-foreground"
        : request.status === "denied"
        ? "bg-destructive text-destructive-foreground"
        : "border border-input bg-background hover:bg-accent"
    }`}>
      {statusLabel}
      <ChevronDown className="h-3 w-3 opacity-60" />
    </div>
  );

  const StatusDropdownItems = canApproveRequests ? (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
        Set Status
      </DropdownMenuLabel>
      {request.status !== "pending" && (
        <DropdownMenuItem onClick={() => onSetStatus(request.id, "pending")} className="gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span>Pending</span>
        </DropdownMenuItem>
      )}
      {request.status !== "approved" && (
        <DropdownMenuItem onClick={() => onSetStatus(request.id, "approved")} className="gap-2">
          <Check className="h-4 w-4 text-green-500" />
          <span>Approved</span>
        </DropdownMenuItem>
      )}
      {request.status !== "denied" && (
        <DropdownMenuItem onClick={() => onSetStatus(request.id, "denied")} className="gap-2">
          <X className="h-4 w-4 text-destructive" />
          <span>Denied</span>
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onEdit(request)} className="gap-2">
        <Pencil className="h-4 w-4 text-muted-foreground" />
        <span>Edit Request</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => onDelete(request.id)}
        className="gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
      >
        <Trash2 className="h-4 w-4" />
        <span>Delete</span>
      </DropdownMenuItem>
    </>
  ) : (
    request.user_id === userId && request.status === "pending" ? (
      <>
        <DropdownMenuItem onClick={() => onEmployeeEdit(request)} className="gap-2">
          <Pencil className="h-4 w-4 text-muted-foreground" />
          <span>Edit Request</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onDelete(request.id)}
          className="gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
          <span>Delete</span>
        </DropdownMenuItem>
      </>
    ) : null
  );

  const NoteCell = noteText ? (
    noteIsLong ? (
      <button
        type="button"
        onClick={() => setNotesOpen(true)}
        className="text-sm text-muted-foreground italic text-left hover:text-foreground transition-colors line-clamp-2 underline-offset-2 hover:underline"
        title="Click to read full reason"
      >
        "{notePreview}"
      </button>
    ) : (
      <span className="text-sm text-muted-foreground italic line-clamp-2">"{notePreview}"</span>
    )
  ) : (
    <span className="text-xs text-muted-foreground/50">—</span>
  );

  return (
    <>
    <div className="flex border rounded-lg overflow-hidden hover:border-primary/30 transition-colors">
      {/* Left: Requested date */}
      <div className="w-24 shrink-0 bg-muted/30 p-3 flex flex-col items-center justify-center border-r text-center">
        <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide font-medium">
          Requested
        </div>
        <div className="text-sm font-medium mt-0.5">
          {formatRequestedDate(request.created_at)}
        </div>
      </div>

      {/* Right: Main content */}
      <div className="flex-1 p-3 min-w-0">
        {/* Mobile layout */}
        <div className="md:hidden">
          <div className="font-medium truncate">
            {canApproveRequests ? getDisplayName(request.profiles.full_name, request.profiles.nickname) : "You"}
          </div>
          <div className="mt-1">
            <div className="text-xs text-muted-foreground font-medium">
              {formatDayOfWeek(request)}
            </div>
            <div className="font-semibold text-primary flex items-baseline gap-2 flex-wrap">
              <span>{formatTimeScope(request)}</span>
              <span className="text-foreground">• {request.hours_requested}h</span>
            </div>
          </div>
          {noteText && (
            <div className="mt-2">{NoteCell}</div>
          )}
          <div className="flex items-center justify-between mt-2">
            <Badge
              variant={request.request_type === "paid" ? "default" : "secondary"}
              className="text-xs px-2 py-0.5"
            >
              {request.request_type === "paid" ? "Paid" : "Unpaid"}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md">
                  {StatusButton}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {StatusDropdownItems}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tablet+ layout */}
        <div className="hidden md:flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0 flex flex-row items-center gap-4">
            <div className="font-medium truncate w-32 lg:w-48 shrink-0">
              {canApproveRequests ? getDisplayName(request.profiles.full_name, request.profiles.nickname) : "You"}
            </div>
            <div className="font-semibold text-primary w-56 lg:w-72 shrink-0">
              <div className="text-xs text-muted-foreground font-medium mb-0.5">
                {formatDayOfWeek(request)}
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span>{formatTimeScope(request)}</span>
                <span className="text-foreground">• {request.hours_requested}h</span>
              </div>
            </div>
            <div className="hidden lg:flex flex-1 min-w-0 pr-2">
              {NoteCell}
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground shrink-0">
              <Badge
                variant={request.request_type === "paid" ? "default" : "secondary"}
                className="text-xs px-2 py-0.5"
              >
                {request.request_type === "paid" ? "Paid" : "Unpaid"}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md">
                  {StatusButton}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {StatusDropdownItems}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>

    <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Reason</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-foreground whitespace-pre-wrap">{noteText}</p>
      </DialogContent>
    </Dialog>
    </>
  );
}
