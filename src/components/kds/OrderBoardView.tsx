import { cn } from '@/lib/utils';
import { Clock, CheckCircle2, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { KDSOrder } from './KDSGridView';

function getElapsed(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins > 0) return `${mins}m`;
  return `${Math.floor((ms % 60000) / 1000)}s`;
}

function getChannelTone(channel: string | null) {
  const ch = (channel || '').toLowerCase();
  if (ch.includes('doordash')) return 'border-l-red-500';
  if (ch.includes('ubereats')) return 'border-l-emerald-500';
  if (ch.includes('grubhub')) return 'border-l-orange-500';
  if (ch === 'olo') return 'border-l-amber-500';
  return 'border-l-sky-500';
}

interface Props {
  orders: KDSOrder[];
  onClear: (checkNumber: string) => void;
  clearing: string | null;
}

export function OrderBoardView({ orders, onClear, clearing }: Props) {
  const preparing = orders.filter((order) => order.status === 'open');
  const ready = orders.filter((order) => order.status === 'ready');

  return (
    <div className="grid min-h-[400px] grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-secondary-foreground">
            <Clock className="h-3.5 w-3.5 text-secondary" />
            Preparing
          </span>
          <span className="tabular-nums text-[11px] font-bold text-muted-foreground">{preparing.length}</span>
        </div>

        <div className="max-h-[500px] space-y-1 overflow-y-auto p-2">
          <AnimatePresence mode="popLayout">
            {preparing.map((order) => (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border-l-4 bg-muted/30 px-3 py-2',
                  getChannelTone(order.channel)
                )}
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-foreground">
                    {order.customer_name || 'Guest'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    #{order.check_number} · {order.order_type || order.channel}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                  {getElapsed(order.opened_at)}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>

          {preparing.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">No orders preparing</div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-primary/30 bg-primary/5">
        <div className="flex items-center justify-between border-b border-primary/20 px-4 py-2.5">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ready for Pickup
          </span>
          <span className="tabular-nums text-[11px] font-bold text-primary/60">{ready.length}</span>
        </div>

        <div className="max-h-[500px] space-y-1.5 overflow-y-auto p-2">
          <AnimatePresence mode="popLayout">
            {ready.map((order) => (
              <motion.button
                key={order.id}
                layout
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85, x: 40 }}
                onClick={() => onClear(order.check_number)}
                className={cn(
                  'relative w-full rounded-xl border px-4 py-3 text-left transition-all group',
                  clearing === order.check_number
                    ? 'border-primary/40 bg-primary/20'
                    : 'border-primary/20 bg-background hover:bg-primary/10 active:scale-[0.98]'
                )}
              >
                <div className="pointer-events-none absolute inset-0 rounded-xl bg-primary/5 animate-pulse" />
                <div className="relative flex items-center justify-between">
                  <div>
                    <span className="block text-lg font-black text-foreground">
                      {order.customer_name || 'Guest'}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      #{order.check_number} · Tap to clear
                    </span>
                  </div>
                  <span className="text-2xl font-black text-primary/40 transition-colors group-hover:text-primary/70">✓</span>
                </div>
              </motion.button>
            ))}
          </AnimatePresence>

          {ready.length === 0 && (
            <div className="flex flex-col items-center py-8 text-primary/40">
              <Zap className="mb-1 h-6 w-6" />
              <span className="text-sm">No orders ready</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

