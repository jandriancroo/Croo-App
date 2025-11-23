import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ClipboardList, Calendar, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface Checklist {
  id: string;
  title: string;
  description: string | null;
  frequency: string;
  created_at: string;
}

export default function Dashboard() {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchChecklists();
  }, []);

  const fetchChecklists = async () => {
    try {
      const { data, error } = await supabase
        .from('checklists')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setChecklists(data || []);
    } catch (error: any) {
      toast.error('Failed to load checklists');
    } finally {
      setLoading(false);
    }
  };

  const getFrequencyColor = (frequency: string) => {
    switch (frequency) {
      case 'daily':
        return 'bg-accent';
      case 'weekly':
        return 'bg-primary';
      case 'monthly':
        return 'bg-secondary';
      default:
        return 'bg-muted';
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold">Dashboard</h2>
            <p className="text-muted-foreground">Manage your line check checklists</p>
          </div>
          <Button onClick={() => navigate('/create')} className="gap-2">
            <Plus className="h-4 w-4" />
            New Checklist
          </Button>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground">Loading checklists...</div>
        ) : checklists.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No checklists yet</h3>
              <p className="text-muted-foreground mb-4">Create your first checklist to get started</p>
              <Button onClick={() => navigate('/create')}>Create Checklist</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {checklists.map((checklist) => (
              <Card key={checklist.id} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate(`/complete/${checklist.id}`)}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <ClipboardList className="h-8 w-8 text-primary" />
                    <Badge className={getFrequencyColor(checklist.frequency)}>
                      {checklist.frequency}
                    </Badge>
                  </div>
                  <CardTitle className="mt-4">{checklist.title}</CardTitle>
                  {checklist.description && (
                    <CardDescription>{checklist.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>
                      Created {new Date(checklist.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
