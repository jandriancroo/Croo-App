import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  chatId: string;
}

export function MentionInput({ 
  value, 
  onChange, 
  onKeyDown,
  placeholder, 
  disabled, 
  chatId 
}: MentionInputProps) {
  const [chatMembers, setChatMembers] = useState<Profile[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchChatMembers();
  }, [chatId]);

  const fetchChatMembers = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('chat_members')
        .select('profiles(id, full_name, profile_photo_url)')
        .eq('chat_id', chatId);

      if (error) throw error;
      // Filter out current user from suggestions
      const members = data?.map((m: any) => m.profiles).filter((p: Profile) => p && p.id !== user?.id) || [];
      setChatMembers(members);
    } catch (error) {
      console.error('Error fetching chat members:', error);
    }
  };

  const filteredMembers = chatMembers.filter(member =>
    member.full_name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    
    onChange(newValue);

    // Check if we should show mention suggestions
    const textBeforeCursor = newValue.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');
    
    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(atIndex + 1);
      // Only show if @ is at start or preceded by whitespace, and no space after @
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
    const afterMention = value.substring(mentionStartIndex + mentionQuery.length + 1);
    const newValue = `${beforeMention}@${member.full_name} ${afterMention}`;
    
    onChange(newValue);
    setShowSuggestions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);
    
    // Focus input and set cursor position
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const newCursorPos = beforeMention.length + member.full_name.length + 2;
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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
    
    // Call parent onKeyDown if not handled
    onKeyDown?.(e);
  };

  return (
    <div className="relative flex-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        onBlur={() => {
          // Delay hiding to allow click on suggestion
          setTimeout(() => setShowSuggestions(false), 150);
        }}
      />
      
      {showSuggestions && filteredMembers.length > 0 && (
        <div 
          ref={suggestionsRef}
          className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto"
        >
          {filteredMembers.map((member, index) => (
            <button
              key={member.id}
              type="button"
              className={`w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-accent transition-colors ${
                index === selectedIndex ? 'bg-accent' : ''
              }`}
              onClick={() => insertMention(member)}
            >
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                {member.profile_photo_url ? (
                  <img src={member.profile_photo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-medium">{member.full_name.charAt(0)}</span>
                )}
              </div>
              <span className="text-sm font-medium">{member.full_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
