import { useState, useEffect, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Clock, DollarSign, ShoppingBag, Truck, Store, Utensils, CreditCard, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

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

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchOrders, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchOrders]);

  const storeName = STORES.find(s => s.id === storeId)?.label || '';

  // Stats
  const totalOrders = orders.length;
  const openOrders = orders.filter(o => o.state === 'Open').length;
  const totalSales = orders.reduce((sum, o) => sum + o.grossSales, 0);
  const totalTips = orders.reduce((sum, o) => sum + o.tips, 0);
  const oloOrders = orders.filter(o => o.channel === 'OLO').length;
  const inStoreOrders = orders.filter(o => o.channel === 'In Store').length;

  // Delivery partner payments
  const deliveryPayments = payments.filter(p => 
    p.name.toLowerCase().includes('doordash') || 
    p.name.toLowerCase().includes('ubereats') || 
    p.name.toLowerCase().includes('grubhub')
  );

  // Group by order type
  const ordersByType: Record<string, number> = {};
  orders.forEach(o => {
    ordersByType[o.orderType] = (ordersByType[o.orderType] || 0) + 1;
  });

  // Group by daypart
  const ordersByDaypart: Record<string, number> = {};
  orders.forEach(o => {
    ordersByDaypart[o.daypart] = (ordersByDaypart[o.daypart] || 0) + 1;
  });

  return (
    <Layout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">Live KDS Board</h1>
              <p className="text-xs text-muted-foreground">
                {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Loading...'}
                {autoRefresh && ' · Auto-refresh ON'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
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
              className="h-8 text-xs"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? 'Auto' : 'Manual'}
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={fetchOrders} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <StatCard icon={<ShoppingBag className="h-4 w-4" />} label="Total Orders" value={totalOrders} />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Open" value={openOrders} highlight={openOrders > 0} />
          <StatCard icon={<DollarSign className="h-4 w-4" />} label="Sales" value={`$${totalSales.toFixed(0)}`} />
          <StatCard icon={<DollarSign className="h-4 w-4" />} label="Tips" value={`$${totalTips.toFixed(0)}`} />
          <StatCard icon={<Truck className="h-4 w-4" />} label="OLO" value={oloOrders} />
          <StatCard icon={<Store className="h-4 w-4" />} label="In Store" value={inStoreOrders} />
        </div>

        {/* Delivery Partner Breakdown */}
        {deliveryPayments.length > 0 && (
          <Card className="border-border/50">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                Delivery Partners Today — {storeName}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="flex flex-wrap gap-3">
                {deliveryPayments.map(p => (
                  <div key={p.name} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-foreground">{p.name.replace('OLO ', '')}</span>
                      <span className="text-lg font-bold text-primary">${p.total.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* All Payments Breakdown */}
        {payments.length > 0 && (
          <Card className="border-border/50">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                Payment Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="flex flex-wrap gap-2">
                {payments.map(p => (
                  <Badge key={p.name} variant="outline" className="text-xs py-1 px-2">
                    {p.name}: ${p.total.toFixed(2)}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Order Type & Daypart Breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Card className="border-border/50">
            <CardHeader className="py-2 px-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground">By Order Type</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="flex flex-wrap gap-2">
                {Object.entries(ordersByType).map(([type, count]) => (
                  <Badge key={type} variant="secondary" className="text-xs">
                    {type}: {count}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardHeader className="py-2 px-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground">By Daypart</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="flex flex-wrap gap-2">
                {Object.entries(ordersByDaypart).map(([dp, count]) => (
                  <Badge key={dp} variant="secondary" className="text-xs">
                    {dp}: {count}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Order Feed */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Utensils className="h-4 w-4" />
            Order Feed — {storeName} ({orders.length})
          </h2>
          <div className="space-y-1.5">
            {orders.map((order, idx) => (
              <OrderCard key={`${order.checkNumber}-${idx}`} order={order} />
            ))}
            {orders.length === 0 && !loading && (
              <p className="text-center text-sm text-muted-foreground py-8">No orders found for today</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function StatCard({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string | number; highlight?: boolean }) {
  return (
    <Card className={cn("border-border/50", highlight && "border-primary/50 bg-primary/5")}>
      <CardContent className="p-3 flex flex-col items-center text-center gap-1">
        <div className={cn("text-muted-foreground", highlight && "text-primary")}>{icon}</div>
        <span className={cn("text-lg font-bold", highlight && "text-primary")}>{value}</span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

function OrderCard({ order }: { order: Order }) {
  const isOpen = order.state === 'Open';
  const isOLO = order.channel === 'OLO';

  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-lg border transition-colors",
      isOpen ? "border-primary/40 bg-primary/5" : "border-border/30 bg-card"
    )}>
      {/* Status indicator */}
      <div className={cn(
        "w-2 h-2 rounded-full shrink-0",
        isOpen ? "bg-green-500 animate-pulse" : "bg-muted-foreground/30"
      )} />

      {/* Order info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-sm text-foreground">#{order.checkNumber}</span>
          {order.customerName && (
            <span className="text-xs text-muted-foreground truncate">{order.customerName}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <Badge variant={isOLO ? "default" : "outline"} className="text-[10px] h-4 px-1.5">
            {order.channel}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">
            {order.orderType}
          </Badge>
          {order.employee && (
            <span className="text-[10px] text-muted-foreground">{order.employee}</span>
          )}
        </div>
      </div>

      {/* Right side */}
      <div className="text-right shrink-0">
        <span className="text-sm font-semibold text-foreground">${order.grossSales.toFixed(2)}</span>
        <div className="text-[10px] text-muted-foreground">
          {order.date?.split(' ').slice(1).join(' ')}
        </div>
      </div>

      {/* State badge */}
      <Badge variant={isOpen ? "default" : "secondary"} className={cn(
        "text-[10px] h-5 shrink-0",
        isOpen && "bg-green-600 hover:bg-green-700"
      )}>
        {order.state}
      </Badge>
    </div>
  );
}
