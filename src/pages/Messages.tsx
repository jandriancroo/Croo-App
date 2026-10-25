import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';
import { AnnouncementFeed } from '@/components/feed/AnnouncementFeed';
import { DmPanel } from '@/components/messages/DmPanel';
import { useChatUnreadCounts } from '@/hooks/useChatUnreadCounts';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { PageTitle } from '@/components/PageTitle';
import { useDuo } from '@/hooks/useDuo';

/**
 * Chat page = single-column Team Feed.
 * DMs and hiring live behind the chat bubble in the top-right (DmPanel).
 * Route + label stay "Chat" so a future rename is a one-line change.
 */

export default function Messages() {
  const { currentLocation } = useAppLocation();
  const duo = useDuo();
  const { counts: unreadCounts } = useChatUnreadCounts(currentLocation?.id || null);
  const dmBadge = (unreadCounts.chats ?? 0) + (unreadCounts.hiring ?? 0);

  const [dmOpen, setDmOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // Duo action button: New post / Inbox (New DM is handled inside DmPanel).
  useEffect(() => {
    const post = () => setComposerOpen(true);
    const inbox = () => setDmOpen(true);
    window.addEventListener('open-new-post', post);
    window.addEventListener('open-inbox', inbox);
    return () => { window.removeEventListener('open-new-post', post); window.removeEventListener('open-inbox', inbox); };
  }, []);

  // Deep link from push notification: /messages?chat=<id> → open DM panel to that chat.
  // ?msg=<id> (chat push) scrolls to that message, then both params are cleared.
  const chatParam = searchParams.get('chat');
  const msgParam = searchParams.get('msg');
  useEffect(() => {
    if (chatParam) setDmOpen(true);
  }, [chatParam]);
  const handleMessageFocused = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('chat');
    next.delete('msg');
    setSearchParams(next, { replace: true });
  };

  // Deep link from a Team Feed push: /messages?post=<id> → scroll to that post.
  const postParam = searchParams.get('post');
  const handlePostFocused = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('post');
    setSearchParams(next, { replace: true });
  };

  // Deep link: /messages?tab=hiring&applicationId=<id> — captured once on mount.
  const [hiringTarget, setHiringTarget] = useState<string | null>(() =>
    searchParams.get('tab') === 'hiring' ? searchParams.get('applicationId') : null
  );
  useEffect(() => {
    if (!hiringTarget) return;
    setDmOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    next.delete('applicationId');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Layout>
      <div className={duo.isOpen ? 'duo-chat-page duo-chat-left w-full pb-8' : 'duo-chat-page mx-auto w-full max-w-[640px] pb-8'}>
        {/* Page header — Chats title + DM button */}
        {duo.isDuo && (() => {
          const c = unreadCounts.chats ?? 0, a = unreadCounts.announcements ?? 0;
          const status = !c && !a ? 'All caught up' : [c ? `${c} unread` : '', a ? `${a} announcement${a === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
          return <div className="duo-pageline"><b>Chat</b><span>{status}</span></div>;
        })()}
        {!duo.isDuo && <PageTitle
          color="orange"
          status={(() => {
            const c = unreadCounts.chats ?? 0, a = unreadCounts.announcements ?? 0;
            if (!c && !a) return { text: 'ALL CAUGHT UP' };
            return { text: [c ? `${c} UNREAD` : '', a ? `${a} ANNOUNCEMENT${a === 1 ? '' : 'S'}` : ''].filter(Boolean).join(' · ') };
          })()}
          action={
            <Button
              variant="default"
              size="icon"
              onClick={() => setDmOpen(true)}
              className="relative shrink-0 bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
              aria-label="Open direct messages"
            >
              <MessageCircle className="h-5 w-5" />
              {dmBadge > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {dmBadge > 99 ? '99+' : dmBadge}
                </span>
              )}
            </Button>
          }
        >
          Chats
        </PageTitle>}

        {/* The feed itself */}
        <AnnouncementFeed
          focusPostId={postParam}
          onFocusPostHandled={handlePostFocused}
          composerOpen={composerOpen}
          onComposerOpenChange={(o) => {
            setComposerOpen(o);
            // Clear stale ?chat param once user interacts with the feed
            if (o && searchParams.get('chat')) {
              const next = new URLSearchParams(searchParams);
              next.delete('chat');
              setSearchParams(next, { replace: true });
            }
          }}
        />
      </div>

      <DmPanel
        docked={duo.isOpen}
        open={dmOpen}
        onOpenChange={(o) => { setDmOpen(o); if (!o) setHiringTarget(null); }}
        initialChatId={chatParam}
        focusMessageId={msgParam}
        onFocusMessageHandled={handleMessageFocused}
        initialHiringApplicationId={hiringTarget}
      />
    </Layout>
  );
}
