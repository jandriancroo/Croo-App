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

function getChannelColor(channel: string | null) {
  const ch = (channel || '').toLowerCase();
  if (ch.includes('doordash')) return 'border-l-red-500';
  if (ch.includes('ubereats')) return 'border-l-emerald-500';
  if (ch.includes('grubhub')) return 'border-l-orange-500';
  if (ch === 'olo') return 'border-l-amber-500';
  return 'border-l-blue-500';
}

interface Props {
  orders: KDSOrder[];
  onClear: (checkNumber: string) => void;
  clearing: string | null;
}

export function OrderBoardView({ orders, onClear, clearing }: Props) {
  const preparing = orders.filter(o => o.status === 'open');
  const ready = orders.filter(o => o.status === 'ready');

  return (
    <div className="grid grid-cols-2 gap-3 min-h-[400px]">
      {/* Preparing Column */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            Preparing
          </span>
          <span className="text-[11px] font-bold text-white/30 tabular-nums">{preparing.length}</span>
        </div>
        <div className="p-2 space-y-1 max-h-[500px] overflow-y-auto">
          <AnimatePresence mode="popLayout">
            {preparing.map(order => (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg border-l-2 bg-white/[0.02]",
                  getChannelColor(order.channel)
                )}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-bold text-white truncate block">
                    {order.customer_name || 'Guest'}
                  </span>
                  <span className="text-[10px] text-white/30">
                    #{order.check_number} · {order.order_type || order.channel}
                  </span>
                </div>
                <span className="text-[10px] text-white/20 tabular-nums shrink-0">
                  {getElapsed(order.opened_at)}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {preparing.length === 0 && (
            <div className="text-center py-8 text-white/15 text-sm">No orders preparing</div>
          )}
        </div>
      </div>

      {/* Ready Column */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-emerald-500/10 flex items-center justify-between">
          <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ready for Pickup
          </span>
          <span className="text-[11px] font-bold text-emerald-400/50 tabular-nums">{ready.length}</span>
        </div>
        <div className="p-2 space-y-1.5 max-h-[500px] overflow-y-auto">
          <AnimatePresence mode="popLayout">
            {ready.map(order => (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8, x: 40 }}
                onClick={() => onClear(order.check_number)}
                className={cn(
                  "relative px-4 py-3 rounded-xl border cursor-pointer transition-all group",
                  clearing === order.check_number
                    ? "border-emerald-400/40 bg-emerald-500/20"
                    : "border-emerald-500/20 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12] active:scale-[0.97]"
                )}
              >
                <div className="absolute inset-0 rounded-xl bg-emerald-400/5 animate-pulse pointer-events-none" />
                <div className="relative flex items-center justify-between">
                  <div>
                    <span className="text-lg font-black text-emerald-400 block">
                      {order.customer_name || 'Guest'}
                    </span>
                    <span className="text-[11px] text-emerald-400/40">
                      #{order.check_number} · Tap to clear
                    </span>
                  </div>
                  <span className="text-2xl font-black text-emerald-400/30 group-hover:text-emerald-400/60 transition-colors">
                    ✓
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {ready.length === 0 && (
            <div className="flex flex-col items-center py-8 text-emerald-400/20">
              <Zap className="h-6 w-6 mb-1" />
              <span className="text-sm">No orders ready</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
