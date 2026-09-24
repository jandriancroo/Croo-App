import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Copy, MapPin, Phone, Video } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { isValidMeetingUrl, MODALITY_LABEL, type InterviewModality } from '@/lib/hiring/interviewActions';

/** Staff-facing badge for how the interview happens. Reads job_applications.interview_modality. */
export function InterviewModalityBadge({ modality, className }: { modality?: string | null; className?: string }) {
  const m = (modality || 'in_person') as InterviewModality;
  const Icon = m === 'virtual' ? Video : m === 'phone' ? Phone : MapPin;
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] px-1.5 py-0 gap-1',
        m === 'phone' && 'border-primary/40 text-primary',
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {m === 'phone' ? 'Phone · you call' : MODALITY_LABEL[m] || 'In person'}
    </Badge>
  );
}

/** Join + Copy for virtual interviews. Renders nothing unless the link is a valid https URL. */
export function InterviewJoinLink({
  url,
  size = 'sm',
  compact = false,
}: {
  url?: string | null;
  size?: 'sm' | 'default';
  compact?: boolean;
}) {
  if (!isValidMeetingUrl(url)) return null;
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url!);
    toast.success('Meeting link copied');
  };
  if (compact) {
    return (
      <a
        href={url!}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-primary font-medium hover:underline"
      >
        <Video className="h-3 w-3" /> Join
      </a>
    );
  }
  return (
    <div className="flex gap-2">
      <Button asChild size={size} className="min-h-[40px]">
        <a href={url!} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <Video className="h-4 w-4 mr-1" /> Join meeting
        </a>
      </Button>
      <Button size={size} variant="outline" className="min-h-[40px]" onClick={copy}>
        <Copy className="h-4 w-4 mr-1" /> Copy link
      </Button>
    </div>
  );
}
