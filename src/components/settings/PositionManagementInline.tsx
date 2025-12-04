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

type Position = {
  position: string;
  count: number;
};

export function PositionManagementInline() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPosition, setNewPosition] = useState('');
  const [editingPosition, setEditingPosition] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deletePosition, setDeletePosition] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchPositions();
  }, []);

  const fetchPositions = async () => {
    try {
      const { data, error } = await supabase
        .from('shift_templates')
        .select('position');

      if (error) throw error;

      const positionCounts = new Map<string, number>();
      data.forEach((template: any) => {
        if (template.position) {
          positionCounts.set(
            template.position,
            (positionCounts.get(template.position) || 0) + 1
          );
        }
      });

      const positionsList: Position[] = Array.from(positionCounts.entries())
        .map(([position, count]) => ({ position, count }))
        .sort((a, b) => a.position.localeCompare(b.position));

      setPositions(positionsList);
    } catch (error: any) {
      console.error('Error fetching positions:', error);
      toast.error('Failed to load positions');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPosition = async () => {
    if (!newPosition.trim()) {
      toast.error('Please enter a position name');
      return;
    }

    if (positions.some(p => p.position.toLowerCase() === newPosition.trim().toLowerCase())) {
      toast.error('Position already exists');
      return;
    }

    setNewPosition('');
    setAdding(false);
    toast.success(`Position "${newPosition}" added`);
    
    setPositions([...positions, { position: newPosition.trim(), count: 0 }].sort((a, b) => 
      a.position.localeCompare(b.position)
    ));
  };

  const handleEditPosition = async (oldPosition: string, newPositionName: string) => {
    if (!newPositionName.trim()) {
      toast.error('Position name cannot be empty');
      return;
    }

    try {
      const { error } = await supabase
        .from('shift_templates')
        .update({ position: newPositionName.trim() })
        .eq('position', oldPosition);

      if (error) throw error;

      toast.success(`Position renamed to "${newPositionName}"`);
      setEditingPosition(null);
      setEditValue('');
      fetchPositions();
    } catch (error: any) {
      console.error('Error updating position:', error);
      toast.error('Failed to update position');
    }
  };

  const handleDeletePosition = async (position: string) => {
    try {
      const { error } = await supabase
        .from('shift_templates')
        .update({ position: null })
        .eq('position', position);

      if (error) throw error;

      toast.success(`Position "${position}" removed`);
      setDeletePosition(null);
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
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setAdding(true)}>
              <Plus className="h-3 w-3 mr-1" />
              Add
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
              <div key={position.position} className="group">
                {editingPosition === position.position ? (
                  <div className="flex gap-1 items-center">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleEditPosition(position.position, editValue);
                        if (e.key === 'Escape') { setEditingPosition(null); setEditValue(''); }
                      }}
                      autoFocus
                      className="h-7 w-28 text-xs"
                    />
                    <Button size="sm" className="h-7 w-7 p-0" onClick={() => handleEditPosition(position.position, editValue)}>
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingPosition(null); setEditValue(''); }}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Badge variant="secondary" className="pr-1 gap-1">
                    <span>{position.position}</span>
                    <span className="text-muted-foreground">({position.count})</span>
                    <button
                      className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                      onClick={() => { setEditingPosition(position.position); setEditValue(position.position); }}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                      onClick={() => setDeletePosition(position.position)}
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

      <AlertDialog open={!!deletePosition} onOpenChange={() => setDeletePosition(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Position</AlertDialogTitle>
            <AlertDialogDescription>
              Remove "{deletePosition}" from all shift templates?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletePosition && handleDeletePosition(deletePosition)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}