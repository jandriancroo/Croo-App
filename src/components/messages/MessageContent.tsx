import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

import { ShiftOfferMessage } from "./ShiftOfferMessage";

interface MessageContentProps {
  content: string;
  chatId: string;
}

interface Profile {
  id: string;
  full_name: string;
}

export function MessageContent({ content, chatId }: MessageContentProps) {
  // Check if this is a shift offer message
  if (content?.startsWith("SHIFT_OFFER:")) {
    const offerId = content.replace("SHIFT_OFFER:", "");
    return <ShiftOfferMessage offerId={offerId} messageId={chatId} />;
  }

  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    fetchChatMembers();
  }, [chatId]);

  const fetchChatMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('chat_members')
        .select('profiles(id, full_name)')
        .eq('chat_id', chatId);

      if (error) throw error;
      setProfiles(data?.map((m: any) => m.profiles) || []);
    } catch (error) {
      console.error('Error fetching chat members:', error);
    }
  };

  const renderContentWithMentions = () => {
    let processedContent = content;
    const mentionedUsers: { name: string; startIndex: number; endIndex: number }[] = [];

    // Find all potential @mentions
    profiles.forEach((profile) => {
      const fullNamePattern = new RegExp(`@${profile.full_name}\\b`, 'gi');
      let match;
      
      while ((match = fullNamePattern.exec(content)) !== null) {
        mentionedUsers.push({
          name: profile.full_name,
          startIndex: match.index,
          endIndex: match.index + match[0].length
        });
      }
    });

    // Sort mentions by position (for proper rendering)
    mentionedUsers.sort((a, b) => a.startIndex - b.startIndex);

    if (mentionedUsers.length === 0) {
      return <span className="whitespace-pre-wrap">{content}</span>;
    }

    // Build JSX with mentions highlighted
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;

    mentionedUsers.forEach((mention, idx) => {
      // Add text before mention
      if (mention.startIndex > lastIndex) {
        elements.push(
          <span key={`text-${idx}`}>
            {content.substring(lastIndex, mention.startIndex)}
          </span>
        );
      }

      // Add highlighted mention
      elements.push(
        <span
          key={`mention-${idx}`}
          className="bg-primary/20 text-primary font-semibold px-1 rounded"
        >
          @{mention.name}
        </span>
      );

      lastIndex = mention.endIndex;
    });

    // Add remaining text
    if (lastIndex < content.length) {
      elements.push(
        <span key="text-final">
          {content.substring(lastIndex)}
        </span>
      );
    }

    return <span className="whitespace-pre-wrap">{elements}</span>;
  };

  return renderContentWithMentions();
}