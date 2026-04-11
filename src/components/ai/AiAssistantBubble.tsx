import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Pin } from 'lucide-react';
import { createPortal } from 'react-dom';
import { X, Send, Loader2, Sparkles, Mic, MicOff, RotateCcw } from 'lucide-react';
import theoAvatar from '@/assets/theo-avatar.png';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useUserRole } from '@/hooks/useUserRole';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AiMarkdownRenderer } from './AiMarkdownRenderer';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone } from 'date-fns-tz';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { motion, AnimatePresence } from 'framer-motion';

/* Clean 4-point star — no tiny accent dots */
/* Clean 4-point star */
const Star4 = ({ size }: { size: number }) => (
  <svg width={size * 2} height={size * 2} viewBox="0 0 20 20" fill="none">
    <path
      d="M10,0 Q10.8,8 20,10 Q10.8,12 10,20 Q9.2,12 0,10 Q9.2,8 10,0Z"
      fill="white"
    />
  </svg>
);

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  { icon: '📊', text: "What were net sales today?" },
  { icon: '⏰', text: "Who clocked in late today?" },
  { icon: '🎓', text: "@OPUS What training modules do we have?" },
  { icon: '📋', text: "Who's scheduled tomorrow?" },
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
  const [pinnedIndices, setPinnedIndices] = useState<Set<number>>(new Set());
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

  const today = useMemo(() => {
    return formatInTimeZone(new Date(), timezone || 'America/Los_Angeles', 'yyyy-MM-dd');
  }, [timezone]);

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

  useEffect(() => {
    if (open && briefing?.content && !briefingLoadedRef.current && messages.length === 0) {
      briefingLoadedRef.current = true;
      setMessages([{ role: 'assistant', content: briefing.content }]);
      if (briefing.id) {
        markRead.mutate(briefing.id);
      }
      scrollToBottom();
    }
  }, [open, briefing]);

  useEffect(() => {
    briefingLoadedRef.current = false;
    setMessages([]);
  }, [currentLocation?.id]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  if (!isShiftManager) return null;

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  };

  const handleNewChat = () => {
    setMessages([]);
    briefingLoadedRef.current = false;
    setInput('');
  };

  const handlePin = async (msgIndex: number, content: string) => {
    if (!currentLocation) return;
    try {
      const { data, error } = await supabase.functions.invoke('theo-memory', {
        body: { action: 'save', location_id: currentLocation.id, content, topic: 'general' },
      });
      if (error) throw error;
      setPinnedIndices(prev => new Set(prev).add(msgIndex));
      toast.success('Pinned to Theo\'s memory');
    } catch (e) {
      console.error('Pin error:', e);
      toast.error('Failed to save to memory');
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading || !currentLocation) return;
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
      {/* ── Side Tab (right edge) ── */}
      <AnimatePresence initial={false}>
        {!open && (
          <motion.button
            initial={{ x: 60 }}
            animate={{ x: 0 }}
            exit={{ x: 60 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={() => setOpen(true)}
            className="fixed right-0 z-[55] flex flex-col items-center justify-center gap-1.5 bg-accent rounded-l-xl"
            style={{
              top: '50%',
              transform: 'translateY(-50%)',
              width: 36,
              height: 110,
              boxShadow: '-4px 2px 12px rgba(0,0,0,0.2), -1px 0 4px rgba(0,0,0,0.08)',
            }}
            aria-label="Open Theo"
          >
            <Star4 size={4} />
            <Star4 size={8} />
            <Star4 size={3.5} />
            {hasUnreadBriefing && (
              <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-white animate-pulse" />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Backdrop + Panel ── */}
      <AnimatePresence>
        {open && (
          <>
            {/* Blurred backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[58] bg-black/50 backdrop-blur-sm"
            />

            {/* Floating panel — full width, 75% height, vertically centered */}
            <motion.div
              initial={{ x: '100%', opacity: 0.5 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed z-[60] flex flex-col bg-background overflow-hidden border border-border/30"
              style={{
                left: 0,
                right: 0,
                top: '12.5%',
                height: '75%',
                borderRadius: 16,
                margin: '0 8px',
                boxShadow: '0 25px 60px -15px rgba(0,0,0,0.4)',
              }}
            >
              {/* Header — orange gradient matching dock */}
              <div className="relative flex items-center justify-between px-4 py-3 border-b border-white/10 bg-accent">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl overflow-hidden ring-2 ring-white/20">
                    <img src={theoAvatar} alt="Theo" className="h-full w-full object-cover" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-bold text-white tracking-tight">Theo</h3>
                      <Sparkles className="h-3 w-3 text-white/80" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <p className="text-[10px] text-white/70 font-medium">{currentLocation?.name || 'AI Assistant'}</p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {messages.length > 0 && (
                    <button
                      onClick={handleNewChat}
                      className="p-2 rounded-xl hover:bg-white/15 transition-colors"
                      title="New chat"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-white/70" />
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    className="p-2 rounded-xl hover:bg-white/15 transition-colors"
                  >
                    <X className="h-4 w-4 text-white/80" />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto crooai-messages-bg">
                {messages.length === 0 && (
                  <div className="px-5 pt-10 pb-4 space-y-5">
                    <div className="text-center space-y-2">
                      <div className="mx-auto h-14 w-14 rounded-2xl overflow-hidden mb-3">
                        <img src={theoAvatar} alt="Theo" className="h-full w-full object-cover" />
                      </div>
                      <p className="text-base font-semibold text-foreground">What can I help with?</p>
                      <p className="text-xs text-muted-foreground leading-relaxed max-w-[260px] mx-auto">
                        Sales, labor, schedules, checklists — I have access to your live store data.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-2 pt-1">
                      {SUGGESTIONS.map((s, i) => (
                        <motion.button
                          key={i}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.06 }}
                          onClick={() => sendMessage(s.text)}
                          className="crooai-suggestion-card flex items-center gap-2.5 text-left text-[13px] px-3.5 py-2.5 rounded-xl border border-border/40 text-muted-foreground hover:text-foreground transition-all"
                        >
                          <span className="text-base shrink-0">{s.icon}</span>
                          <span>{s.text}</span>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.length > 0 && (
                  <div className="px-4 py-3 space-y-3">
                    {messages.map((msg, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                      >
                        {msg.role === 'assistant' && (
                        <div className="h-6 w-6 rounded-lg overflow-hidden mr-2 mt-1 shrink-0">
                            <img src={theoAvatar} alt="Theo" className="h-full w-full object-cover" />
                          </div>
                        )}
                        <div
                          className={cn(
                            'max-w-[82%] text-sm',
                            msg.role === 'user'
                              ? 'crooai-user-bubble rounded-2xl rounded-br-md px-3.5 py-2.5'
                              : 'crooai-ai-bubble rounded-2xl rounded-bl-md px-3.5 py-2.5'
                          )}
                        >
                        <div className="flex flex-col gap-1">
                          {msg.role === 'assistant' ? (
                            <AiMarkdownRenderer content={msg.content} />
                          ) : (
                            <span className="leading-relaxed">{msg.content}</span>
                          )}
                          {msg.role === 'assistant' && !loading && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handlePin(i, msg.content); }}
                              disabled={pinnedIndices.has(i)}
                              className={cn(
                                'self-start flex items-center gap-1 text-[10px] mt-1 px-1.5 py-0.5 rounded-md transition-all',
                                pinnedIndices.has(i)
                                  ? 'text-green-500 bg-green-500/10'
                                  : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40'
                              )}
                            >
                              <Pin className="h-2.5 w-2.5" />
                              {pinnedIndices.has(i) ? 'Pinned' : 'Pin'}
                            </button>
                          )}
                        </div>
                        </div>
                      </motion.div>
                    ))}

                    {loading && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex justify-start"
                      >
                        <div className="h-6 w-6 rounded-lg overflow-hidden mr-2 mt-1 shrink-0">
                          <img src={theoAvatar} alt="Theo" className="h-full w-full object-cover" />
                        </div>
                        <div className="crooai-ai-bubble rounded-2xl rounded-bl-md px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <div className="crooai-typing-dot h-2 w-2 rounded-full" style={{ animationDelay: '0ms' }} />
                            <div className="crooai-typing-dot h-2 w-2 rounded-full" style={{ animationDelay: '150ms' }} />
                            <div className="crooai-typing-dot h-2 w-2 rounded-full" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="crooai-input-bar px-3 py-3 border-t border-border/30" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
                <form
                  onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
                  className="crooai-input-field flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all"
                >
                  {voiceSupported && (
                    <button
                      type="button"
                      onClick={toggleListening}
                      className={cn(
                        'p-1.5 rounded-lg transition-all shrink-0',
                        isListening
                          ? 'bg-destructive text-destructive-foreground animate-pulse'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
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
                    placeholder={isListening ? "Listening..." : "Ask Theo anything..."}
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none min-w-0"
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || loading}
                    className="crooai-send-btn p-2 rounded-xl disabled:opacity-20 transition-all shrink-0"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
}
