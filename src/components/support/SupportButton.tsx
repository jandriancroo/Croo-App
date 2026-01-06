import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Headphones } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { UserSupportView } from './UserSupportView';
import { useUserRole } from '@/hooks/useUserRole';

export function SupportButton() {
  const [isOpen, setIsOpen] = useState(false);
  const { isShiftManager, isSuperAdmin } = useUserRole();

  // Only show for shift_manager and above, but NOT super_admin (they have the Support tab)
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

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 pt-[env(safe-area-inset-top)] pb-safe">
          <UserSupportView />
        </SheetContent>
      </Sheet>
    </>
  );
}
