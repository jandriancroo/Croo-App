import { useState, useEffect, useCallback, useRef } from 'react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, ArrowLeft, ChefHat, ClipboardList } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { KDSGridView } from '@/components/kds/KDSGridView';
import { OrderBoardView } from '@/components/kds/OrderBoardView';
import type { KDSOrder } from '@/components/kds/KDSGridView';

const STORES = [
  { id: '5280', label: 'Palm Springs' },
  { id: '5448', label: 'Hemet' },
];

export default function KDSBoard() {
  const navigate = useNavigate();
  const [storeId, setStoreId] = useState('5280');
  const [tab, setTab] = useState<'kds' | 'board'>('kds');
  const [orders, setOrders] = useState<KDSOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [bumping, setBumping] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, setTick] = useState(0); // force re-render for elapsed timers

  // Fetch orders from QU and sync to kds_orders table
  const syncOrders = useCallback(async () => {
    try {
      setLoading(true);
      const { error } = await supabase.functions.invoke('kds-orders', {
        body: { storeId },
      });

      if (error) {
        throw error;
      }

      setLastRefresh(new Date());
    } catch (err) {
      console.error('KDS sync error:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  // Load orders from kds_orders table
  const loadOrders = useCallback(async () => {
    const recentCutoff = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('kds_orders')
      .select('*')
      .eq('store_id', storeId)
      .in('status', ['open', 'ready'])
      .gte('opened_at', recentCutoff)
      .order('opened_at', { ascending: false });

    if (data) {
      setOrders(
        data.map((d) => ({
          ...d,
          items: Array.isArray(d.items) ? (d.items as unknown as KDSOrder['items']) : [],
        })) as unknown as KDSOrder[]
      );
    }
  }, [storeId]);

  // Initial sync + load
  useEffect(() => {
    syncOrders().then(() => loadOrders());
  }, [syncOrders, loadOrders]);

  // Poll QU every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      syncOrders().then(() => loadOrders());
    }, 10000);
    return () => clearInterval(interval);
  }, [syncOrders, loadOrders]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`kds-orders-${storeId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'kds_orders',
        filter: `store_id=eq.${storeId}`,
      }, () => {
        loadOrders();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [storeId, loadOrders]);

  // Elapsed time ticker (every second)
  useEffect(() => {
    timerRef.current = setInterval(() => setTick(t => t + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Bump: open → ready
  const handleBump = async (checkNumber: string) => {
    setBumping(checkNumber);
    try {
      await supabase.functions.invoke('kds-orders', {
        body: { storeId, action: 'bump', checkNumber },
      });
      // Optimistic update
      setOrders(prev => prev.map(o =>
        o.check_number === checkNumber ? { ...o, status: 'ready', bumped_at: new Date().toISOString() } : o
      ));
    } catch (err) {
      console.error('Bump failed:', err);
    } finally {
      setBumping(null);
    }
  };

  // Clear: ready → cleared
  const handleClear = async (checkNumber: string) => {
    setClearing(checkNumber);
    try {
      await supabase.functions.invoke('kds-orders', {
        body: { storeId, action: 'clear', checkNumber },
      });
      // Optimistic remove
      setOrders(prev => prev.filter(o => o.check_number !== checkNumber));
    } catch (err) {
      console.error('Clear failed:', err);
    } finally {
      setClearing(null);
    }
  };

  const storeName = STORES.find(s => s.id === storeId)?.label || '';
  const openCount = orders.filter(o => o.status === 'open').length;
  const readyCount = orders.filter(o => o.status === 'ready').length;

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground">
        <div className="p-3 sm:p-4 space-y-3 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/settings')}
                className="rounded-xl h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-lg font-bold text-foreground tracking-tight">{storeName} KDS</h1>
                <p className="text-[11px] text-muted-foreground">
                  {lastRefresh ? lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Connecting...'}
                  {' · '}
                  <span className="text-primary">{openCount} open</span>
                  {readyCount > 0 && <span className="text-accent-foreground"> · {readyCount} ready</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger className="w-[130px] h-8 text-xs rounded-xl bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORES.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={() => syncOrders().then(() => loadOrders())}
                disabled={loading}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="flex rounded-xl bg-card border border-border p-1 gap-1">
            <button
              onClick={() => setTab('kds')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                tab === 'kds'
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <ChefHat className="h-3.5 w-3.5" />
              KDS View
              {openCount > 0 && (
                  <span className={cn(
                    "ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    tab === 'kds' ? 'bg-muted' : 'bg-primary/15 text-primary'
                  )}>{openCount}</span>
              )}
            </button>
            <button
              onClick={() => setTab('board')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                tab === 'board'
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <ClipboardList className="h-3.5 w-3.5" />
              Order Board
              {readyCount > 0 && (
                  <span className={cn(
                    "ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    tab === 'board' ? 'bg-muted' : 'bg-accent text-accent-foreground'
                  )}>{readyCount}</span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          {tab === 'kds' ? (
            <KDSGridView orders={orders} onBump={handleBump} bumping={bumping} />
          ) : (
            <OrderBoardView orders={orders} />
          )}

          {/* Live indicator */}
          <div className="flex items-center justify-center gap-2 py-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Live · 10s refresh</span>
          </div>
        </div>
      </div>
    </Layout>
  );
}
