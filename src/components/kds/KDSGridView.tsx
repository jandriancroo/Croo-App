import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Clock, Truck, Store, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface KDSItem {
  name: string;
  modifier?: string | null;
  qty: number;
  price: number;
  category: string;
  isModifier: boolean;
}

export interface KDSOrder {
  id: string;
  store_id: string;
  check_number: string;
  customer_name: string | null;
  order_type: string | null;
  channel: string | null;
  employee: string | null;
  items: KDSItem[];
  gross_sales: number;
  status: string;
  opened_at: string;
  bumped_at: string | null;
  cleared_at: string | null;
}

function getElapsed(openedAt: string): string {
  const ms = Date.now() - new Date(openedAt).getTime();
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function getChannelInfo(channel: string | null) {
  const ch = (channel || '').toLowerCase();
  if (ch.includes('doordash')) return { label: 'DoorDash', color: 'bg-red-500', textColor: 'text-red-400' };
  if (ch.includes('ubereats')) return { label: 'UberEats', color: 'bg-emerald-500', textColor: 'text-emerald-400' };
  if (ch.includes('grubhub')) return { label: 'GrubHub', color: 'bg-orange-500', textColor: 'text-orange-400' };
  if (ch === 'olo') return { label: 'Online', color: 'bg-amber-500', textColor: 'text-amber-400' };
  return { label: 'Walk-in', color: 'bg-blue-500', textColor: 'text-blue-400' };
}

function isDelivery(channel: string | null) {
  const ch = (channel || '').toLowerCase();
  return ch === 'olo' || ch.includes('doordash') || ch.includes('ubereats') || ch.includes('grubhub');
}

interface Props {
  orders: KDSOrder[];
  onBump: (checkNumber: string) => void;
  bumping: string | null;
}

export function KDSGridView({ orders, onBump, bumping }: Props) {
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const openOrders = orders.filter(o => o.status === 'open').slice(0, 10);

  if (openOrders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-white/20">
        <Zap className="h-10 w-10 mb-3" />
        <p className="text-lg font-semibold">All Clear</p>
        <p className="text-sm">No open orders in the kitchen</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KDS Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <AnimatePresence mode="popLayout">
          {openOrders.map((order) => {
            const chInfo = getChannelInfo(order.channel);
            const is3PD = isDelivery(order.channel);
            const isSelected = selectedOrder === order.check_number;
            const items = Array.isArray(order.items) ? order.items : [];
            const menuItems = items.filter(i => !i.isModifier);
            const isBumping = bumping === order.check_number;

            return (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSelectedOrder(isSelected ? null : order.check_number)}
                className={cn(
                  "rounded-xl border flex flex-col overflow-hidden cursor-pointer transition-all",
                  isSelected
                    ? "border-amber-400/50 ring-1 ring-amber-400/30 bg-white/[0.04]"
                    : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]",
                  is3PD && "border-l-2 border-l-amber-500/60"
                )}
              >
                {/* Header */}
                <div className="px-2.5 py-2 border-b border-white/[0.06]">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-xs text-white truncate">
                      {order.customer_name || 'Guest'}
                    </span>
                    <span className="font-mono text-[10px] text-white/25 shrink-0">#{order.check_number}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", chInfo.color, "text-white")}>
                      {chInfo.label}
                    </span>
                    <span className="text-[10px] text-white/30 flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {getElapsed(order.opened_at)}
                    </span>
                  </div>
                </div>

                {/* Items */}
                <div className="flex-1 px-2.5 py-2 space-y-0.5 max-h-[140px] overflow-y-auto scrollbar-thin">
                  {menuItems.length > 0 ? menuItems.map((item, i) => {
                    const mods = items.filter(m => m.isModifier && items.indexOf(m) > items.indexOf(item) && (items.findIndex((next, ni) => ni > items.indexOf(item) && !next.isModifier) === -1 || items.indexOf(m) < items.findIndex((next, ni) => ni > items.indexOf(item) && !next.isModifier)));
                    return (
                      <div key={i}>
                        <div className="flex items-start gap-1">
                          <span className="text-[10px] text-amber-400 font-bold shrink-0">{item.qty}×</span>
                          <span className="text-[11px] text-white/80 font-medium leading-tight">{item.name}</span>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="text-[10px] text-white/20 italic">
                      {order.gross_sales > 0 ? `$${order.gross_sales.toFixed(2)}` : 'No items'}
                    </div>
                  )}
                </div>

                {/* Bump Button */}
                <button
                  onClick={(e) => { e.stopPropagation(); onBump(order.check_number); }}
                  disabled={isBumping}
                  className={cn(
                    "w-full py-2.5 text-xs font-black uppercase tracking-wider transition-all",
                    isBumping
                      ? "bg-emerald-600/50 text-emerald-300"
                      : "bg-emerald-500 text-white hover:bg-emerald-400 active:bg-emerald-600"
                  )}
                >
                  {isBumping ? 'BUMPING...' : 'BUMP'}
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Bump Bar */}
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <span className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">Bump Bar</span>
        <div className="flex-1 flex gap-1.5 overflow-x-auto">
          {openOrders.map(o => (
            <button
              key={o.id}
              onClick={() => onBump(o.check_number)}
              disabled={bumping === o.check_number}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all",
                selectedOrder === o.check_number
                  ? "bg-emerald-500 text-white"
                  : "bg-white/[0.06] text-white/50 hover:bg-emerald-500/20 hover:text-emerald-400"
              )}
            >
              #{o.check_number}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
