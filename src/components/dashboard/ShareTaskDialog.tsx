import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useLocation } from "@/hooks/useLocation";
import { toast } from "sonner";
import { Send, Search, Users, User, MessageSquare } from "lucide-react";

interface Chat {
  id: string;
  title: string | null;
  is_group: boolean;
  group_image_url: string | null;
  otherMember?: {
    first_name: string;
    last_name: string;
    avatar_url: string | null;
  };
}

interface ShareTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  taskDetails?: string;
  accentColor?: string;
}

export function ShareTaskDialog({
  open,
  onOpenChange,
  taskTitle,
  taskDetails,
  accentColor,
}: ShareTaskDialogProps) {
  const { user } = useAuth();
  const { currentLocation } = useLocation();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (open && user) {
      fetchChats();
    }
  }, [open, user]);

  const fetchChats = async () => {
    if (!user) return;
    setLoading(true);
    
    try {
      // Get chats user is a member of
      const { data: memberships, error: memberError } = await supabase
        .from("chat_members")
        .select("chat_id")
        .eq("user_id", user.id);

      if (memberError) throw memberError;
      if (!memberships?.length) {
        setChats([]);
        return;
      }

      const chatIds = memberships.map((m) => m.chat_id);

      // Fetch chat details
      const { data: chatsData, error: chatsError } = await supabase
        .from("chats")
        .select("id, title, is_group, group_image_url")
        .in("id", chatIds)
        .eq("is_announcement", false);

      if (chatsError) throw chatsError;

      // For DMs, get the other member's info
      const chatList: Chat[] = [];
      
      for (const chat of chatsData || []) {
        if (chat.is_group) {
          chatList.push(chat);
        } else {
          // Get the other member for DMs
          const { data: members } = await supabase
            .from("chat_members")
            .select("user_id, profiles:user_id(first_name, last_name, avatar_url)")
            .eq("chat_id", chat.id)
            .neq("user_id", user.id)
            .limit(1);

          const otherMember = members?.[0]?.profiles as any;
          chatList.push({
            ...chat,
            otherMember: otherMember ? {
              first_name: otherMember.first_name,
              last_name: otherMember.last_name,
              avatar_url: otherMember.avatar_url,
            } : undefined,
          });
        }
      }

      setChats(chatList);
    } catch (error) {
      console.error("Error fetching chats:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async (chat: Chat) => {
    if (!user) return;
    setSending(true);

    try {
      // Build the message content
      let messageContent = `📋 **Task Alert**\n\n**${taskTitle}**`;
      if (taskDetails) {
        messageContent += `\n${taskDetails}`;
      }

      // Send the message
      const { error } = await supabase.from("messages").insert({
        chat_id: chat.id,
        sender_id: user.id,
        content: messageContent,
      });

      if (error) throw error;

      // Get chat members for push notification
      const { data: members } = await supabase
        .from("chat_members")
        .select("user_id")
        .eq("chat_id", chat.id)
        .neq("user_id", user.id);

      // Send push notifications
      if (members && members.length > 0) {
        const recipientIds = members.map((m) => m.user_id);
        
        // Get sender's name
        const { data: senderProfile } = await supabase
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", user.id)
          .single();

        const senderName = senderProfile 
          ? `${(senderProfile as any).first_name} ${(senderProfile as any).last_name}` 
          : "Someone";

        await supabase.functions.invoke("send-push-notification", {
          body: {
            user_ids: recipientIds,
            title: chat.is_group ? (chat.title || "Group Chat") : senderName,
            body: `📋 Task: ${taskTitle}`,
            data: {
              type: "message",
              chatId: chat.id,
            },
          },
        });
      }

      const chatName = chat.is_group 
        ? chat.title 
        : `${chat.otherMember?.first_name} ${chat.otherMember?.last_name}`;
      
      toast.success(`Shared to ${chatName}`);
      onOpenChange(false);
    } catch (error) {
      console.error("Error sharing task:", error);
      toast.error("Failed to share task");
    } finally {
      setSending(false);
    }
  };

  const getChatDisplayName = (chat: Chat) => {
    if (chat.is_group) {
      return chat.title || "Group Chat";
    }
    return chat.otherMember 
      ? `${chat.otherMember.first_name} ${chat.otherMember.last_name}`
      : "Unknown";
  };

  const getAvatarContent = (chat: Chat) => {
    if (chat.is_group) {
      return {
        src: chat.group_image_url,
        fallback: <Users className="h-4 w-4" />,
      };
    }
    return {
      src: chat.otherMember?.avatar_url,
      fallback: chat.otherMember 
        ? `${chat.otherMember.first_name?.[0] || ""}${chat.otherMember.last_name?.[0] || ""}`
        : <User className="h-4 w-4" />,
    };
  };

  const filteredChats = chats.filter((chat) => {
    if (!searchQuery) return true;
    const name = getChatDisplayName(chat).toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Share Task
          </DialogTitle>
        </DialogHeader>

        {/* Task Preview */}
        <div 
          className="p-3 rounded-lg border-l-4 bg-muted/50"
          style={{ borderLeftColor: accentColor || "hsl(var(--primary))" }}
        >
          <p className="font-medium text-sm">{taskTitle}</p>
          {taskDetails && (
            <p className="text-xs text-muted-foreground mt-1">{taskDetails}</p>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Chat List */}
        <ScrollArea className="h-[250px]">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageSquare className="h-8 w-8 mb-2" />
              <p className="text-sm">No chats found</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredChats.map((chat) => {
                const avatar = getAvatarContent(chat);
                return (
                  <button
                    key={chat.id}
                    onClick={() => handleShare(chat)}
                    disabled={sending}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={avatar.src || undefined} />
                      <AvatarFallback className="text-xs">
                        {typeof avatar.fallback === "string" ? avatar.fallback : avatar.fallback}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 text-left min-w-0">
                      <p className="font-medium text-sm truncate">
                        {getChatDisplayName(chat)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {chat.is_group ? "Group" : "Direct Message"}
                      </p>
                    </div>
                    <Send className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
