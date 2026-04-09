import { useState, useEffect, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
      <div className="p-3 sm:p-5 space-y-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className="rounded-xl h-9 w-9">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-bold text-foreground tracking-tight">Order Board</h1>
                <div className={cn(
                  "h-2 w-2 rounded-full",
                  autoRefresh ? "bg-green-500 animate-pulse shadow-[0_0_8px_2px_rgba(34,197,94,0.4)]" : "bg-muted-foreground/30"
                )} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {storeName} · {lastRefresh ? lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Connecting...'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="w-[130px] h-8 text-xs rounded-xl border-border/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STORES.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              className="h-8 text-[11px] rounded-xl px-3 font-medium"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? 'Live' : 'Paused'}
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8 rounded-xl border-border/40" onClick={fetchOrders} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <StatTile icon={<ShoppingBag />} label="Total" value={totalOrders} />
          <StatTile icon={<Clock />} label="Open" value={openOrders} accent={openOrders > 0} />
          <StatTile icon={<DollarSign />} label="Sales" value={`$${totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
          <StatTile icon={<TrendingUp />} label="Avg" value={`$${avgTicket.toFixed(2)}`} />
          <StatTile icon={<Truck />} label="Online" value={oloOrders} />
          <StatTile icon={<Store />} label="Walk-in" value={inStoreOrders} />
        </div>

        {/* Delivery + Payments */}
        {(deliveryPayments.length > 0 || payments.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {deliveryPayments.length > 0 && (
              <SectionCard icon={<Truck />} title="Delivery Partners">
                <div className="grid grid-cols-2 gap-2">
                  {deliveryPayments.map(p => (
                    <div key={p.name} className="rounded-xl bg-muted/30 border border-border/15 p-3 flex flex-col gap-0.5">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                        {p.name.replace('OLO ', '')}
                      </span>
                      <span className="text-lg font-bold text-foreground tabular-nums">${p.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
            {payments.length > 0 && (
              <SectionCard icon={<CreditCard />} title="Payment Methods">
                <div className="flex flex-wrap gap-1.5">
                  {payments.map(p => (
                    <span key={p.name} className="inline-flex items-center gap-1.5 text-[11px] bg-muted/30 border border-border/15 rounded-lg px-2.5 py-1.5">
                      <span className="text-muted-foreground">{p.name}</span>
                      <span className="font-semibold text-foreground tabular-nums">${p.total.toFixed(2)}</span>
                    </span>
                  ))}
                </div>
              </SectionCard>
            )}
          </div>
        )}

        {/* Type + Daypart */}
        {(Object.keys(ordersByType).length > 0 || Object.keys(ordersByDaypart).length > 0) && (
          <div className="grid grid-cols-2 gap-3">
            <MiniBreakdown title="By Type" data={ordersByType} />
            <MiniBreakdown title="By Daypart" data={ordersByDaypart} />
          </div>
        )}

        {/* Order Feed */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <Utensils className="h-3.5 w-3.5 text-primary" />
              Orders ({orders.length})
            </h2>
            {openOrders > 0 && (
              <span className="text-[10px] font-semibold text-primary animate-pulse">
                {openOrders} active
              </span>
            )}
          </div>
          <div className="space-y-1">
            <AnimatePresence mode="popLayout">
              {orders.map((order, idx) => (
                <motion.div
                  key={`${order.checkNumber}-${idx}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, delay: Math.min(idx * 0.008, 0.3) }}
                >
                  <OrderRow order={order} />
                </motion.div>
              ))}
            </AnimatePresence>
            {orders.length === 0 && !loading && (
              <div className="text-center py-16 opacity-40">
                <Utensils className="h-6 w-6 mx-auto mb-2" />
                <p className="text-sm">No orders yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

/* ─── Sub-components ─── */

function StatTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={cn(
      "rounded-xl border p-2.5 flex flex-col items-center text-center gap-0.5 transition-all",
      accent
        ? "border-primary/30 bg-primary/5 shadow-[0_0_12px_-3px_hsl(var(--primary)/0.25)]"
        : "border-border/20 bg-card/80"
    )}>
      <div className={cn(
        "rounded-lg w-6 h-6 flex items-center justify-center [&>svg]:h-3 [&>svg]:w-3",
        accent ? "bg-primary/15 text-primary" : "bg-muted/50 text-muted-foreground"
      )}>
        {icon}
      </div>
      <span className={cn("text-base font-bold tabular-nums leading-tight", accent && "text-primary")}>{value}</span>
      <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
    </div>
  );
}

function SectionCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/20">
      <CardHeader className="py-2.5 px-4 border-b border-border/10">
        <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-primary">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">{children}</CardContent>
    </Card>
  );
}

function MiniBreakdown({ title, data }: { title: string; data: Record<string, number> }) {
  return (
    <div className="rounded-xl border border-border/20 bg-card/80 p-3">
      <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 block">{title}</span>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(data).map(([key, count]) => (
          <span key={key} className="inline-flex items-center gap-1 text-[11px] bg-muted/30 border border-border/15 rounded-lg px-2 py-1">
            <span className="text-muted-foreground">{key}</span>
            <span className="font-bold text-foreground">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function OrderRow({ order }: { order: Order }) {
  const isOpen = order.state === 'Open';
  const isOLO = order.channel === 'OLO';

  return (
    <div className={cn(
      "flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-all",
      isOpen
        ? "border-primary/25 bg-gradient-to-r from-primary/[0.04] to-transparent"
        : "border-border/15 bg-card/50 hover:bg-card/80"
    )}>
      <div className={cn(
        "w-1.5 h-8 rounded-full shrink-0 transition-all",
        isOpen ? "bg-primary shadow-[0_0_6px_1px_hsl(var(--primary)/0.35)]" : "bg-border/40"
      )} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-sm text-foreground">#{order.checkNumber}</span>
          {order.customerName && (
            <span className="text-xs text-muted-foreground truncate">{order.customerName}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Badge variant={isOLO ? "default" : "outline"} className={cn(
            "text-[10px] h-4 px-1.5 rounded-md font-medium",
            isOLO && "bg-primary/80 hover:bg-primary/70"
          )}>
            {order.channel}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 rounded-md font-medium border-border/30">
            {order.orderType}
          </Badge>
          {order.employee && (
            <span className="text-[10px] text-muted-foreground/60 truncate">{order.employee}</span>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <span className="text-sm font-bold text-foreground tabular-nums">${order.grossSales.toFixed(2)}</span>
        <div className="text-[10px] text-muted-foreground/50 tabular-nums">
          {order.date?.split(' ').slice(1).join(' ')}
        </div>
      </div>

      <span className={cn(
        "text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0",
        isOpen
          ? "bg-primary/15 text-primary"
          : "bg-muted/50 text-muted-foreground"
      )}>
        {order.state}
      </span>
    </div>
  );
}
