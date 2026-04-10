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
      await supabase.functions.invoke('kds-orders', {
        body: { storeId },
      });
      setLastRefresh(new Date());
    } catch (err) {
      console.error('KDS sync error:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  // Load orders from kds_orders table
  const loadOrders = useCallback(async () => {
    const { data } = await supabase
      .from('kds_orders')
      .select('*')
      .eq('store_id', storeId)
      .in('status', ['open', 'ready'])
      .order('opened_at', { ascending: false });
    if (data) setOrders(data.map(d => ({ ...d, items: (d.items || []) as any })) as KDSOrder[]);
  }, [storeId]);

  // Initial sync + load
  useEffect(() => {
    syncOrders().then(loadOrders);
  }, [syncOrders, loadOrders]);

  // Poll QU every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      syncOrders().then(loadOrders);
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
      <div className="min-h-screen bg-[hsl(220,20%,6%)] text-white">
        <div className="p-3 sm:p-4 space-y-3 max-w-7xl mx-auto">
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
                <h1 className="text-lg font-bold text-white tracking-tight">{storeName} KDS</h1>
                <p className="text-[11px] text-white/40">
                  {lastRefresh ? lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Connecting...'}
                  {' · '}
                  <span className="text-emerald-400">{openCount} open</span>
                  {readyCount > 0 && <span className="text-amber-400"> · {readyCount} ready</span>}
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
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl text-white/50 hover:text-white hover:bg-white/10"
                onClick={() => syncOrders().then(loadOrders)}
                disabled={loading}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="flex rounded-xl bg-white/[0.04] border border-white/[0.06] p-1 gap-1">
            <button
              onClick={() => setTab('kds')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                tab === 'kds'
                  ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                  : "text-white/40 hover:text-white/60 hover:bg-white/[0.04]"
              )}
            >
              <ChefHat className="h-3.5 w-3.5" />
              KDS View
              {openCount > 0 && (
                <span className={cn(
                  "ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold tabular-nums",
                  tab === 'kds' ? "bg-white/20" : "bg-emerald-500/20 text-emerald-400"
                )}>{openCount}</span>
              )}
            </button>
            <button
              onClick={() => setTab('board')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                tab === 'board'
                  ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20"
                  : "text-white/40 hover:text-white/60 hover:bg-white/[0.04]"
              )}
            >
              <ClipboardList className="h-3.5 w-3.5" />
              Order Board
              {readyCount > 0 && (
                <span className={cn(
                  "ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold tabular-nums",
                  tab === 'board' ? "bg-white/20" : "bg-amber-500/20 text-amber-400"
                )}>{readyCount}</span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          {tab === 'kds' ? (
            <KDSGridView orders={orders} onBump={handleBump} bumping={bumping} />
          ) : (
            <OrderBoardView orders={orders} onClear={handleClear} clearing={clearing} />
          )}

          {/* Live indicator */}
          <div className="flex items-center justify-center gap-2 py-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_2px_rgba(52,211,153,0.4)]" />
            <span className="text-[10px] text-white/25 uppercase tracking-widest">Live · 10s refresh</span>
          </div>
        </div>
      </div>
    </Layout>
  );
}
