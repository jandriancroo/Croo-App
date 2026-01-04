import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Gamepad2, Send, Loader2 } from 'lucide-react';

interface ShareScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameType: 'snake' | 'minesweeper' | 'basketball' | 'pizza' | 'karen-dungeon' | 'marcman';
  score: number;
  gameName?: string;
}

export function ShareScoreDialog({ open, onOpenChange, gameType, score, gameName }: ShareScoreDialogProps) {
  const [sending, setSending] = useState(false);

  const getOrCreateArcadeChat = async (userId: string, locationId: string): Promise<string | null> => {
    // Check if an arcade chat already exists for this location
    const { data: existingChat, error: findError } = await supabase
      .from('chats')
      .select('id')
      .eq('location_id', locationId)
      .eq('is_arcade', true)
      .maybeSingle();

    if (findError) {
      console.error('Error finding arcade chat:', findError);
      return null;
    }

    if (existingChat) {
      // Make sure current user is a member
      const { data: membership } = await supabase
        .from('chat_members')
        .select('id')
        .eq('chat_id', existingChat.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (!membership) {
        await supabase.from('chat_members').insert({
          chat_id: existingChat.id,
          user_id: userId,
        });
      }
      return existingChat.id;
    }

    // Create new arcade chat for this location
    const { data: newChat, error: createError } = await supabase
      .from('chats')
      .insert({
        title: 'Arcade 🕹️',
        is_group: true,
        is_arcade: true,
        is_announcement: false,
        location_id: locationId,
        created_by: userId,
      })
      .select('id')
      .single();

    if (createError || !newChat) {
      console.error('Error creating arcade chat:', createError);
      return null;
    }

    // Add all users at this location to the arcade chat
    const { data: locationUsers } = await supabase
      .from('user_locations')
      .select('user_id')
      .eq('location_id', locationId);

    if (locationUsers && locationUsers.length > 0) {
      const memberInserts = locationUsers.map((lu) => ({
        chat_id: newChat.id,
        user_id: lu.user_id,
      }));
      await supabase.from('chat_members').insert(memberInserts);
    }

    return newChat.id;
  };

  const handleShare = async () => {
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get user's profile and location
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      const { data: userLocation } = await supabase
        .from('user_locations')
        .select('location_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (!userLocation?.location_id) {
        toast.error('No location found for your account');
        return;
      }

      const playerName = profile?.full_name || 'Someone';

      // Get or create the arcade chat
      const arcadeChatId = await getOrCreateArcadeChat(user.id, userLocation.location_id);
      if (!arcadeChatId) {
        toast.error('Could not find or create arcade chat');
        return;
      }

      // Send message with special game score format
      const content = `GAME_SCORE:${gameType}:${score}:${playerName}`;

      const { error } = await supabase
        .from('messages')
        .insert({
          chat_id: arcadeChatId,
          sender_id: user.id,
          content,
        });

      if (error) throw error;

      // Send push notifications to chat members
      try {
        const { data: members } = await supabase
          .from('chat_members')
          .select('user_id')
          .eq('chat_id', arcadeChatId)
          .neq('user_id', user.id);

        if (members && members.length > 0) {
          const displayName = gameName || (
            gameType === 'snake' ? 'Snake' : 
            gameType === 'minesweeper' ? 'Minesweeper' : 
            gameType === 'basketball' ? 'Hoops' : 
            gameType === 'marcman' ? 'MarcMAN' :
            gameType === 'karen-dungeon' ? 'Karen Dungeon 3D' : 'Super Karen Destroy 3'
          );
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
              title: `${playerName} scored!`,
              body: `${score.toLocaleString()} pts in ${displayName}`,
              notification_type: 'chat_messages',
              data: { chat_id: arcadeChatId, type: 'message' }
            }
          });
        }
      } catch (notifError) {
        console.error('Error sending push notification:', notifError);
      }

      toast.success('Score shared to Arcade!');
      onOpenChange(false);
    } catch (error) {
      console.error('Error sharing score:', error);
      toast.error('Failed to share score');
    } finally {
      setSending(false);
    }
  };

  const displayGameName = gameName || (
    gameType === 'snake' ? 'Snake' : 
    gameType === 'minesweeper' ? 'Minesweeper' : 
    gameType === 'basketball' ? 'Hoops' : 
    gameType === 'marcman' ? 'MarcMAN' :
    gameType === 'karen-dungeon' ? 'Karen Dungeon 3D' : 'Super Karen Destroy 3'
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gamepad2 className="h-5 w-5 text-primary" />
            Share Your Score
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="text-center p-4 rounded-lg bg-primary/10 border border-primary/20">
            <p className="text-3xl font-bold text-primary mb-1">
              {score.toLocaleString()} pts
            </p>
            <p className="text-sm text-muted-foreground">
              in {displayGameName}
            </p>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            Share your score to the <span className="font-semibold">Arcade 🕹️</span> chat where your team competes!
          </p>

          <Button 
            onClick={handleShare} 
            disabled={sending}
            className="w-full"
            size="lg"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sharing...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Share to Arcade
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
