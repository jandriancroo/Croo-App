import { useMemo } from 'react';

import { ShiftOfferMessage } from "./ShiftOfferMessage";
import { SharedTaskMessage } from "./SharedTaskMessage";

interface Profile {
  id: string;
  full_name: string;
}

interface MessageContentProps {
  content: string;
  chatId: string;
  senderName?: string;
  chatMembers?: Profile[];
}

export function MessageContent({ content, chatId, senderName, chatMembers = [] }: MessageContentProps) {
  const renderedContent = useMemo(() => {
    // Check if this is a shift offer message
    if (content?.startsWith("SHIFT_OFFER:")) {
      const offerId = content.replace("SHIFT_OFFER:", "");
      return <ShiftOfferMessage offerId={offerId} messageId={chatId} />;
    }

    // Check if this is a shared task message
    if (content?.startsWith("SHARED_TASK:")) {
      const taskData = content.replace("SHARED_TASK:", "");
      const parts = taskData.split("|||");
      const title = parts[0] || "Task";
      const details = parts[1] || undefined;
      const accentColor = parts[2] || "#8B5CF6";
      return <SharedTaskMessage title={title} details={details} accentColor={accentColor} senderName={senderName || 'Someone'} />;
    }

    if (!chatMembers.length) {
      return <span className="whitespace-pre-wrap">{content}</span>;
    }

    const mentionedUsers: { name: string; startIndex: number; endIndex: number }[] = [];

    chatMembers.forEach((profile) => {
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

    mentionedUsers.sort((a, b) => a.startIndex - b.startIndex);

    if (mentionedUsers.length === 0) {
      return <span className="whitespace-pre-wrap">{content}</span>;
    }

    const elements: React.ReactNode[] = [];
    let lastIndex = 0;

    mentionedUsers.forEach((mention, idx) => {
      if (mention.startIndex > lastIndex) {
        elements.push(
          <span key={`text-${idx}`}>
            {content.substring(lastIndex, mention.startIndex)}
          </span>
        );
      }

      elements.push(
        <span
          key={`mention-${idx}`}
          className="bg-primary-foreground/15 font-semibold px-1 rounded"
        >
          @{mention.name}
        </span>
      );

      lastIndex = mention.endIndex;
    });

    if (lastIndex < content.length) {
      elements.push(
        <span key="text-final">
          {content.substring(lastIndex)}
        </span>
      );
    }

    return <span className="whitespace-pre-wrap">{elements}</span>;
  }, [content, chatMembers]);

  return renderedContent;
}
