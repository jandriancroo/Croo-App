import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, X, Check, Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Position {
  id: string;
  name: string;
}

interface PositionManagementInlineProps {
  organizationId?: string;
}

export function PositionManagementInline({ organizationId }: PositionManagementInlineProps) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPosition, setNewPosition] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Position | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (organizationId) fetchPositions();
  }, [organizationId]);

  const fetchPositions = async () => {
    try {
      const { data, error } = await supabase
        .from('organization_positions')
        .select('id, name')
        .eq('organization_id', organizationId!)
        .order('name');

      if (error) throw error;
      setPositions(data || []);
    } catch (error: any) {
      console.error('Error fetching positions:', error);
      toast.error('Failed to load positions');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPosition = async () => {
    const trimmed = newPosition.trim();
    if (!trimmed) {
      toast.error('Please enter a position name');
      return;
    }

    if (positions.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('Position already exists');
      return;
    }

    try {
      const { error } = await supabase
        .from('organization_positions')
        .insert({ organization_id: organizationId!, name: trimmed });

      if (error) throw error;

      toast.success(`Position "${trimmed}" added`);
      setNewPosition('');
      setAdding(false);
      fetchPositions();
    } catch (error: any) {
      console.error('Error adding position:', error);
      toast.error('Failed to add position');
    }
  };

  const handleEditPosition = async (id: string, oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error('Position name cannot be empty');
      return;
    }

    try {
      // Update the position name
      const { error } = await supabase
        .from('organization_positions')
        .update({ name: trimmed })
        .eq('id', id);

      if (error) throw error;

      // Also update all shift_templates that reference the old name
      const { data: orgLocations } = await supabase
        .from('locations')
        .select('id')
        .eq('organization_id', organizationId!);

      const locIds = orgLocations?.map(l => l.id) || [];
      if (locIds.length > 0) {
        await supabase
          .from('shift_templates')
          .update({ position: trimmed })
          .eq('position', oldName)
          .in('location_id', locIds);
      }

      toast.success(`Position renamed to "${trimmed}"`);
      setEditingId(null);
      setEditValue('');
      fetchPositions();
    } catch (error: any) {
      console.error('Error updating position:', error);
      toast.error('Failed to update position');
    }
  };

  const handleDeletePosition = async (position: Position) => {
    try {
      const { error } = await supabase
        .from('organization_positions')
        .delete()
        .eq('id', position.id);

      if (error) throw error;

      // Clear position from shift_templates
      const { data: orgLocations } = await supabase
        .from('locations')
        .select('id')
        .eq('organization_id', organizationId!);

      const locIds = orgLocations?.map(l => l.id) || [];
      if (locIds.length > 0) {
        await supabase
          .from('shift_templates')
          .update({ position: null })
          .eq('position', position.name)
          .in('location_id', locIds);
      }

      toast.success(`Position "${position.name}" removed`);
      setDeleteTarget(null);
      fetchPositions();
    } catch (error: any) {
      console.error('Error deleting position:', error);
      toast.error('Failed to delete position');
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading positions...</p>;
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Briefcase className="h-4 w-4" />
            Positions
          </div>
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-3 w-3 mr-1" />
              Add Position
            </Button>
          )}
        </div>

        {adding && (
          <div className="flex gap-2">
            <Input
              placeholder="Position name"
              value={newPosition}
              onChange={(e) => setNewPosition(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddPosition();
                if (e.key === 'Escape') {
                  setAdding(false);
                  setNewPosition('');
                }
              }}
              autoFocus
              className="h-8 text-sm"
            />
            <Button size="sm" className="h-8 w-8 p-0" onClick={handleAddPosition}>
              <Check className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { setAdding(false); setNewPosition(''); }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No positions yet</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {positions.map((position) => (
              <div key={position.id} className="group">
                {editingId === position.id ? (
                  <div className="flex gap-1 items-center">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleEditPosition(position.id, position.name, editValue);
                        if (e.key === 'Escape') { setEditingId(null); setEditValue(''); }
                      }}
                      autoFocus
                      className="h-7 w-28 text-xs"
                    />
                    <Button size="sm" className="h-7 w-7 p-0" onClick={() => handleEditPosition(position.id, position.name, editValue)}>
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingId(null); setEditValue(''); }}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Badge variant="secondary" className="pr-1 gap-1">
                    <span>{position.name}</span>
                    <button
                      className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                      onClick={() => { setEditingId(position.id); setEditValue(position.name); }}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                      onClick={() => setDeleteTarget(position)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Position</AlertDialogTitle>
            <AlertDialogDescription>
              Remove "{deleteTarget?.name}" from all shift templates?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && handleDeletePosition(deleteTarget)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
