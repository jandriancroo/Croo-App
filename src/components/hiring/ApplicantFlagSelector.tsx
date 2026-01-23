import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Flag, Check, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

type FlagColor = 'none' | 'green' | 'yellow' | 'red';

interface FlagOption {
  color: FlagColor;
  label: string;
  description: string;
  bgClass: string;
  dotClass: string;
  emoji: string;
}

const FLAG_OPTIONS: FlagOption[] = [
  { 
    color: 'green', 
    label: 'Strong Yes', 
    description: 'Ready to hire',
    bgClass: 'bg-green-500/20 hover:bg-green-500/30 border-green-500/50',
    dotClass: 'bg-green-500',
    emoji: '🟢'
  },
  { 
    color: 'yellow', 
    label: 'Maybe', 
    description: 'On the fence',
    bgClass: 'bg-yellow-500/20 hover:bg-yellow-500/30 border-yellow-500/50',
    dotClass: 'bg-yellow-500',
    emoji: '🟡'
  },
  { 
    color: 'red', 
    label: 'Concerns', 
    description: 'Likely not a fit',
    bgClass: 'bg-red-500/20 hover:bg-red-500/30 border-red-500/50',
    dotClass: 'bg-red-500',
    emoji: '🔴'
  },
  { 
    color: 'none', 
    label: 'Clear Flag', 
    description: 'Remove rating',
    bgClass: 'bg-muted hover:bg-muted/80 border-muted-foreground/20',
    dotClass: 'bg-muted-foreground/30',
    emoji: '⚪'
  },
];

interface ApplicantFlagSelectorProps {
  applicationId: string;
  compact?: boolean; // For list view - shows just the dot
}

export function ApplicantFlagSelector({ applicationId, compact = false }: ApplicantFlagSelectorProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState<FlagColor | null>(null);
  const [reason, setReason] = useState('');

  // Fetch current flag
  const { data: currentFlag, isLoading: flagLoading } = useQuery({
    queryKey: ['applicant-flag', applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('applicant_current_flags')
        .select('*')
        .eq('application_id', applicationId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!applicationId,
  });

  // Set flag mutation - also creates a note in applicant_notes
  const setFlagMutation = useMutation({
    mutationFn: async ({ color, flagReason }: { color: FlagColor; flagReason: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get user's name
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      const userName = profile?.full_name || 'Unknown';
      const flagOption = FLAG_OPTIONS.find(f => f.color === color);
      const timestamp = format(new Date(), 'MMM d, yyyy \'at\' h:mm a');

      // Build the note entry
      let noteEntry = `${flagOption?.emoji} **${flagOption?.label}**`;
      if (flagReason) {
        noteEntry += ` — "${flagReason}"`;
      }
      noteEntry += ` — *${userName}, ${timestamp}*`;

      // Insert the flag
      const { error: flagError } = await supabase
        .from('applicant_flags')
        .insert({
          application_id: applicationId,
          flag_color: color,
          reason: flagReason || null,
          set_by: user.id,
        });

      if (flagError) throw flagError;

      // Insert a note into applicant_notes
      const { error: noteError } = await supabase
        .from('applicant_notes')
        .insert({
          application_id: applicationId,
          note: noteEntry,
          created_by: user.id,
        });

      if (noteError) throw noteError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applicant-flag', applicationId] });
      queryClient.invalidateQueries({ queryKey: ['applicant-notes', applicationId] });
      queryClient.invalidateQueries({ queryKey: ['job-applications'] });
      toast.success('Flag updated');
      setOpen(false);
      setSelectedColor(null);
      setReason('');
    },
    onError: () => {
      toast.error('Failed to update flag');
    },
  });

  const handleColorSelect = (color: FlagColor) => {
    setSelectedColor(color);
    setReason('');
  };

  const handleSaveFlag = () => {
    if (!selectedColor) return;
    setFlagMutation.mutate({ color: selectedColor, flagReason: reason });
  };

  const currentFlagOption = FLAG_OPTIONS.find(f => f.color === currentFlag?.flag_color);

  // Compact view for list - just the colored dot
  if (compact) {
    if (flagLoading) return null;
    if (!currentFlag || currentFlag.flag_color === 'none') return null;
    
    const dotOption = FLAG_OPTIONS.find(f => f.color === currentFlag.flag_color);
    if (!dotOption) return null;

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button 
            className={cn(
              "w-3 h-3 rounded-full shrink-0 cursor-pointer transition-transform hover:scale-125",
              dotOption.dotClass
            )}
            onClick={(e) => e.stopPropagation()}
            title={`${dotOption.label}: ${currentFlag.reason || 'No reason given'}`}
          />
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={cn("w-3 h-3 rounded-full", dotOption.dotClass)} />
              <span className="font-medium text-sm">{dotOption.label}</span>
            </div>
            {currentFlag.reason && (
              <p className="text-sm text-muted-foreground">{currentFlag.reason}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {format(new Date(currentFlag.created_at), 'MMM d, yyyy h:mm a')}
            </p>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Full view for profile dialog - styled as a badge/tag
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button 
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer border",
            currentFlagOption && currentFlagOption.color !== 'none' 
              ? currentFlagOption.bgClass
              : "bg-muted hover:bg-muted/80 border-muted-foreground/20 text-muted-foreground"
          )}
        >
          {currentFlagOption && currentFlagOption.color !== 'none' ? (
            <div className={cn("w-2.5 h-2.5 rounded-full", currentFlagOption.dotClass)} />
          ) : (
            <Flag className="h-3 w-3" />
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        {!selectedColor ? (
          <div className="p-2 space-y-1">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Set Interview Rating
            </div>
            {FLAG_OPTIONS.map((option) => (
              <button
                key={option.color}
                onClick={() => handleColorSelect(option.color)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors border",
                  option.bgClass
                )}
              >
                <div className={cn("w-4 h-4 rounded-full shrink-0", option.dotClass)} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{option.label}</div>
                  <div className="text-xs text-muted-foreground">{option.description}</div>
                </div>
                {currentFlag?.flag_color === option.color && (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedColor(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                ←
              </button>
              <div className={cn("w-4 h-4 rounded-full", FLAG_OPTIONS.find(f => f.color === selectedColor)?.dotClass)} />
              <span className="font-medium">
                {FLAG_OPTIONS.find(f => f.color === selectedColor)?.label}
              </span>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">
                Why this rating? (optional)
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Great attitude but limited availability..."
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedColor(null)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveFlag}
                disabled={setFlagMutation.isPending}
                className="flex-1"
              >
                {setFlagMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Export the dot component for use in list views
export function ApplicantFlagDot({ applicationId }: { applicationId: string }) {
  return <ApplicantFlagSelector applicationId={applicationId} compact />;
}
