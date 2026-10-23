// Super-admin "Support chats" opened from Settings: the same slide-up Inbox shell the DMs use
// (bottom sheet on phone, right panel on desktop), with no tab bar. The ticket panel inside is unchanged logic.
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

const SupportChatPanel = lazy(() =>
  import('@/components/support/SupportChatPanel').then((m) => ({ default: m.SupportChatPanel })),
);

export function SupportInboxSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={isMobile
          ? 'h-[92vh] p-0 flex flex-col rounded-t-2xl overflow-hidden [&_[data-radix-dialog-close]]:text-primary-foreground'
          : 'w-[420px] sm:max-w-[420px] p-0 flex flex-col my-3 mr-3 h-[calc(100vh-1.5rem)] rounded-2xl border shadow-2xl overflow-hidden [&_[data-radix-dialog-close]]:text-primary-foreground'}
      >
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-primary-foreground/10 shrink-0 bg-primary text-primary-foreground">
          <SheetTitle className="pr-8 text-left text-lg text-primary-foreground">Support chats</SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0 flex flex-col">
          {open && (
            <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
              <SupportChatPanel />
            </Suspense>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
