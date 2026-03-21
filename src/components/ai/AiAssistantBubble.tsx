import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Loader2, Sparkles, Mic, MicOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useUserRole } from '@/hooks/useUserRole';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone } from 'date-fns-tz';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  "What were net sales today?",
  "Who clocked in late today?",
  "Who temped the tomatoes on AM Line Check?",
  "Who's scheduled tomorrow?",
];

export function AiAssistantBubble() {
  const { isShiftManager } = useUserRole();
  const { currentLocation } = useLocation();
  const { timezone } = useLocationTimezone();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const briefingLoadedRef = useRef(false);

  // Voice input — appends transcript to input field
  const handleTranscript = useCallback((transcript: string) => {
    setInput(prev => {
      const spacer = prev && !prev.endsWith(' ') ? ' ' : '';
      return prev + spacer + transcript;
    });
  }, []);

  const { isListening, isSupported: voiceSupported, toggleListening } = useVoiceInput({
    onTranscript: handleTranscript,
    continuous: true,
    silenceTimeoutMs: 6000,
  });

  // Get today's date in location timezone
  const today = useMemo(() => {
    return formatInTimeZone(new Date(), timezone || 'America/Los_Angeles', 'yyyy-MM-dd');
  }, [timezone]);

  // Fetch today's briefing for unread dot
  const { data: briefing } = useQuery({
    queryKey: ['croo-ai-briefing', currentLocation?.id, today],
    queryFn: async () => {
      if (!currentLocation) return null;
      const { data, error } = await supabase
        .from('croo_ai_briefings')
        .select('id, content, briefing_date')
        .eq('location_id', currentLocation.id)
        .eq('briefing_date', today)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation && isShiftManager,
    staleTime: 5 * 60 * 1000,
  });

  // Check if current user has read today's briefing
  const { data: hasRead } = useQuery({
    queryKey: ['croo-ai-briefing-read', briefing?.id],
    queryFn: async () => {
      if (!briefing?.id) return true;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return true;
      const { data, error } = await supabase
        .from('croo_ai_briefing_reads')
        .select('id')
        .eq('briefing_id', briefing.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) return true;
      return !!data;
    },
    enabled: !!briefing?.id,
    staleTime: 30 * 1000,
  });

  // Mark briefing as read
  const markRead = useMutation({
    mutationFn: async (briefingId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('croo_ai_briefing_reads')
        .upsert({ briefing_id: briefingId, user_id: user.id }, { onConflict: 'briefing_id,user_id' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['croo-ai-briefing-read'] });
    },
  });

  const hasUnreadBriefing = !!briefing && !hasRead;

  // When opening the chat, inject the morning briefing as the first assistant message
  useEffect(() => {
    if (open && briefing?.content && !briefingLoadedRef.current && messages.length === 0) {
      briefingLoadedRef.current = true;
      setMessages([{ role: 'assistant', content: briefing.content }]);
      // Mark as read
      if (briefing.id) {
        markRead.mutate(briefing.id);
      }
      scrollToBottom();
    }
  }, [open, briefing]);

  // Reset briefing loaded flag when location changes
  useEffect(() => {
    briefingLoadedRef.current = false;
    setMessages([]);
  }, [currentLocation?.id]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  // Don't render for non-managers
  if (!isShiftManager) return null;

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading || !currentLocation) return;

    // Stop listening when sending
    if (isListening) toggleListening();

    const userMsg: Message = { role: 'user', content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    scrollToBottom();

    try {
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: {
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          location_id: currentLocation.id,
          location_name: currentLocation.name,
        },
      });

      if (error) throw error;

      if (data?.error) {
        if (data.error.includes('Rate limit')) {
          toast.error('Too many requests. Please wait a moment.');
        } else {
          toast.error(data.error);
        }
        return;
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);
    } catch (e: any) {
      console.error('AI Assistant error:', e);
      toast.error('Failed to get response');
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I had trouble processing that. Please try again.' }]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  };

  return createPortal(
    <>
      {/* Floating bubble */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="crooai-orb crooai-orb-floating z-[55] h-14 w-14 rounded-full shadow-xl hover:shadow-2xl hover:scale-110 transition-all flex items-center justify-center"
          aria-label="Open AI Assistant"
        >
          <Sparkles className="h-5 w-5 text-[hsl(43_80%_62%)] drop-shadow-[0_0_6px_hsl(43_80%_55%/0.6)]" style={{ animation: 'crooai-icon-spin 5s ease-in-out infinite' }} />
          {hasUnreadBriefing && (
            <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-destructive border-2 border-background animate-pulse" />
          )}
        </button>
      )}

      {/* Chat overlay */}
      {open && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-background md:inset-auto md:bottom-8 md:right-4 md:w-[400px] md:h-[560px] md:rounded-2xl md:border md:border-border/50 md:shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-primary/5">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">CrooAI</h3>
                <p className="text-[10px] text-muted-foreground">{currentLocation?.name || 'Assistant'}</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-4 pt-8">
                <div className="text-center">
                  <Sparkles className="h-8 w-8 text-primary/30 mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">Ask me anything about your store</p>
                  <p className="text-xs text-muted-foreground mt-1">Sales, labor, schedules, checklists — I have access to your live data</p>
                </div>
                <div className="grid grid-cols-1 gap-2 pt-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(s)}
                      className="text-left text-xs px-3 py-2 rounded-lg border border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  'flex',
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-muted/50 text-foreground rounded-bl-md'
                  )}
                >
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5 [&_table]:text-xs">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted/50 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-primary/40 animate-bounce [animation-delay:0ms]" />
                    <div className="h-2 w-2 rounded-full bg-primary/40 animate-bounce [animation-delay:150ms]" />
                    <div className="h-2 w-2 rounded-full bg-primary/40 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-3 border-t border-border/50" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
            <form
              onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
              className="flex items-center gap-2 bg-muted/50 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-primary/30 transition-all"
            >
              {/* Mic button */}
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  className={cn(
                    'p-1.5 rounded-lg transition-all shrink-0',
                    isListening
                      ? 'bg-destructive text-destructive-foreground animate-pulse'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                  aria-label={isListening ? 'Stop listening' : 'Start voice input'}
                >
                  {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              )}
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isListening ? "Listening..." : "Ask about sales, labor, checklists..."}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-w-0"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="p-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-30 transition-opacity shrink-0"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </form>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
