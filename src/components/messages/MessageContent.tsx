import { useMemo } from 'react';

import { ShiftOfferMessage } from "./ShiftOfferMessage";
import { GameScoreMessage } from "./GameScoreMessage";
import { SmackTalkMessage } from "./SmackTalkMessage";
import { SharedTaskMessage } from "./SharedTaskMessage";

interface SmackTalkOverlay {
  text: string;
  senderName: string;
}

interface Profile {
  id: string;
  full_name: string;
}

interface MessageContentProps {
  content: string;
  chatId: string;
  senderName?: string;
  smackTalks?: SmackTalkOverlay[];
  chatMembers?: Profile[]; // Now passed from parent - no more N+1 queries!
}

export function MessageContent({ content, chatId, senderName, smackTalks = [], chatMembers = [] }: MessageContentProps) {
  // Memoize mention rendering for performance - MUST be before any early returns
  const renderedContent = useMemo(() => {
    // Check if this is a shift offer message
    if (content?.startsWith("SHIFT_OFFER:")) {
      const offerId = content.replace("SHIFT_OFFER:", "");
      return <ShiftOfferMessage offerId={offerId} messageId={chatId} />;
    }

    // Check if this is a game score message
    if (content?.startsWith("GAME_SCORE:")) {
      const parts = content.replace("GAME_SCORE:", "").split(":");
      if (parts.length >= 3) {
        const gameType = parts[0];
        const score = parseInt(parts[1], 10);
        const playerName = parts.slice(2).join(":");
        return <GameScoreMessage gameType={gameType} score={score} playerName={playerName} smackTalks={smackTalks} />;
      }
    }

    // Check if this is a smack talk message
    if (content?.startsWith("SMACK_TALK:")) {
      const smackText = content.replace("SMACK_TALK:", "");
      return <SmackTalkMessage text={smackText} senderName={senderName || 'Someone'} />;
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

    // Find all potential @mentions
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
          className="bg-primary-foreground/15 font-semibold px-1 rounded"
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
  }, [content, chatMembers]);

  return renderedContent;
}
