import { useRef, useState, useEffect, KeyboardEvent, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Paperclip, Send } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { GifPicker } from './GifPicker';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { getDisplayName } from '@/utils/displayName';

interface Profile {
  id: string;
  full_name: string;
  nickname?: string | null;
  profile_photo_url: string | null;
}

interface IMessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onGifSelect: (url: string) => void;
  chatId: string;
  disabled?: boolean;
  uploading?: boolean;
  replyTo?: {
    id: string;
    content: string | null;
    profiles?: { full_name: string } | null;
  } | null;
  onCancelReply?: () => void;
}

export function IMessageInput({
  value,
  onChange,
  onSend,
  onFileUpload,
  onGifSelect,
  chatId,
  disabled,
  uploading,
  replyTo,
  onCancelReply,
}: IMessageInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [chatMembers, setChatMembers] = useState<Profile[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const fetchChatMembers = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data, error } = await supabase
          .from('chat_members')
          .select('profiles(id, full_name, nickname, profile_photo_url, is_active, appears_on_schedule)')
          .eq('chat_id', chatId);

        if (error) throw error;
        const members = data?.map((m: any) => m.profiles).filter((p: any) => 
          p && p.id !== user?.id && p.is_active !== false && p.appears_on_schedule !== false
        ) || [];
        setChatMembers(members);
      } catch (error) {
        console.error('Error fetching chat members:', error);
      }
    };
    fetchChatMembers();
  }, [chatId]);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 120);
      textarea.style.height = `${newHeight}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const filteredMembers = chatMembers.filter(member =>
    getDisplayName(member.full_name, member.nickname)!.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    
    onChange(newValue);

    const textBeforeCursor = newValue.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');
    
    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(atIndex + 1);
      const charBeforeAt = atIndex > 0 ? newValue[atIndex - 1] : ' ';
      if ((charBeforeAt === ' ' || charBeforeAt === '\n' || atIndex === 0) && !textAfterAt.includes(' ')) {
        setMentionQuery(textAfterAt);
        setMentionStartIndex(atIndex);
        setShowSuggestions(true);
        setSelectedIndex(0);
        return;
      }
    }
    
    setShowSuggestions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);
  };

  const insertMention = (member: Profile) => {
    const beforeMention = value.substring(0, mentionStartIndex);
    const cursorPos = textareaRef.current?.selectionStart || (mentionStartIndex + mentionQuery.length + 1);
    const afterMention = value.substring(cursorPos);
    const displayName = getDisplayName(member.full_name, member.nickname)!;
    const newValue = beforeMention + `@${displayName} ` + afterMention.replace(/^\s+/, '');
    
    onChange(newValue);
    setShowSuggestions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);
    
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursorPos = beforeMention.length + displayName.length + 2;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filteredMembers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredMembers.length) % filteredMembers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMembers[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }
    
    if (e.key === 'Enter' && !e.shiftKey && !showSuggestions) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div 
      className="px-3 pb-kb-safe pt-2 flex-shrink-0 bg-background"
    >
      {/* Reply preview */}
      {replyTo && (
        <div className="mb-2 mx-1 px-3 py-2 bg-muted/50 rounded-xl flex items-center justify-between backdrop-blur-sm">
          <div className="text-sm min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              Replying to {getDisplayName(replyTo.profiles?.full_name, replyTo.profiles?.nickname) || 'Unknown'}
            </p>
            <p className="truncate text-foreground/80">{replyTo.content || 'Attachment'}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 rounded-full"
            onClick={onCancelReply}
          >
            ×
          </Button>
        </div>
      )}

      {/* Mention suggestions */}
      {showSuggestions && filteredMembers.length > 0 && (
        <div className="mb-2 mx-1 bg-popover border border-border rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
          {filteredMembers.map((member, index) => (
            <button
              key={member.id}
              type="button"
              className={cn(
                'w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-accent transition-colors',
                index === selectedIndex && 'bg-accent',
                index === 0 && 'rounded-t-xl',
                index === filteredMembers.length - 1 && 'rounded-b-xl'
              )}
              onClick={() => insertMention(member)}
            >
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                {member.profile_photo_url ? (
                  <img src={member.profile_photo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-medium">{getDisplayName(member.full_name, member.nickname)?.charAt(0)}</span>
                )}
              </div>
              <span className="text-sm font-medium">{getDisplayName(member.full_name, member.nickname)}</span>
            </button>
          ))}
        </div>
      )}

      {/* iMessage-style capsule input */}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onFileUpload}
          accept="image/*,.pdf,.doc,.docx"
        />

        <div className={cn(
          'flex-1 flex items-end gap-1 rounded-full',
          'bg-muted/60 backdrop-blur-md',
          'border border-border/50',
          'px-1.5 py-1',
          'shadow-sm'
        )}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full flex-shrink-0 hover:bg-muted"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Paperclip className="h-4 w-4 text-muted-foreground" />
          </Button>

          <div className="flex-shrink-0 [&>button]:border-0 [&>button]:shadow-none [&>button]:h-8 [&>button]:w-8 [&>button]:rounded-full [&>button]:hover:bg-muted">
            <GifPicker onSelect={onGifSelect} />
          </div>

          <div className="flex-1 min-w-0">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Message"
              disabled={disabled}
              rows={1}
              className="bg-transparent border-0 shadow-none ring-0 focus-visible:ring-0 min-h-[36px] py-2 resize-none text-base"
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            />
          </div>

          {(value.trim() || uploading) && (
            <Button
              onClick={onSend}
              disabled={disabled || uploading}
              size="icon"
              className="h-8 w-8 rounded-full flex-shrink-0 bg-primary hover:bg-primary/90"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}