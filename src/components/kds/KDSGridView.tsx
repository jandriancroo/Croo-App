import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Clock, Zap } from 'lucide-react';
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
  is_paid: boolean;
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
  if (ch.includes('doordash')) return { label: 'DoorDash', tone: 'channel-doordash' };
  if (ch.includes('ubereats')) return { label: 'UberEats', tone: 'channel-ubereats' };
  if (ch.includes('grubhub')) return { label: 'GrubHub', tone: 'channel-grubhub' };
  if (ch === 'olo') return { label: 'Online', tone: 'channel-online' };
  return { label: 'Walk-in', tone: 'channel-store' };
}

function isDelivery(channel: string | null) {
  const ch = (channel || '').toLowerCase();
  return ch === 'olo' || ch.includes('doordash') || ch.includes('ubereats') || ch.includes('grubhub');
}

function groupItems(items: KDSItem[]) {
  const grouped: Array<{ item: KDSItem; modifiers: KDSItem[] }> = [];

  for (const entry of items) {
    if (entry.isModifier && grouped.length > 0) {
      grouped[grouped.length - 1].modifiers.push(entry);
      continue;
    }

    grouped.push({ item: entry, modifiers: [] });
  }

  return grouped;
}

interface Props {
  orders: KDSOrder[];
  onBump: (checkNumber: string) => void;
  bumping: string | null;
}

export function KDSGridView({ orders, onBump, bumping }: Props) {
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const openOrders = orders.filter((o) => o.status === 'open').slice(0, 10);

  if (openOrders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/60">
        <Zap className="mb-3 h-10 w-10" />
        <p className="text-lg font-semibold text-foreground">No active orders</p>
        <p className="text-sm">Recent paid orders will land here until your team bumps them.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <AnimatePresence mode="popLayout">
          {openOrders.map((order) => {
            const channelInfo = getChannelInfo(order.channel);
            const isSelected = selectedOrder === order.check_number;
            const items = Array.isArray(order.items) ? order.items : [];
            const groupedItems = groupItems(items);
            const isBumping = bumping === order.check_number;

            return (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.18 }}
                onClick={() => setSelectedOrder(isSelected ? null : order.check_number)}
                className={cn(
                  'rounded-xl border border-border bg-card text-card-foreground shadow-sm transition-all overflow-hidden cursor-pointer flex flex-col',
                  isSelected && 'ring-2 ring-ring border-primary/40',
                  isDelivery(order.channel) && 'border-l-4 border-l-primary'
                )}
              >
                <div className="border-b border-border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold text-foreground">
                      {order.customer_name || 'Guest'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {!order.is_paid && !isDelivery(order.channel) && (
                        <span className="rounded bg-destructive px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-destructive-foreground animate-pulse">
                          Unpaid
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">#{order.check_number}</span>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground', channelInfo.tone)}>
                      {channelInfo.label}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      {getElapsed(order.opened_at)}
                    </span>
                  </div>
                </div>

                <div className="flex-1 space-y-1 overflow-y-auto px-3 py-2 max-h-[180px]">
                  {groupedItems.length > 0 ? (
                    groupedItems.map(({ item, modifiers }, index) => (
                      <div key={`${order.id}-${index}`} className="space-y-0.5">
                        <div className="flex items-start gap-1.5">
                          <span className="shrink-0 text-[10px] font-bold text-primary">{item.qty}×</span>
                          <span className="text-[11px] font-semibold leading-tight text-foreground">{item.name}</span>
                        </div>
                        {modifiers.map((modifier, modifierIndex) => (
                          <div
                            key={`${order.id}-${index}-mod-${modifierIndex}`}
                            className="pl-4 text-[10px] leading-tight text-muted-foreground"
                          >
                            • {modifier.name}
                          </div>
                        ))}
                      </div>
                    ))
                  ) : (
                    <div className="text-[10px] italic text-muted-foreground">
                      {order.gross_sales > 0 ? `$${order.gross_sales.toFixed(2)}` : 'No item detail available'}
                    </div>
                  )}
                </div>

                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onBump(order.check_number);
                  }}
                  disabled={isBumping}
                  className={cn(
                    'w-full py-2.5 text-xs font-black uppercase tracking-wider transition-colors',
                    isBumping
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-primary text-primary-foreground hover:opacity-90'
                  )}
                >
                  {isBumping ? 'Bumping…' : 'Bump'}
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Bump Bar</span>
        <div className="flex flex-1 gap-1.5 overflow-x-auto">
          {openOrders.map((order) => (
            <button
              key={order.id}
              onClick={() => onBump(order.check_number)}
              disabled={bumping === order.check_number}
              className={cn(
                'shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors',
                selectedOrder === order.check_number
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              #{order.check_number}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

