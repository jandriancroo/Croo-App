import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Headphones } from 'lucide-react';
import { CreateTicketDialog } from './CreateTicketDialog';
import { useUserRole } from '@/hooks/useUserRole';

export function SupportButton() {
  const [isOpen, setIsOpen] = useState(false);
  const { isShiftManager, isSuperAdmin } = useUserRole();

  // Only show for shift_manager and above, but NOT super_admin (they receive tickets)
  if (!isShiftManager || isSuperAdmin) return null;

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-4 z-50 h-12 gap-2 rounded-full shadow-lg md:bottom-6"
        size="sm"
      >
        <Headphones className="h-4 w-4" />
        <span className="hidden sm:inline">Support</span>
      </Button>

      <CreateTicketDialog open={isOpen} onOpenChange={setIsOpen} />
    </>
  );
}
