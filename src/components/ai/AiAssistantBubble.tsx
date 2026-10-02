import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Pin } from 'lucide-react';
import { createPortal } from 'react-dom';
import { X, Send, Loader2, Mic, MicOff, RotateCcw, ThumbsUp } from 'lucide-react';
import { TheoOrb } from '@/components/dock/TheoOrb';
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
import { useTheoUnread } from '@/hooks/useTheoUnread';
import { TheoVoiceOverlay } from './TheoVoiceOverlay';
import { AudioLines } from 'lucide-react';


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
  const { count: theoUnreadCount, latestId: theoUnreadLatestId, markRead: markTheoRead } = useTheoUnread();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pinnedIndices, setPinnedIndices] = useState<Set<number>>(new Set());
  const [helpfulIndices, setHelpfulIndices] = useState<Set<number>>(new Set());
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const jumpToVoiceRef = useRef(false);
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

  // ── Load persisted chat history on open ──
  useEffect(() => {
    if (!open || !currentLocation?.id || historyLoaded) return;
    let cancelled = false;
    
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        
        const { data, error } = await supabase
          .from('theo_chat_messages' as any)
          .select('role, content')
          .eq('user_id', user.id)
          .eq('location_id', currentLocation.id)
          .eq('chat_date', today)
          .order('created_at', { ascending: true });
        
        if (error || cancelled) return;
        
        if (data && data.length > 0) {
          // Merge, never replace: keep messages added in memory (e.g. voice answers) that aren't saved yet.
          const loaded = data.map((m: any) => ({ role: m.role, content: m.content })) as Message[];
          setMessages(prev => {
            const pool = loaded.map(m => `${m.role}\u0000${m.content}`);
            const extra = prev.filter(m => {
              const i = pool.indexOf(`${m.role}\u0000${m.content}`);
              if (i === -1) return true;
              pool.splice(i, 1);
              return false;
            });
            return [...loaded, ...extra];
          });
          briefingLoadedRef.current = true; // skip briefing injection if we have history
          if (!jumpToVoiceRef.current) scrollToBottom();
        }
      } catch (e) {
        console.error('Failed to load chat history:', e);
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    
    return () => { cancelled = true; };
  }, [open, currentLocation?.id, today, historyLoaded]);

  // ── Persist a single message to DB ──
  const persistMessage = useCallback(async (msg: Message) => {
    if (!currentLocation?.id) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await (supabase.from('theo_chat_messages' as any) as any).insert({
        user_id: user.id,
        location_id: currentLocation.id,
        role: msg.role,
        content: msg.content,
        chat_date: today,
      });
    } catch (e) {
      console.error('Failed to persist chat message:', e);
    }
  }, [currentLocation?.id, today]);

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
    // Only after today's history has loaded, and only if it was empty (no duplicate brief rows).
    if (open && historyLoaded && briefing?.content && !briefingLoadedRef.current && messages.length === 0) {
      briefingLoadedRef.current = true;
      const briefingMsg: Message = { role: 'assistant', content: briefing.content };
      setMessages([briefingMsg]);
      persistMessage(briefingMsg);
      if (briefing.id) {
        markRead.mutate(briefing.id);
      }
      scrollToBottom();
    }
  }, [open, briefing, historyLoaded]);

  const [jumpTick, setJumpTick] = useState(0);
  useEffect(() => {
    if (!open || !historyLoaded || !jumpToVoiceRef.current) return;
    const t = setTimeout(() => {
      jumpToVoiceRef.current = false;
      const idx = messages.map(m => m.role === 'user' && m.content.startsWith('🎙️')).lastIndexOf(true);
      const box = scrollRef.current;
      const el = idx >= 0 ? box?.querySelector(`[data-msg-idx="${idx}"]`) as HTMLElement | null : null;
      if (box && el) box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 12 });
    }, 350);
    return () => clearTimeout(t);
  }, [open, historyLoaded, messages, jumpTick]);

  useEffect(() => {
    briefingLoadedRef.current = false;
    setMessages([]);
    setHistoryLoaded(false);
  }, [currentLocation?.id]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  // When the chat opens and there are unread Theo messages, mark them read
  // once the panel has settled (chat auto-scrolls to the newest, which is the
  // "scrolled into view" trigger the user requested).
  useEffect(() => {
    if (!open) return;
    if (theoUnreadCount === 0 || !theoUnreadLatestId) return;
    const t = setTimeout(() => {
      markTheoRead(theoUnreadLatestId).catch(() => { /* ignore */ });
    }, 450);
    return () => clearTimeout(t);
  }, [open, theoUnreadCount, theoUnreadLatestId, markTheoRead]);

  // Allow the manager-dash THEO orb (and other UI) to open Theo via a
  // global window event. Keeps the bubble decoupled from its triggers.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-theo', handler);
    return () => window.removeEventListener('open-theo', handler);
  }, []);

  // ── Theo voice: offer each 4-hour opener once per person per store ──
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceIntent, setVoiceIntent] = useState<'update' | 'talk'>('talk');
  useEffect(() => {
    if (!isShiftManager || !currentLocation?.id || !timezone) return;
    const check = async () => {
      if (document.visibilityState !== 'visible' || window.location.pathname.startsWith('/kiosk')) return;
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) return;
      const date = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
      const slot = Math.floor(Number(formatInTimeZone(new Date(), timezone, 'H')) / 4);
      const key = `${date}#${slot}`;
      const storeKey = `theo-voice-seen:${uid}:${currentLocation.id}`;
      if (localStorage.getItem(storeKey) === key) return;
      localStorage.setItem(storeKey, key);
      setVoiceIntent('update');
      setVoiceOpen(true);
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [isShiftManager, currentLocation?.id, timezone]);

  if (!isShiftManager) return null;

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  };

  const handleNewChat = async () => {
    setMessages([]);
    briefingLoadedRef.current = false;
    setHistoryLoaded(false);
    setInput('');
    // Clear today's messages from DB
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && currentLocation?.id) {
        await (supabase.from('theo_chat_messages' as any) as any)
          .delete()
          .eq('user_id', user.id)
          .eq('location_id', currentLocation.id)
          .eq('chat_date', today);
      }
    } catch (e) {
      console.error('Failed to clear chat history:', e);
    }
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

  const handleHelpful = async (msgIndex: number, answer: string) => {
    if (helpfulIndices.has(msgIndex)) return;
    // Optimistic update so the button feels instant
    setHelpfulIndices(prev => new Set(prev).add(msgIndex));
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Find the most recent user question above this assistant message
      let question: string | null = null;
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user') {
          question = messages[i].content;
          break;
        }
      }
      const { error } = await (supabase.from('theo_helpful_feedback' as any) as any).insert({
        user_id: user.id,
        location_id: currentLocation?.id ?? null,
        question,
        answer,
        message_index: msgIndex,
        chat_date: today,
      });
      if (error && error.code !== '23505') throw error; // 23505 = unique violation, already marked
      toast.success('Thanks — saved as helpful');
    } catch (e) {
      console.error('Helpful feedback error:', e);
      setHelpfulIndices(prev => {
        const next = new Set(prev);
        next.delete(msgIndex);
        return next;
      });
      toast.error('Could not save feedback');
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

    // Persist user message
    persistMessage(userMsg);

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

      const assistantMsg: Message = { role: 'assistant', content: data.content };
      setMessages(prev => [...prev, assistantMsg]);
      persistMessage(assistantMsg);
    } catch (e: any) {
      console.error('AI Assistant error:', e);
      toast.error('Failed to get response');
      const errorMsg: Message = { role: 'assistant', content: 'Sorry, I had trouble processing that. Please try again.' };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  };

  return createPortal(
    <>
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

            {/* Floating panel — drops down from the Ask Theo pill in the top bar */}
            <motion.div
              initial={{ y: '-105%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '-105%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed z-[60] flex flex-col bg-background overflow-hidden border border-border/30"
              style={{
                left: 0,
                right: 0,
                top: 'calc(env(safe-area-inset-top, 0px) + 4.5rem)',
                height: 'calc(100% - env(safe-area-inset-top, 0px) - 5.5rem)',
                borderRadius: '16px',
                margin: '0 8px',
                transformOrigin: 'top center',
                boxShadow: '0 25px 60px -15px rgba(0,0,0,0.4)',
              }}
            >
              {/* Header */}
              <div className="relative flex items-center justify-between gap-3 bg-accent py-3 pl-4 pr-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.18] ring-1 ring-inset ring-white/30">
                    <TheoOrb size={28} className="text-white pointer-events-none" />
                  </div>
                  <div>
                    <h3 className="text-[17px] font-extrabold leading-[1.1] tracking-[-0.01em] text-white">Theo</h3>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="h-[7px] w-[7px] rounded-full bg-emerald-400 animate-pulse" />
                      <p className="text-xs font-semibold text-white/90">{currentLocation?.name || 'AI Assistant'}</p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setOpen(false); setVoiceIntent('talk'); setVoiceOpen(true); }}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.16] text-white transition-colors hover:bg-white/25"
                    aria-label="Talk to Theo"
                  >
                    <AudioLines className="h-[18px] w-[18px]" />
                  </button>
                  {messages.length > 0 && (
                    <button
                      onClick={handleNewChat}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.16] text-white transition-colors hover:bg-white/25"
                      title="New chat"
                      aria-label="New chat"
                    >
                      <RotateCcw className="h-[18px] w-[18px]" />
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.16] text-white transition-colors hover:bg-white/25"
                    aria-label="Close Theo"
                  >
                    <X className="h-[18px] w-[18px]" strokeWidth={2.25} />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto bg-background">
                {messages.length === 0 && (
                  <div className="px-5 pt-10 pb-4 space-y-5">
                    <div className="text-center space-y-2">
                      <div className="mx-auto h-14 w-14 rounded-2xl overflow-hidden mb-3 flex items-center justify-center">
                        <TheoOrb size={56} className="text-primary pointer-events-none" />
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
                  <div className="mx-auto w-full max-w-[720px] space-y-3 px-3 pb-3 pt-3.5">
                    {(() => { const lastAssistantIdx = messages.map(m => m.role).lastIndexOf('assistant'); return messages.map((msg, i) => (
                      <motion.div
                        key={i}
                        data-msg-idx={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className={cn(msg.role === 'user' ? 'flex justify-end' : 'w-full')}
                      >
                        {msg.role === 'assistant' ? (
                          <div className="w-full">
                            <div className="mb-1.5 flex items-center gap-1.5">
                              <TheoOrb size={22} still={loading || i !== lastAssistantIdx} className="text-primary pointer-events-none" />
                              <span className="text-[13px] font-bold text-foreground">Theo</span>
                            </div>
                            <div className="rounded-2xl border border-border bg-card p-4">
                            <AiMarkdownRenderer content={msg.content} />
                            {!loading && i > 0 && (
                              <div className="mt-2 flex items-center gap-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); handlePin(i, msg.content); }}
                                disabled={pinnedIndices.has(i)}
                                className={cn(
                                  'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-all',
                                  pinnedIndices.has(i)
                                    ? 'text-green-500 bg-green-500/10'
                                    : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40'
                                )}
                              >
                                <Pin className="h-2.5 w-2.5" />
                                {pinnedIndices.has(i) ? 'Pinned' : 'Pin'}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleHelpful(i, msg.content); }}
                                disabled={helpfulIndices.has(i)}
                                className={cn(
                                  'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-all',
                                  helpfulIndices.has(i)
                                    ? 'text-primary bg-primary/10'
                                    : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40'
                                )}
                                aria-label={helpfulIndices.has(i) ? 'Marked helpful' : 'Mark as helpful'}
                              >
                                <ThumbsUp className="h-2.5 w-2.5" />
                                {helpfulIndices.has(i) ? 'Helpful' : 'Helpful'}
                              </button>
                              </div>
                            )}
                            </div>
                          </div>
                        ) : (
                          <div className="max-w-[82%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-[15px] leading-relaxed text-primary-foreground">
                            {msg.content}
                          </div>
                        )}
                      </motion.div>
                    )); })()}

                    {loading && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full"
                      >
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <TheoOrb size={22} className="text-primary pointer-events-none" />
                          <span className="text-[13px] font-bold text-foreground">Theo</span>
                        </div>
                        <div className="w-fit rounded-2xl border border-border bg-card px-4 py-3">
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
              <div className="border-t border-border/70 bg-background px-3 pt-2.5" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.875rem)' }}>
                <form
                  onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
                  className="mx-auto flex w-full max-w-[720px] items-center gap-1 rounded-full border border-border bg-card p-[5px] transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15"
                >
                  {voiceSupported && (
                    <button
                      type="button"
                      onClick={toggleListening}
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all',
                        isListening
                          ? 'bg-destructive text-destructive-foreground animate-pulse'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                      )}
                      aria-label={isListening ? 'Stop listening' : 'Start voice input'}
                    >
                      {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    </button>
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={isListening ? "Listening..." : "Ask Theo anything..."}
                    className="h-10 min-w-0 flex-1 bg-transparent px-1 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || loading}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all disabled:opacity-40"
                    aria-label="Send"
                  >
                    {loading ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Send className="h-[18px] w-[18px]" />}
                  </button>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <TheoVoiceOverlay intent={voiceIntent} open={voiceOpen} onClose={() => setVoiceOpen(false)} onOpenChat={() => setOpen(true)} onOpenAnswer={() => {
        // Land with the latest voice question at the top of the chat (done once history has loaded).
        jumpToVoiceRef.current = true;
        setOpen(true);
        setJumpTick(n => n + 1);
      }} onRecord={(text) => {
        const theoMsg = { role: 'assistant', content: text } as Message;
        setMessages(prev => [...prev, theoMsg]);
        void persistMessage(theoMsg);
      }} onExchange={(q, a) => {
        const userMsg = { role: 'user', content: `🎙️ ${q}` } as Message;
        const theoMsg = { role: 'assistant', content: a } as Message;
        setMessages(prev => [...prev, userMsg, theoMsg]);
        void persistMessage(userMsg).then(() => persistMessage(theoMsg));
      }} />
    </>,
    document.body
  );
}
