import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Plus, Users, ArrowLeft, Briefcase, MessageCircle, Headphones, Megaphone, User } from 'lucide-react';
import { ChatList } from '@/components/messages/ChatList';
import { ChatWindow } from '@/components/messages/ChatWindow';
import { NewChatDialog } from '@/components/messages/NewChatDialog';
import { AnnouncementDialog } from '@/components/messages/AnnouncementDialog';
import { MarketplaceIconSelector } from '@/components/messages/MarketplaceIconSelector';
import { ChatSearch } from '@/components/messages/ChatSearch';
import { CreateTicketDialog } from '@/components/support/CreateTicketDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HiringChatList } from '@/components/messages/HiringChatList';
import { HiringChatPanel } from '@/components/hiring/HiringChatPanel';
import { SupportChatPanel } from '@/components/support/SupportChatPanel';
import { useMessagesData, type ViewMode } from '@/hooks/useMessagesData';
import { AnnouncementFeed } from '@/components/feed/AnnouncementFeed';

// Shared filter chip bar component
function FilterChipBar({ 
  filters, 
  viewMode, 
  onViewModeChange, 
}: { 
  filters: Array<{ id: ViewMode; label: string; icon: any; badge: number }>;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="overflow-x-auto scrollbar-hide">
      <div className="flex gap-2 min-w-max">
        {filters.map(f => {
          const isActive = viewMode === f.id;
          const Icon = f.icon;
          return (
            <button
              key={f.id}
              onClick={() => onViewModeChange(f.id)}
              className={`relative flex items-center gap-2 py-2.5 rounded-full text-sm font-medium whitespace-nowrap overflow-visible transition-all duration-300 ease-in-out ${
                isActive
                  ? 'bg-primary text-primary-foreground px-4'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 px-3'
              }`}
              style={{
                maxWidth: isActive ? '200px' : '44px',
                minWidth: isActive ? 'auto' : '44px',
              }}
              aria-label={f.label}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span
                className="transition-all duration-300 ease-in-out overflow-hidden"
                style={{
                  maxWidth: isActive ? '120px' : '0px',
                  opacity: isActive ? 1 : 0,
                }}
              >
                {f.label}
              </span>
              {f.badge > 0 && isActive && (
                <span className="ml-0.5 bg-destructive text-destructive-foreground rounded-full px-1.5 text-[10px] font-bold shrink-0">{f.badge}</span>
              )}
              {f.badge > 0 && !isActive && (
                <div className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Messages() {
  const data = useMessagesData();
  const {
    currentUserId, currentLocation, isMobile,
    isAdmin, isManager, showHiringTab, showSupportTab,
    chats, selectedChatId, setSelectedChatId,
    isNewChatOpen, setIsNewChatOpen,
    isAnnouncementOpen, setIsAnnouncementOpen,
    isMarketplaceIconOpen, setIsMarketplaceIconOpen,
    marketplaceChatId, loading,
    filteredChats, viewMode,
    isNewActionOpen, setIsNewActionOpen,
    selectedHiringConversation, setSelectedHiringConversation,
    pendingHiringApplicationId, setPendingHiringApplicationId,
    unreadCounts, searchQuery,
    fetchChats, handleSearch, handleViewModeChange, handleTogglePin,
  } = data;
  const [isCreateTicketOpen, setIsCreateTicketOpen] = useState(false);
  const [feedComposerOpen, setFeedComposerOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const handlePlusClick = () => {
    if (viewMode === 'announcements') setFeedComposerOpen(true);
    else setIsNewActionOpen(true);
  };

  // Deep link from push notification: /messages?chat=<id>
  useEffect(() => {
    const chatParam = searchParams.get('chat');
    if (!chatParam || loading) return;
    const exists = chats.some(c => c.id === chatParam);
    if (exists) {
      setSelectedChatId(chatParam);
      // Clear the param so it doesn't re-fire on navigation
      const next = new URLSearchParams(searchParams);
      next.delete('chat');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, chats, loading, setSelectedChatId, setSearchParams]);


  const filters: Array<{ id: ViewMode; label: string; icon: any; badge: number }> = [
    { id: 'all', label: 'Chats', icon: MessageCircle, badge: unreadCounts.chats },
    { id: 'announcements', label: 'Announce', icon: Megaphone, badge: unreadCounts.announcements },
    ...(showHiringTab ? [{ id: 'hiring' as ViewMode, label: 'Hiring', icon: Briefcase, badge: unreadCounts.hiring }] : []),
    ...(showSupportTab ? [{ id: 'support' as ViewMode, label: 'Support', icon: Headphones, badge: unreadCounts.support }] : []),
  ];

  const chatListContent = viewMode === 'hiring' ? (
    <HiringChatList
      onSelectConversation={(conv) => {
        setSelectedHiringConversation(conv);
        setPendingHiringApplicationId(null);
      }}
      selectedId={selectedHiringConversation?.id}
      autoSelectApplicationId={pendingHiringApplicationId}
    />
  ) : viewMode === 'support' ? null : viewMode === 'announcements' ? (
    <div className="flex-1 min-h-0"><AnnouncementFeed composerOpen={feedComposerOpen} onComposerOpenChange={setFeedComposerOpen} /></div>
  ) : (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <ChatList
        chats={filteredChats}
        selectedChatId={selectedChatId}
        onSelectChat={setSelectedChatId}
        onTogglePin={handleTogglePin}
        loading={loading}
        searchQuery={searchQuery}
        currentUserId={currentUserId}
      />
      <div className="absolute bottom-3 left-3 right-3 z-10">
        <ChatSearch onSearch={handleSearch} placeholder={isMobile ? 'Search...' : 'Search all chats...'} />
      </div>
    </div>
  );

  const chatWindowContent = viewMode === 'support' ? (
    <div className="w-full h-full"><SupportChatPanel /></div>
  ) : viewMode === 'hiring' && selectedHiringConversation ? (
    <div className="p-4 w-full">
      <HiringChatPanel
        applicationId={selectedHiringConversation.application_id}
        applicantName={selectedHiringConversation.application?.full_name || 'Applicant'}
      />
    </div>
  ) : selectedChatId ? (
    <div className="w-full h-full overflow-hidden">
      <ChatWindow
        chatId={selectedChatId}
        chatDetails={chats.find(c => c.id === selectedChatId) || null}
        onChatDeleted={() => { setSelectedChatId(null); fetchChats(); }}
        onChatUpdated={fetchChats}
      />
    </div>
  ) : (
    <div className="flex items-center justify-center h-full text-muted-foreground w-full">
      <div className="text-center">
        <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>Select a chat to start messaging</p>
      </div>
    </div>
  );

  return (
    <Layout>
      {/* Desktop Layout */}
      <div className="hidden md:flex h-[calc(100vh-12rem)] gap-4">
        <div className="w-80 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-bold">Chat</h1>
            <Button size="icon" onClick={() => setIsNewActionOpen(true)} className="h-8 w-8">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="mb-2">
            <FilterChipBar filters={filters} viewMode={viewMode} onViewModeChange={handleViewModeChange} />
          </div>
          <div className={cn(
            "flex-1 min-h-0 flex flex-col",
            viewMode === 'announcements'
              ? "bg-transparent"
              : "border-r border-border bg-card rounded-lg p-4"
          )}>
            {chatListContent}
          </div>
        </div>
        <div className="flex-1 bg-card rounded-lg flex min-w-0 h-full">
          {chatWindowContent}
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="flex md:hidden h-[calc(100vh-12rem)] flex-col">
        <div className="mb-2">
          <h1 className="text-3xl font-bold">Chat</h1>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 overflow-x-auto scrollbar-hide">
            <FilterChipBar filters={filters} viewMode={viewMode} onViewModeChange={handleViewModeChange} />
          </div>
          <Button size="icon" onClick={() => setIsNewActionOpen(true)} className="h-10 w-10 rounded-full shrink-0">
            <Plus className="h-5 w-5" />
          </Button>
        </div>

        <div className={cn(
          "flex-1 flex flex-col overflow-clip relative",
          viewMode === 'announcements' ? "bg-transparent" : "bg-card rounded-lg"
        )}>
          
          <div className={cn("flex-1 min-h-0 overflow-y-auto", viewMode === 'announcements' ? "px-0" : "px-1")}>
            {viewMode === 'support' ? <SupportChatPanel /> : viewMode === 'hiring' ? (
              <HiringChatList
                onSelectConversation={(conv) => {
                  setSelectedHiringConversation(conv);
                  setPendingHiringApplicationId(null);
                }}
                selectedId={selectedHiringConversation?.id}
                autoSelectApplicationId={pendingHiringApplicationId}
              />
            ) : viewMode === 'announcements' ? (
              <AnnouncementFeed />
            ) : (
              <ChatList
                chats={filteredChats}
                selectedChatId={selectedChatId}
                onSelectChat={setSelectedChatId}
                onTogglePin={handleTogglePin}
                loading={loading}
                searchQuery={searchQuery}
                currentUserId={currentUserId}
              />
            )}
          </div>
          {viewMode !== 'hiring' && viewMode !== 'support' && viewMode !== 'announcements' && (
            <div className="px-3 pb-3 pt-1">
              <ChatSearch onSearch={handleSearch} placeholder="Search..." />
            </div>
          )}
        </div>
      </div>
      
      
      {/* Mobile Full-Screen Chat Window */}
      {isMobile && !!selectedChatId && (
        <div className="fixed inset-0 z-[100] bg-background flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="flex items-center gap-2 p-4 border-b border-border shrink-0">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedChatId(null); fetchChats(); }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-lg font-semibold">Chat</h2>
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
      )}

      {/* Mobile Hiring Chat */}
      {isMobile && viewMode === 'hiring' && !!selectedHiringConversation && (
        <div className="fixed inset-0 z-[100] bg-background flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="flex items-center gap-2 p-4 border-b border-border shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setSelectedHiringConversation(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-lg font-semibold truncate">
              {selectedHiringConversation?.application?.full_name || 'Applicant'}
            </h2>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {selectedHiringConversation && (
              <HiringChatPanel
                applicationId={selectedHiringConversation.application_id}
                applicantName={selectedHiringConversation.application?.full_name || 'Applicant'}
              />
            )}
          </div>
        </div>
      )}

      {/* New Action Dialog */}
      <Dialog open={isNewActionOpen} onOpenChange={setIsNewActionOpen}>
        <DialogContent className="max-w-[320px] rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-center">New Conversation</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <Button variant="outline" className="w-full gap-3 justify-start h-12" onClick={() => { setIsNewActionOpen(false); setIsNewChatOpen(true); }}>
              <User className="h-5 w-5" /> Direct Message
            </Button>
            {(isAdmin || isManager) && (
              <Button variant="outline" className="w-full gap-3 justify-start h-12" onClick={() => { setIsNewActionOpen(false); setIsNewChatOpen(true); }}>
                <Users className="h-5 w-5" /> Group Chat
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" className="w-full gap-3 justify-start h-12" onClick={() => { setIsNewActionOpen(false); setIsAnnouncementOpen(true); }}>
                <Megaphone className="h-5 w-5" /> Announcement
              </Button>
            )}
            <Button variant="outline" className="w-full gap-3 justify-start h-12" onClick={() => { setIsNewActionOpen(false); setIsCreateTicketOpen(true); }}>
              <Headphones className="h-5 w-5" /> Support Request
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <NewChatDialog
        open={isNewChatOpen}
        onOpenChange={setIsNewChatOpen}
        onChatCreated={(chatId) => { setSelectedChatId(chatId); fetchChats(); setIsNewChatOpen(false); }}
        canCreateGroup={isAdmin || isManager}
        locationId={currentLocation?.id}
        locationName={currentLocation?.name}
      />

      <AnnouncementDialog
        open={isAnnouncementOpen}
        onOpenChange={setIsAnnouncementOpen}
        onAnnouncementCreated={(chatId) => { setSelectedChatId(chatId); fetchChats(); setIsAnnouncementOpen(false); }}
        locationId={currentLocation?.id}
        locationName={currentLocation?.name}
      />

      {marketplaceChatId && (
        <MarketplaceIconSelector
          open={isMarketplaceIconOpen}
          onOpenChange={setIsMarketplaceIconOpen}
          chatId={marketplaceChatId}
          onIconSelected={() => { fetchChats(); }}
        />
      )}

      <CreateTicketDialog open={isCreateTicketOpen} onOpenChange={setIsCreateTicketOpen} />
    </Layout>
  );
}
