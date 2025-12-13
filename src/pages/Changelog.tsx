import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Sparkles, Bug, Wrench, FileText, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { format } from 'date-fns';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface ChangelogEntry {
  id: string;
  entry_date: string;
  entry_type: 'feature' | 'fix' | 'improvement' | 'other';
  title: string;
  description: string | null;
  created_at: string;
}

const entryTypeConfig = {
  feature: { icon: Sparkles, label: 'Feature', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
  fix: { icon: Bug, label: 'Fix', className: 'bg-red-500/10 text-red-500 border-red-500/20' },
  improvement: { icon: Wrench, label: 'Improvement', className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  other: { icon: FileText, label: 'Other', className: 'bg-muted text-muted-foreground border-muted' },
};

export default function Changelog() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useUserRole();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newEntry, setNewEntry] = useState({
    entry_type: 'feature' as 'feature' | 'fix' | 'improvement' | 'other',
    title: '',
    description: '',
  });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['changelog-entries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('changelog_entries')
        .select('*')
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ChangelogEntry[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (entry: { entry_type: string; title: string; description: string }) => {
      const { error } = await supabase.from('changelog_entries').insert({
        entry_type: entry.entry_type,
        title: entry.title,
        description: entry.description || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['changelog-entries'] });
      setAddDialogOpen(false);
      setNewEntry({ entry_type: 'feature', title: '', description: '' });
      toast.success('Entry added');
    },
    onError: () => toast.error('Failed to add entry'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('changelog_entries').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['changelog-entries'] });
      toast.success('Entry deleted');
    },
    onError: () => toast.error('Failed to delete entry'),
  });

  // Group entries by date
  const entriesByDate = entries.reduce((acc, entry) => {
    const date = entry.entry_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(entry);
    return acc;
  }, {} as Record<string, ChangelogEntry[]>);

  if (!isSuperAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Access denied</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Changelog</h1>
              <p className="text-muted-foreground">Track features, fixes, and improvements</p>
            </div>
          </div>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Entry
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : Object.keys(entriesByDate).length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No changelog entries yet
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(entriesByDate).map(([date, dateEntries]) => (
              <Card key={date}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {format(new Date(date + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {dateEntries.map((entry) => {
                    const config = entryTypeConfig[entry.entry_type];
                    const Icon = config.icon;
                    return (
                      <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                        <Badge variant="outline" className={`${config.className} shrink-0`}>
                          <Icon className="h-3 w-3 mr-1" />
                          {config.label}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium">{entry.title}</p>
                          {entry.description && (
                            <p className="text-sm text-muted-foreground mt-1">{entry.description}</p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => {
                            if (confirm('Delete this entry?')) {
                              deleteMutation.mutate(entry.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Changelog Entry</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={newEntry.entry_type}
                  onValueChange={(value: any) => setNewEntry({ ...newEntry, entry_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feature">Feature</SelectItem>
                    <SelectItem value="fix">Fix</SelectItem>
                    <SelectItem value="improvement">Improvement</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={newEntry.title}
                  onChange={(e) => setNewEntry({ ...newEntry, title: e.target.value })}
                  placeholder="Brief summary"
                />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Textarea
                  value={newEntry.description}
                  onChange={(e) => setNewEntry({ ...newEntry, description: e.target.value })}
                  placeholder="Additional details..."
                  rows={3}
                />
              </div>
              <Button
                className="w-full"
                disabled={!newEntry.title.trim() || addMutation.isPending}
                onClick={() => addMutation.mutate(newEntry)}
              >
                {addMutation.isPending ? 'Adding...' : 'Add Entry'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
