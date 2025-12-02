import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { ReactNode } from 'react';

interface DashboardSectionProps {
  id: string;
  title?: string;
  children: ReactNode;
  isEditMode: boolean;
}

export function DashboardSection({ id, title, children, isEditMode }: DashboardSectionProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !isEditMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${isDragging ? 'opacity-50 z-50' : ''} ${isEditMode ? 'border-2 border-dashed border-primary/30 rounded-lg p-2' : ''}`}
    >
      {isEditMode && (
        <div className="flex items-center gap-2 mb-2">
          <button
            className="touch-none cursor-grab active:cursor-grabbing p-1.5 rounded-md bg-primary/10 hover:bg-primary/20 transition-colors"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4 text-primary" />
          </button>
          <span className="text-xs text-muted-foreground">Drag to reorder</span>
        </div>
      )}
      {children}
    </div>
  );
}
