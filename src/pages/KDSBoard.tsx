import { useState, useEffect, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Clock, DollarSign, ShoppingBag, Truck, Store, Utensils, CreditCard, ArrowLeft, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface Order {
  checkNumber: string;
  customerName: string;
  orderType: string;
  channel: string;
  daypart: string;
  date: string;
  state: string;
  employee: string;
  terminal: string;
  itemCount: number;
  grossSales: number;
  netSales: number;
  taxes: number;
  tips: number;
  discounts: number;
}

interface Payment {
  name: string;
  total: number;
}

const STORES = [
  { id: '5280', label: 'Palm Springs' },
  { id: '5448', label: 'Hemet' },
];

export default function KDSBoard() {
  const navigate = useNavigate();
  const [storeId, setStoreId] = useState('5280');
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('kds-orders', {
        body: { storeId },
      });
      if (error) throw error;
      setOrders(data.orders || []);
      setPayments(data.payments || []);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('KDS fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchOrders, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchOrders]);

  const storeName = STORES.find(s => s.id === storeId)?.label || '';

  const totalOrders = orders.length;
  const openOrders = orders.filter(o => o.state === 'Open').length;
  const totalSales = orders.reduce((sum, o) => sum + o.grossSales, 0);
  const totalTips = orders.reduce((sum, o) => sum + o.tips, 0);
  const oloOrders = orders.filter(o => o.channel === 'OLO').length;
  const inStoreOrders = orders.filter(o => o.channel === 'In Store').length;
  const avgTicket = totalOrders > 0 ? totalSales / totalOrders : 0;

  const deliveryPayments = payments.filter(p =>
    p.name.toLowerCase().includes('doordash') ||
    p.name.toLowerCase().includes('ubereats') ||
    p.name.toLowerCase().includes('grubhub')
  );

  const ordersByType: Record<string, number> = {};
  orders.forEach(o => { ordersByType[o.orderType] = (ordersByType[o.orderType] || 0) + 1; });

  const ordersByDaypart: Record<string, number> = {};
  orders.forEach(o => { ordersByDaypart[o.daypart] = (ordersByDaypart[o.daypart] || 0) + 1; });

  return (
    <Layout>
      <div className="min-h-screen bg-[hsl(220,20%,6%)] text-white">
        <div className="p-3 sm:p-5 space-y-4 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/settings')}
                className="rounded-xl h-9 w-9 text-white/60 hover:text-white hover:bg-white/10"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-lg font-bold text-white tracking-tight">{storeName} — Order Board</h1>
                  <div className={cn(
                    "h-2 w-2 rounded-full",
                    autoRefresh ? "bg-emerald-400 animate-pulse shadow-[0_0_8px_2px_rgba(52,211,153,0.5)]" : "bg-white/20"
                  )} />
                </div>
                <p className="text-[11px] text-white/40">
                  {lastRefresh ? lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Connecting...'}
                  {autoRefresh && ' · Auto-refresh'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger className="w-[130px] h-8 text-xs rounded-xl bg-white/5 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORES.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className={cn(
                  "h-8 text-[11px] rounded-xl px-3 font-medium",
                  autoRefresh
                    ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
                    : "bg-white/5 text-white/50 hover:bg-white/10 border border-white/10"
                )}
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                {autoRefresh ? '● Live' : '○ Paused'}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl text-white/50 hover:text-white hover:bg-white/10"
                onClick={fetchOrders}
                disabled={loading}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <DarkStat icon={<ShoppingBag />} label="Total" value={totalOrders} />
            <DarkStat icon={<Clock />} label="Open" value={openOrders} accent={openOrders > 0} />
            <DarkStat icon={<DollarSign />} label="Sales" value={`$${totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
            <DarkStat icon={<TrendingUp />} label="Avg" value={`$${avgTicket.toFixed(2)}`} />
            <DarkStat icon={<Truck />} label="Online" value={oloOrders} />
            <DarkStat icon={<Store />} label="Walk-in" value={inStoreOrders} />
          </div>

          {/* Delivery + Payments */}
          {(deliveryPayments.length > 0 || payments.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {deliveryPayments.length > 0 && (
                <DarkSection icon={<Truck />} title="Delivery Partners">
                  <div className="grid grid-cols-2 gap-2">
                    {deliveryPayments.map(p => (
                      <div key={p.name} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
                        <span className="text-[10px] font-medium text-white/40 uppercase tracking-wider block truncate">
                          {p.name.replace('OLO ', '')}
                        </span>
                        <span className="text-lg font-bold text-amber-400 tabular-nums">${p.total.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </DarkSection>
              )}
              {payments.length > 0 && (
                <DarkSection icon={<CreditCard />} title="Payment Methods">
                  <div className="flex flex-wrap gap-1.5">
                    {payments.map(p => (
                      <span key={p.name} className="inline-flex items-center gap-1.5 text-[11px] bg-white/[0.03] border border-white/[0.06] rounded-lg px-2.5 py-1.5">
                        <span className="text-white/40">{p.name}</span>
                        <span className="font-semibold text-white/80 tabular-nums">${p.total.toFixed(2)}</span>
                      </span>
                    ))}
                  </div>
                </DarkSection>
              )}
            </div>
          )}

          {/* Type + Daypart */}
          {(Object.keys(ordersByType).length > 0 || Object.keys(ordersByDaypart).length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              <DarkBreakdown title="By Type" data={ordersByType} />
              <DarkBreakdown title="By Daypart" data={ordersByDaypart} />
            </div>
          )}

          {/* Order Feed */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-[11px] font-semibold text-white/30 uppercase tracking-widest flex items-center gap-2">
                <Utensils className="h-3.5 w-3.5 text-amber-400/70" />
                Orders ({orders.length})
              </h2>
              {openOrders > 0 && (
                <span className="text-[10px] font-semibold text-emerald-400 animate-pulse">
                  {openOrders} active
                </span>
              )}
            </div>
            <div className="space-y-1">
              <AnimatePresence mode="popLayout">
                {[...orders].sort((a, b) => {
                  // Most recent first by date string
                  if (a.date && b.date) return b.date.localeCompare(a.date);
                  return 0;
                }).map((order, idx) => (
                  <motion.div
                    key={`${order.checkNumber}-${idx}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, delay: Math.min(idx * 0.008, 0.3) }}
                  >
                    <DarkOrderRow order={order} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {orders.length === 0 && !loading && (
                <div className="text-center py-16 opacity-30">
                  <Utensils className="h-6 w-6 mx-auto mb-2 text-white/30" />
                  <p className="text-sm text-white/30">No orders yet</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

/* ─── Dark Sub-components ─── */

function DarkStat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={cn(
      "rounded-xl border p-2.5 flex flex-col items-center text-center gap-0.5",
      accent
        ? "border-emerald-500/30 bg-emerald-500/[0.08]"
        : "border-white/[0.06] bg-white/[0.02]"
    )}>
      <div className={cn(
        "rounded-lg w-6 h-6 flex items-center justify-center [&>svg]:h-3 [&>svg]:w-3",
        accent ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-white/30"
      )}>
        {icon}
      </div>
      <span className={cn(
        "text-base font-bold tabular-nums leading-tight",
        accent ? "text-emerald-400" : "text-white/90"
      )}>{value}</span>
      <span className="text-[9px] text-white/30 font-medium uppercase tracking-wider">{label}</span>
    </div>
  );
}

function DarkSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="py-2.5 px-4 border-b border-white/[0.04]">
        <span className="text-[10px] font-semibold text-white/30 uppercase tracking-widest flex items-center gap-2 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-amber-400/60">
          {icon}
          {title}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function DarkBreakdown({ title, data }: { title: string; data: Record<string, number> }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <span className="text-[9px] font-semibold text-white/25 uppercase tracking-widest mb-2 block">{title}</span>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(data).map(([key, count]) => (
          <span key={key} className="inline-flex items-center gap-1 text-[11px] bg-white/[0.04] border border-white/[0.06] rounded-lg px-2 py-1">
            <span className="text-white/40">{key}</span>
            <span className="font-bold text-amber-400">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function DarkOrderRow({ order }: { order: Order }) {
  const isOpen = order.state === 'Open';
  const is3PD = order.channel === 'OLO' || order.channel.toLowerCase().includes('doordash') || order.channel.toLowerCase().includes('ubereats') || order.channel.toLowerCase().includes('grubhub');
  // 3PD orders should show "Delivery" instead of "Carry Out" / "Take-Out"
  const displayType = is3PD ? 'Delivery' : order.orderType;
  const displayChannel = is3PD ? order.channel : order.channel;

  return (
    <div className={cn(
      "flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-all",
      isOpen
        ? "border-amber-500/20 bg-amber-500/[0.04]"
        : "border-white/[0.04] bg-white/[0.015] hover:bg-white/[0.03]"
    )}>
      <div className={cn(
        "w-1.5 h-8 rounded-full shrink-0",
        isOpen ? "bg-amber-400 shadow-[0_0_8px_2px_rgba(251,191,36,0.3)]" : "bg-white/10"
      )} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {order.customerName ? (
            <span className="font-bold text-sm text-white truncate">{order.customerName}</span>
          ) : (
            <span className="font-bold text-sm text-white/50">Guest</span>
          )}
          <span className="font-mono text-[11px] text-white/25">#{order.checkNumber}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={cn(
            "text-[10px] font-semibold px-1.5 py-0.5 rounded",
            isOLO ? "bg-amber-500/20 text-amber-400" : "bg-white/5 text-white/40"
          )}>
            {order.channel}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">
            {displayType}
          </span>
          {order.employee && (
            <span className="text-[10px] text-white/20 truncate">{order.employee}</span>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <span className="text-sm font-bold text-white tabular-nums">${order.grossSales.toFixed(2)}</span>
        <div className="text-[10px] text-white/20 tabular-nums">
          {order.date?.split(' ').slice(1).join(' ')}
        </div>
      </div>

      <span className={cn(
        "text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0",
        isOpen
          ? "bg-emerald-500/20 text-emerald-400"
          : "bg-white/5 text-white/25"
      )}>
        {order.state}
      </span>
    </div>
  );
}
