import { useState, useEffect, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Clock, DollarSign, ShoppingBag, Truck, Store, Utensils, CreditCard, ArrowLeft, Zap, TrendingUp, Users } from 'lucide-react';
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
  { id: '5280', label: 'Palm Springs', emoji: '🌴' },
  { id: '5448', label: 'Hemet', emoji: '🏔️' },
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

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchOrders, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchOrders]);

  const store = STORES.find(s => s.id === storeId);
  const storeName = store?.label || '';

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
  orders.forEach(o => {
    ordersByType[o.orderType] = (ordersByType[o.orderType] || 0) + 1;
  });

  const ordersByDaypart: Record<string, number> = {};
  orders.forEach(o => {
    ordersByDaypart[o.daypart] = (ordersByDaypart[o.daypart] || 0) + 1;
  });

  return (
    <Layout>
      <div className="p-3 sm:p-4 space-y-3 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className="rounded-xl">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-foreground tracking-tight">Live Orders</h1>
                <div className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold",
                  autoRefresh ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  <Zap className="h-2.5 w-2.5" />
                  {autoRefresh ? 'LIVE' : 'PAUSED'}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {lastRefresh ? `${lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Connecting...'}
                {' · '}{store?.emoji} {storeName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="w-[130px] h-8 text-xs rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STORES.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.emoji} {s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs rounded-xl px-3"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? '● Live' : '○ Paused'}
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8 rounded-xl" onClick={fetchOrders} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Hero Stats */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <HeroStat icon={<ShoppingBag />} label="Orders" value={totalOrders} />
          <HeroStat icon={<Clock />} label="Open" value={openOrders} accent={openOrders > 0} />
          <HeroStat icon={<DollarSign />} label="Sales" value={`$${totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
          <HeroStat icon={<TrendingUp />} label="Avg Ticket" value={`$${avgTicket.toFixed(2)}`} />
          <HeroStat icon={<Truck />} label="Online" value={oloOrders} />
          <HeroStat icon={<Store />} label="In Store" value={inStoreOrders} />
        </div>

        {/* Delivery + Payments Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {deliveryPayments.length > 0 && (
            <Card className="border-border/30 overflow-hidden">
              <CardHeader className="py-2.5 px-4 border-b border-border/20 bg-muted/30">
                <CardTitle className="text-xs font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                  <Truck className="h-3.5 w-3.5 text-primary" />
                  Delivery Partners
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="grid grid-cols-2 gap-2">
                  {deliveryPayments.map(p => (
                    <div key={p.name} className="flex items-center gap-3 bg-gradient-to-br from-muted/40 to-muted/20 rounded-xl p-3 border border-border/20">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Truck className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11px] font-medium text-muted-foreground block truncate">
                          {p.name.replace('OLO ', '')}
                        </span>
                        <span className="text-base font-bold text-foreground">${p.total.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {payments.length > 0 && (
            <Card className="border-border/30 overflow-hidden">
              <CardHeader className="py-2.5 px-4 border-b border-border/20 bg-muted/30">
                <CardTitle className="text-xs font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                  <CreditCard className="h-3.5 w-3.5 text-primary" />
                  All Payments
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="flex flex-wrap gap-1.5">
                  {payments.map(p => (
                    <div key={p.name} className="flex items-center gap-1.5 bg-muted/40 rounded-lg px-2.5 py-1.5 border border-border/20">
                      <span className="text-[10px] text-muted-foreground">{p.name}</span>
                      <span className="text-xs font-bold text-foreground">${p.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Order Type & Daypart Pills */}
        <div className="grid grid-cols-2 gap-2">
          <Card className="border-border/30">
            <CardContent className="p-3">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">By Type</span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(ordersByType).map(([type, count]) => (
                  <Badge key={type} variant="secondary" className="text-[11px] rounded-lg px-2.5 py-1 font-medium">
                    {type} <span className="ml-1 font-bold text-primary">{count}</span>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/30">
            <CardContent className="p-3">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">By Daypart</span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(ordersByDaypart).map(([dp, count]) => (
                  <Badge key={dp} variant="secondary" className="text-[11px] rounded-lg px-2.5 py-1 font-medium">
                    {dp} <span className="ml-1 font-bold text-primary">{count}</span>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Order Feed */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Utensils className="h-3.5 w-3.5 text-primary" />
              Order Feed ({orders.length})
            </h2>
            {openOrders > 0 && (
              <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] animate-pulse">
                {openOrders} active
              </Badge>
            )}
          </div>
          <div className="space-y-1">
            <AnimatePresence mode="popLayout">
              {orders.map((order, idx) => (
                <motion.div
                  key={`${order.checkNumber}-${idx}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2, delay: idx * 0.01 }}
                >
                  <OrderCard order={order} />
                </motion.div>
              ))}
            </AnimatePresence>
            {orders.length === 0 && !loading && (
              <div className="text-center py-12">
                <Utensils className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No orders yet today</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function HeroStat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent?: boolean }) {
  return (
    <Card className={cn(
      "border-border/30 transition-all",
      accent && "border-primary/30 bg-primary/5 shadow-[0_0_12px_-4px_hsl(var(--primary)/0.3)]"
    )}>
      <CardContent className="p-2.5 flex flex-col items-center text-center gap-0.5">
        <div className={cn(
          "w-7 h-7 rounded-lg flex items-center justify-center mb-0.5",
          accent ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground",
          "[&>svg]:h-3.5 [&>svg]:w-3.5"
        )}>
          {icon}
        </div>
        <span className={cn("text-lg font-bold leading-none", accent && "text-primary")}>{value}</span>
        <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
      </CardContent>
    </Card>
  );
}

function OrderCard({ order }: { order: Order }) {
  const isOpen = order.state === 'Open';
  const isOLO = order.channel === 'OLO';

  return (
    <div className={cn(
      "flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all",
      isOpen
        ? "border-primary/30 bg-gradient-to-r from-primary/5 to-transparent shadow-[0_0_8px_-3px_hsl(var(--primary)/0.2)]"
        : "border-border/20 bg-card/60 hover:bg-card"
    )}>
      <div className={cn(
        "w-2 h-2 rounded-full shrink-0",
        isOpen ? "bg-primary shadow-[0_0_6px_2px_hsl(var(--primary)/0.4)] animate-pulse" : "bg-muted-foreground/20"
      )} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-sm text-foreground">#{order.checkNumber}</span>
          {order.customerName && (
            <span className="text-xs text-muted-foreground truncate">{order.customerName}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <Badge variant={isOLO ? "default" : "outline"} className={cn(
            "text-[10px] h-4 px-1.5 rounded-md",
            isOLO && "bg-primary/80"
          )}>
            {order.channel}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 rounded-md">
            {order.orderType}
          </Badge>
          {order.employee && (
            <span className="text-[10px] text-muted-foreground/70">{order.employee}</span>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <span className="text-sm font-bold text-foreground">${order.grossSales.toFixed(2)}</span>
        <div className="text-[10px] text-muted-foreground/60">
          {order.date?.split(' ').slice(1).join(' ')}
        </div>
      </div>

      <Badge variant={isOpen ? "default" : "secondary"} className={cn(
        "text-[10px] h-5 shrink-0 rounded-md font-semibold",
        isOpen && "bg-primary shadow-sm"
      )}>
        {order.state}
      </Badge>
    </div>
  );
}
