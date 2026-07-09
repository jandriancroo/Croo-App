import { useState, useEffect, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, MessageCircle, Briefcase, Headphones, Users, ArrowLeft, Plus } from 'lucide-react';
import { ChatList } from '@/components/messages/ChatList';
import { ChatWindow } from '@/components/messages/ChatWindow';
import { NewChatDialog } from '@/components/messages/NewChatDialog';
import { HiringChatList } from '@/components/messages/HiringChatList';
import { HiringChatPanel } from '@/components/hiring/HiringChatPanel';
import { SupportChatPanel } from '@/components/support/SupportChatPanel';
import { ChatSearch } from '@/components/messages/ChatSearch';
import { useMessagesData } from '@/hooks/useMessagesData';
import { useIsMobile } from '@/hooks/use-mobile';

type Step = 'dms' | 'hiring' | 'support';

interface DmPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DmPanel({ open, onOpenChange }: DmPanelProps) {
  const data = useMessagesData();
  const isMobile = useIsMobile();
  const {
    currentUserId, currentLocation, isAdmin, isManager, isSuperAdmin,
    showHiringTab, showSupportTab,
    chats, selectedChatId, setSelectedChatId,
    isNewChatOpen, setIsNewChatOpen,
    loading,
    selectedHiringConversation, setSelectedHiringConversation,
    pendingHiringApplicationId, setPendingHiringApplicationId,
    fetchChats, handleTogglePin,
  } = data;

  // DM-scoped search, independent of feed viewMode
  const [dmSearch, setDmSearch] = useState('');
  const dmChats = useMemo(() => {
    const base = chats.filter(c => !c.is_announcement);
    const q = dmSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(c =>
      (c.title ?? '').toLowerCase().includes(q) ||
      (c.messagePreview ?? '').toLowerCase().includes(q)
    );
  }, [chats, dmSearch]);

  const steps: { id: Step; label: string; icon: any }[] = [
    { id: 'dms', label: 'Direct messages', icon: MessageCircle },
    ...(showHiringTab ? [{ id: 'hiring' as Step, label: 'Hiring', icon: Briefcase }] : []),
    ...(showSupportTab ? [{ id: 'support' as Step, label: 'Support', icon: Headphones }] : []),
  ];

  const [step, setStep] = useState<Step>('dms');
  const stepIdx = steps.findIndex(s => s.id === step);
  const goPrev = () => setStep(steps[(stepIdx - 1 + steps.length) % steps.length].id);
  const goNext = () => setStep(steps[(stepIdx + 1) % steps.length].id);

  // Reset detail view when panel closes
  useEffect(() => {
    if (!open) {
      setSelectedChatId(null);
      setSelectedHiringConversation(null);
    }
  }, [open, setSelectedChatId, setSelectedHiringConversation]);

  const current = steps[stepIdx] ?? steps[0];
  const Icon = current.icon;

  // DM list panel (also used as base for mobile stepper)
  const dmListPanel = (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <ChatList
        chats={dmChats}
        selectedChatId={selectedChatId}
        onSelectChat={setSelectedChatId}
        onTogglePin={handleTogglePin}
        loading={loading}
        searchQuery={dmSearch}
        currentUserId={currentUserId}
      />
      <div className="p-2 border-t border-border">
        <ChatSearch onSearch={setDmSearch} placeholder="Search chats..." />
      </div>
      <Button
        size="icon"
        onClick={() => setIsNewChatOpen(true)}
        className="absolute bottom-16 right-3 h-11 w-11 rounded-full shadow-lg"
        aria-label="New chat"
      >
        <Plus className="h-5 w-5" />
      </Button>
    </div>
  );

  const dmDetail = selectedChatId ? (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-3 border-b border-border shrink-0">
        <Button variant="ghost" size="sm" onClick={() => { setSelectedChatId(null); fetchChats(); }}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-sm font-semibold">Chat</h3>
      </div>
      <div className="flex-1 min-h-0">
        <ChatWindow
          chatId={selectedChatId}
          chatDetails={chats.find(c => c.id === selectedChatId) || null}
          onChatDeleted={() => { setSelectedChatId(null); fetchChats(); }}
          onChatUpdated={fetchChats}
        />
      </div>
    </div>
  ) : null;

  const hiringPanel = (
    <div className="flex flex-col h-full">
      {selectedHiringConversation ? (
        <>
          <div className="flex items-center gap-2 p-3 border-b border-border shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setSelectedHiringConversation(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h3 className="text-sm font-semibold truncate">
              {selectedHiringConversation.application?.full_name || 'Applicant'}
            </h3>
          </div>
          <div className="flex-1 min-h-0">
            <HiringChatPanel
              applicationId={selectedHiringConversation.application_id}
              applicantName={selectedHiringConversation.application?.full_name || 'Applicant'}
            />
          </div>
        </>
      ) : (
        <HiringChatList
          onSelectConversation={(conv) => {
            setSelectedHiringConversation(conv);
            setPendingHiringApplicationId(null);
          }}
          selectedId={selectedHiringConversation?.id}
          autoSelectApplicationId={pendingHiringApplicationId}
        />
      )}
    </div>
  );

  const supportPanel = (
    <div className="h-full"><SupportChatPanel /></div>
  );

  const body = (
    <div className="flex-1 min-h-0 flex flex-col">
      {step === 'dms' && (selectedChatId ? dmDetail : dmListPanel)}
      {step === 'hiring' && hiringPanel}
      {step === 'support' && supportPanel}
    </div>
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={isMobile ? 'h-[92vh] p-0 flex flex-col rounded-t-2xl' : 'w-[420px] sm:max-w-[420px] p-0 flex flex-col my-3 mr-3 h-[calc(100vh-1.5rem)] rounded-2xl border shadow-2xl overflow-hidden'}
        >
          <SheetHeader className="px-3 pt-4 pb-2 pr-12 border-b border-primary-foreground/10 shrink-0 bg-primary text-primary-foreground">
            <div className="flex items-center justify-between gap-2">
              {steps.length > 1 ? (
                <Button variant="ghost" size="icon" onClick={goPrev} className="h-8 w-8 shrink-0 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              ) : <div className="h-8 w-8 shrink-0" />}
              <SheetTitle className="flex items-center gap-2 text-base min-w-0 truncate text-primary-foreground">
                <Icon className="h-4 w-4 shrink-0" /> <span className="truncate">{current.label}</span>
              </SheetTitle>
              {steps.length > 1 ? (
                <Button variant="ghost" size="icon" onClick={goNext} className="h-8 w-8 shrink-0 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ) : <div className="h-8 w-8 shrink-0" />}
            </div>
            {steps.length > 1 && (
              <div className="flex items-center justify-center gap-1 pt-1">
                {steps.map(s => (
                  <span
                    key={s.id}
                    className={`h-1 rounded-full transition-all ${s.id === step ? 'w-6 bg-primary-foreground' : 'w-1.5 bg-primary-foreground/40'}`}
                  />
                ))}
              </div>
            )}
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>

      <NewChatDialog
        open={isNewChatOpen}
        onOpenChange={setIsNewChatOpen}
        onChatCreated={(chatId) => { setSelectedChatId(chatId); fetchChats(); setIsNewChatOpen(false); }}
        canCreateGroup={isAdmin || isManager}
        locationId={currentLocation?.id}
        locationName={currentLocation?.name}
      />
    </>
  );
}
