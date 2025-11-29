import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Briefcase, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

export function PositionManagementSection() {
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
      // Get all unique positions from shift_templates
      const { data, error } = await supabase
        .from('shift_templates')
        .select('position');

      if (error) throw error;

      // Count occurrences of each position
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
    toast.success(`Position "${newPosition}" added to master list`);
    
    // Add to local state
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
      // Update all shift templates with this position
      const { error } = await supabase
        .from('shift_templates')
        .update({ position: newPositionName.trim() })
        .eq('position', oldPosition);

      if (error) throw error;

      toast.success(`Position renamed from "${oldPosition}" to "${newPositionName}"`);
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
      // Set position to null for all shift templates with this position
      const { error } = await supabase
        .from('shift_templates')
        .update({ position: null })
        .eq('position', position);

      if (error) throw error;

      toast.success(`Position "${position}" removed from all templates`);
      setDeletePosition(null);
      fetchPositions();
    } catch (error: any) {
      console.error('Error deleting position:', error);
      toast.error('Failed to delete position');
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Position Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Position Management
          </CardTitle>
          <CardDescription>
            Manage the master list of positions used in shift templates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {adding ? (
              <div className="flex gap-2 p-3 border rounded-lg bg-muted/50">
                <Input
                  placeholder="Enter position name (e.g., Server, Cook, Host)"
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
                />
                <Button size="icon" onClick={handleAddPosition}>
                  <Check className="h-4 w-4" />
                </Button>
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={() => {
                    setAdding(false);
                    setNewPosition('');
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Position
              </Button>
            )}

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Position Name</TableHead>
                    <TableHead>Used in Templates</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                        No positions defined yet. Add one to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    positions.map((position) => (
                      <TableRow key={position.position}>
                        <TableCell>
                          {editingPosition === position.position ? (
                            <div className="flex gap-2">
                              <Input
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleEditPosition(position.position, editValue);
                                  if (e.key === 'Escape') {
                                    setEditingPosition(null);
                                    setEditValue('');
                                  }
                                }}
                                autoFocus
                              />
                              <Button 
                                size="icon" 
                                onClick={() => handleEditPosition(position.position, editValue)}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button 
                                size="icon" 
                                variant="ghost"
                                onClick={() => {
                                  setEditingPosition(null);
                                  setEditValue('');
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <span className="font-medium">{position.position}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {position.count} {position.count === 1 ? 'template' : 'templates'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditingPosition(position.position);
                                setEditValue(position.position);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeletePosition(position.position)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!deletePosition} onOpenChange={() => setDeletePosition(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Position</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the position "{deletePosition}"? This will remove it from all shift templates that use it.
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
