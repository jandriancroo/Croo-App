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

/**
 * Chat page = single-column Team Feed.
 * DMs, hiring and support live behind the chat bubble in the top-right (DmPanel).
 * Route + label stay "Chat" so a future rename is a one-line change.
 */

export default function Messages() {
  const { currentLocation } = useAppLocation();
  const { counts: unreadCounts } = useChatUnreadCounts(currentLocation?.id || null);
  const dmBadge = (unreadCounts.chats ?? 0) + (unreadCounts.hiring ?? 0) + (unreadCounts.support ?? 0);

  const [dmOpen, setDmOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep link from push notification: /messages?chat=<id> → open DM panel to that chat.
  const chatParam = searchParams.get('chat');
  useEffect(() => {
    if (chatParam) setDmOpen(true);
  }, [chatParam]);

  return (
    <Layout>
      <div className="mx-auto w-full max-w-[640px] pb-8">
        {/* Page header — Chats title + DM button */}
        <PageTitle
          color="orange"
          action={
            <Button
              variant="default"
              size="icon"
              onClick={() => setDmOpen(true)}
              className="relative h-12 w-12 rounded-2xl shrink-0 bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
              aria-label="Open direct messages"
            >
              <MessageCircle className="h-6 w-6" />
              {dmBadge > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {dmBadge > 99 ? '99+' : dmBadge}
                </span>
              )}
            </Button>
          }
        >
          Chats
        </PageTitle>

        {/* The feed itself */}
        <AnnouncementFeed
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

      <DmPanel open={dmOpen} onOpenChange={setDmOpen} />
    </Layout>
  );
}
