import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface ApplicantNote {
  id: string;
  note: string;
  created_at: string;
  created_by: string | null;
  creator?: { full_name: string | null } | null;
}

interface ApplicantNotesSectionProps {
  applicationId: string;
}

export function ApplicantNotesSection({ applicationId }: ApplicantNotesSectionProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [newNote, setNewNote] = useState('');

  // Fetch notes
  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['applicant-notes', applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('applicant_notes')
        .select('*')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Fetch creator names separately
      const creatorIds = [...new Set((data || []).map(n => n.created_by).filter(Boolean))];
      let creatorMap: Record<string, string> = {};
      
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', creatorIds);
        
        creatorMap = (profiles || []).reduce((acc, p) => {
          acc[p.id] = p.full_name || 'Unknown';
          return acc;
        }, {} as Record<string, string>);
      }

      return (data || []).map(note => ({
        ...note,
        creator: note.created_by ? { full_name: creatorMap[note.created_by] || 'Unknown' } : null,
      })) as ApplicantNote[];
    },
    enabled: !!applicationId,
  });

  // Add note mutation
  const addNoteMutation = useMutation({
    mutationFn: async (noteText: string) => {
      const { error } = await supabase
        .from('applicant_notes')
        .insert({
          application_id: applicationId,
          note: noteText,
          created_by: user?.id,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applicant-notes', applicationId] });
      setNewNote('');
      toast.success('Note added');
    },
    onError: () => {
      toast.error('Failed to add note');
    },
  });

  // Delete note mutation
  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await supabase
        .from('applicant_notes')
        .delete()
        .eq('id', noteId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applicant-notes', applicationId] });
      toast.success('Note deleted');
    },
    onError: () => {
      toast.error('Failed to delete note');
    },
  });

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    addNoteMutation.mutate(newNote.trim());
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add new note */}
        <div className="space-y-2">
          <Textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note about this applicant..."
            rows={2}
            className="resize-none"
          />
          <Button
            size="sm"
            onClick={handleAddNote}
            disabled={!newNote.trim() || addNoteMutation.isPending}
          >
            {addNoteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add Note
          </Button>
        </div>

        {/* Notes list */}
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No notes yet
          </p>
        ) : (
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {notes.map((note) => (
              <div
                key={note.id}
                className="group relative bg-muted/50 rounded-lg p-3 text-sm"
              >
                <p className="whitespace-pre-wrap pr-6">{note.note}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {note.creator?.full_name || 'Unknown'} • {format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}
                </p>
                {note.created_by === user?.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => deleteNoteMutation.mutate(note.id)}
                    disabled={deleteNoteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
