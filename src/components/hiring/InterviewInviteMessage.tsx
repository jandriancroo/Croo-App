import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CalendarCheck, Check, X, Loader2, CalendarX, RefreshCw, Video, Phone, MapPin, Copy, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

interface InterviewData {
  date: string;
  time: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'reschedule_requested';
  modality?: 'in_person' | 'virtual' | 'phone';
  meeting_url?: string;
}

export type InterviewResponse = 'accept' | 'decline' | 'reschedule';

interface InterviewInviteMessageProps {
  content: string;
  isApplicantView: boolean;
  onRespond?: (response: InterviewResponse) => void;
  onCancel?: () => void;
  onReschedule?: () => void;
  responding?: boolean;
}

export function InterviewInviteMessage({ 
  content, 
  isApplicantView,
  onRespond,
  onCancel,
  onReschedule,
  responding = false
}: InterviewInviteMessageProps) {
  // Parse the interview data from content
  const jsonStr = content.replace('INTERVIEW_INVITE:', '');
  let data: InterviewData;
  
  try {
    data = JSON.parse(jsonStr);
  } catch {
    return <span className="text-sm">Invalid interview invitation</span>;
  }

  const formatTime12h = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const hour12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  const interviewDate = parseISO(data.date);
  const isPast = new Date() > interviewDate;
  const canModify = !isPast && data.status !== 'cancelled' && data.status !== 'declined';
  const modality = data.modality || 'in_person';
  let safeUrl: string | null = null;
  if (modality === 'virtual' && data.meeting_url) {
    try {
      const u = new URL(data.meeting_url);
      if (u.protocol === 'https:') safeUrl = u.toString();
    } catch { /* ignore */ }
  }
  const showJoin = safeUrl && data.status !== 'cancelled' && data.status !== 'declined';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CalendarCheck className="h-4 w-4" />
        Interview Invitation
      </div>
      
      <div className={cn(
        "bg-background/50 rounded-lg p-3 space-y-2",
        data.status === 'accepted' && "ring-1 ring-green-500/50",
        data.status === 'declined' && "ring-1 ring-red-500/50",
        data.status === 'cancelled' && "ring-1 ring-muted-foreground/30 opacity-60"
      )}>
        <div className={cn("text-center", data.status === 'cancelled' && "line-through opacity-60")}>
          <p className="font-semibold">
            {format(interviewDate, 'EEEE, MMMM d, yyyy')}
          </p>
          <p className="text-lg font-bold text-primary">
            {formatTime12h(data.time)}
          </p>
          <p className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
            {modality === 'virtual' ? <Video className="h-3 w-3" /> : modality === 'phone' ? <Phone className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
            {modality === 'virtual'
              ? 'Virtual interview'
              : modality === 'phone'
                ? (isApplicantView ? 'Phone interview — a manager will reach out by phone' : 'Phone — you call the applicant')
                : 'In person'}
          </p>
        </div>

        {showJoin && (
          <div className="flex gap-2">
            <Button asChild size="sm" className="flex-1 min-h-[40px]">
              <a href={safeUrl!} target="_blank" rel="noopener noreferrer">
                <Video className="h-4 w-4 mr-1" /> Join meeting
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-[40px]"
              onClick={() => { navigator.clipboard.writeText(safeUrl!); toast.success('Meeting link copied'); }}
              aria-label="Copy meeting link"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        )}

        {data.status === 'pending' && !isPast && isApplicantView && (
          <p className="text-xs text-muted-foreground text-center pt-1">
            Take your time — reply when you're ready to accept, decline, or ask to reschedule.
          </p>
        )}

        {data.status === 'pending' && !isPast && isApplicantView && onRespond && (
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              className="border-red-500/30 text-red-600 hover:bg-red-500/10"
              onClick={() => onRespond('decline')}
              disabled={responding}
            >
              {responding ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4 mr-1" />}
              Decline
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={() => onRespond('accept')}
              disabled={responding}
            >
              {responding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="col-span-2"
              onClick={() => onRespond('reschedule')}
              disabled={responding}
            >
              <CalendarClock className="h-4 w-4 mr-1" />
              Ask for a different time
            </Button>
          </div>
        )}

        {data.status === 'accepted' && (
          <Badge className="w-full justify-center bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/30">
            <Check className="h-3 w-3 mr-1" />
            Accepted
          </Badge>
        )}

        {data.status === 'declined' && (
          <Badge className="w-full justify-center bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30">
            <X className="h-3 w-3 mr-1" />
            Declined
          </Badge>
        )}

        {data.status === 'reschedule_requested' && (
          <Badge className="w-full justify-center bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30">
            <CalendarClock className="h-3 w-3 mr-1" />
            New time requested
          </Badge>
        )}

        {data.status === 'cancelled' && (
          <Badge className="w-full justify-center bg-muted text-muted-foreground">
            <CalendarX className="h-3 w-3 mr-1" />
            Cancelled
          </Badge>
        )}

        {data.status === 'pending' && isPast && (
          <Badge className="w-full justify-center" variant="secondary">
            Expired
          </Badge>
        )}

        {data.status === 'pending' && !isPast && !isApplicantView && (
          <Badge className="w-full justify-center bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30">
            Awaiting Response
          </Badge>
        )}

        {/* Manager actions - cancel/reschedule */}
        {!isApplicantView && canModify && (onCancel || onReschedule) && (
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50 mt-2">
            {onReschedule && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 px-2"
                onClick={onReschedule}
                disabled={responding}
              >
                <RefreshCw className="h-3 w-3 mr-1 shrink-0" />
                <span className="truncate">Reschedule</span>
              </Button>
            )}
            {onCancel && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 px-2 border-red-500/30 text-red-600 hover:bg-red-500/10"
                onClick={onCancel}
                disabled={responding}
              >
                <CalendarX className="h-3 w-3 mr-1 shrink-0" />
                <span className="truncate">Cancel</span>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
