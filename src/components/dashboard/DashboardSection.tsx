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
      className={`relative ${isDragging ? 'opacity-50 z-50' : ''}`}
    >
      {isEditMode && (
        <div className="absolute -left-10 top-4 z-10">
          <button
            className="touch-none cursor-grab active:cursor-grabbing p-2 rounded-md bg-muted hover:bg-muted-foreground/20 transition-colors"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
