import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';
import { AnnouncementFeed } from '@/components/feed/AnnouncementFeed';
import { DmPanel } from '@/components/messages/DmPanel';
import { useChatUnreadCounts } from '@/hooks/useChatUnreadCounts';
import { useLocation as useAppLocation } from '@/hooks/useLocation';

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
  const [activeBadge, setActiveBadge] = useState<string | 'all'>('all');
  const { data: badges = [] } = useFeedBadges();

  // Deep link from push notification: /messages?chat=<id> → open DM panel to that chat.
  useEffect(() => {
    const chatParam = searchParams.get('chat');
    if (chatParam) setDmOpen(true);
  }, [searchParams]);

  return (
    <Layout>
      <div className="mx-auto w-full max-w-[640px] pb-8">
        {/* Page header */}
        <header className="flex items-center justify-between pt-1 pb-3 md:pt-2 md:pb-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/85">
            ACTIVITY
          </span>

          <div className="flex items-center gap-2">
            {/* Badge filter dropdown */}
            {badges.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-sm font-medium whitespace-nowrap transition-colors border"
                    style={
                      activeBadge === 'all'
                        ? { backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', borderColor: 'hsl(var(--primary))' }
                        : (() => {
                            const b = badges.find(x => x.id === activeBadge);
                            const color = b?.color ?? '#3B82F6';
                            return { backgroundColor: color, color: 'white', borderColor: color };
                          })()
                    }
                  >
                    {activeBadge === 'all' ? 'All' : badges.find(b => b.id === activeBadge)?.label ?? 'All'}
                    <ChevronDown className="h-3.5 w-3.5 opacity-80" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuRadioGroup value={activeBadge} onValueChange={(v) => setActiveBadge(v as string | 'all')}>
                    <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                    {badges.map(b => (
                      <DropdownMenuRadioItem key={b.id} value={b.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: b.color ?? '#3B82F6' }}
                          />
                          {b.label}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              variant="default"
              size="icon"
              onClick={() => setDmOpen(true)}
              className="relative h-12 w-12 rounded-full shrink-0 bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
              aria-label="Open direct messages"
            >
              <MessageCircle className="h-6 w-6" />
              {dmBadge > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {dmBadge > 99 ? '99+' : dmBadge}
                </span>
              )}
            </Button>
          </div>
        </header>

        {/* The feed itself */}
        <AnnouncementFeed
          activeBadge={activeBadge}
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
