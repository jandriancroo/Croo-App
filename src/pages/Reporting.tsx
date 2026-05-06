import { useState, useEffect, useRef, useMemo } from 'react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/components/ui/sonner';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCenter, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CalendarIcon, Plus, Save, Download, Trash2, GripVertical, FileText, Mail,
  FileSpreadsheet, Building2, MapPin, Settings2, Eye, Layout as LayoutIcon,
  Package, Clock, DollarSign, ArrowLeft, Image as ImageIcon, Library,
  SlidersHorizontal, LayoutGrid, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, startOfDay, startOfMonth, startOfYear, endOfDay, endOfMonth, endOfYear, subDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import Papa from 'papaparse';
import { useMultiLocationReportData, type LocationReportData } from '@/hooks/useReportData';

// ============ TYPES ============
type Orientation = 'portrait' | 'landscape';
type BlockType = 'inventory' | 'labor' | 'cash' | 'sales' | 'header' | 'spacer' | 'text';

interface ReportBlock {
  id: string;
  type: BlockType;
  title: string;
  options?: Record<string, any>;
}

interface ReportConfig {
  orientation: Orientation;
  showCrooLogo: boolean;
  showBrandLogo: boolean;
  author: string;
  reportTitle: string;
  blocks: ReportBlock[];
  scope: 'org' | 'locations';
  locationIds: string[];
  combineLocations: boolean;
}

// ============ DATA LIBRARY ============
const DATA_LIBRARY: { type: BlockType; title: string; icon: any; description: string }[] = [
  { type: 'header', title: 'Section Header', icon: LayoutIcon, description: 'Big section divider' },
  { type: 'text', title: 'Text Block', icon: FileText, description: 'Custom commentary / notes' },
  { type: 'inventory', title: 'Inventory Summary', icon: Package, description: 'Starting count, purchases by vendor, COGS%' },
  { type: 'labor', title: 'Gross Labor', icon: Clock, description: 'Hours, OT, DOT, gross wages' },
  { type: 'cash', title: 'Cash Over/Short', icon: DollarSign, description: 'Drawer counts, daily/weekly variance' },
  { type: 'sales', title: 'Sales Total', icon: DollarSign, description: 'Net sales for the period' },
  { type: 'spacer', title: 'Spacer', icon: LayoutIcon, description: 'Vertical white space' },
];

// ============ DATE PRESETS ============
type DatePreset = 'today' | 'yesterday' | 'last7' | 'mtd' | 'lastMonth' | 'ytd' | 'custom';
const presetRange = (p: DatePreset): { from: Date; to: Date } => {
  const now = new Date();
  switch (p) {
    case 'today': return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': { const y = subDays(now, 1); return { from: startOfDay(y), to: endOfDay(y) }; }
    case 'last7': return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case 'mtd': return { from: startOfMonth(now), to: endOfDay(now) };
    case 'lastMonth': { const lm = subDays(startOfMonth(now), 1); return { from: startOfMonth(lm), to: endOfMonth(lm) }; }
    case 'ytd': return { from: startOfYear(now), to: endOfDay(now) };
    default: return { from: startOfMonth(now), to: endOfDay(now) };
  }
};

// ============ SORTABLE BLOCK ============
function SortableBlock({ block, onRemove, onEdit }: { block: ReportBlock; onRemove: () => void; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const Icon = DATA_LIBRARY.find(d => d.type === block.type)?.icon ?? FileText;
  return (
    <div ref={setNodeRef} style={style} className="group flex items-center gap-1 px-1.5 py-1 rounded-md border bg-card hover:border-primary/40 transition-colors">
      <button {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground flex-shrink-0 flex items-center">
        <GripVertical className="h-4 w-4" />
      </button>
      <button onClick={onEdit} className="flex-1 flex items-center gap-1.5 min-w-0 text-left hover:bg-muted/40 rounded px-1 py-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="flex-1 text-xs font-medium leading-tight break-words line-clamp-2 min-w-0">{block.title}</span>
      </button>
      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 flex-shrink-0" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
    </div>
  );
}

// ============ DATA RENDERERS ============
function InventoryBlock({ data, options }: { data: any; options?: any }) {
  const showVendors = options?.showVendors !== false;
  const showCogs = options?.showCogs !== false;
  const usage = (data.startingCount ?? 0) + (data.totalPurchases ?? 0) - (data.endingCount ?? 0);
  const hasAny = data.startingCount > 0 || data.endingCount > 0 || data.totalPurchases > 0;
  const fmtDate = (s?: string) => s ? new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
  if (!hasAny) {
    return <p className="text-sm text-muted-foreground italic">No inventory counts or vendor invoices in this period.</p>;
  }
  return (
    <div className="space-y-2">
      {!data.aligned && (
        <div className="text-xs p-2 rounded border border-amber-300 bg-amber-50 text-amber-900">
          ⚠️ This date range doesn't align with your inventory count periods. For accurate Starting/Ending values, select a <strong>weekly</strong> or <strong>monthly</strong> preset that matches your count schedule.
        </div>
      )}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="p-2 rounded bg-muted/40">
          <div className="text-xs text-muted-foreground">Starting Count{data.startLabel && <span className="ml-1 text-[10px] opacity-70">({fmtDate(data.startLabel)})</span>}</div>
          <div className="font-semibold">${Number(data.startingCount).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="p-2 rounded bg-muted/40">
          <div className="text-xs text-muted-foreground">Ending Count{data.endLabel && <span className="ml-1 text-[10px] opacity-70">({fmtDate(data.endLabel)})</span>}</div>
          <div className="font-semibold">${Number(data.endingCount).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="p-2 rounded bg-muted/40">
          <div className="text-xs text-muted-foreground">COGS %</div>
          <div className="font-semibold">{data.cogsPct}%</div>
        </div>
      </div>
      {showVendors && data.vendors.length === 0 && (
        <p className="text-xs text-muted-foreground italic mt-2">No vendor invoices in this period.</p>
      )}
      {showVendors && data.vendors.length > 0 && (
        <>
          <div className="text-xs font-semibold mt-3 mb-1">Purchases by Vendor</div>
          <table className="w-full text-sm">
            <tbody>
              {data.vendors.map((v: any) => (
                <tr key={v.name} className="border-b last:border-0">
                  <td className="py-1.5">{v.name}</td>
                  <td className="py-1.5 text-right tabular-nums">${v.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1.5">Total Purchases</td>
                <td className="py-1.5 text-right tabular-nums">${data.totalPurchases.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
              </tr>
              {showCogs && (
                <>
                  <tr className="font-semibold">
                    <td className="py-1.5">Usage (Start + Purchases − End)</td>
                    <td className="py-1.5 text-right tabular-nums">${usage.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  </tr>
                  <tr className="font-semibold text-primary">
                    <td className="py-1.5">COGS</td>
                    <td className="py-1.5 text-right tabular-nums">${data.cogs.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function LaborBlock({ data, salesNet, options }: { data: any; salesNet: number; options?: any }) {
  const hasAny = data.totalHours > 0 || data.grossWages > 0;
  if (!hasAny) {
    return <p className="text-sm text-muted-foreground italic">No labor data synced for this period.</p>;
  }
  const view: 'summary' | 'weekly' | 'percent' = options?.view ?? 'summary';
  const enabledMetrics: string[] = options?.metrics ?? ['totalHours', 'otHours', 'dotHours', 'grossWages', 'laborPct'];
  const laborPct = salesNet > 0 ? (data.grossWages / salesNet) * 100 : 0;

  if (view === 'percent') {
    return (
      <div className="p-3 rounded bg-muted/40">
        <div className="text-xs text-muted-foreground">Labor % of Sales</div>
        <div className="text-2xl font-bold">{salesNet > 0 ? `${laborPct.toFixed(1)}%` : '—'}</div>
      </div>
    );
  }

  if (view === 'weekly') {
    // Group days by ISO week (Mon-Sun)
    const weekMap = new Map<string, { start: string; end: string; totalHours: number; otHours: number; dotHours: number; grossWages: number }>();
    (data.days || []).forEach((d: any) => {
      const dt = new Date(d.date + 'T00:00:00');
      const day = (dt.getDay() + 6) % 7; // Mon=0
      const monday = new Date(dt); monday.setDate(dt.getDate() - day);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      const key = monday.toISOString().slice(0, 10);
      const ex = weekMap.get(key);
      if (ex) { ex.totalHours += d.totalHours; ex.otHours += d.otHours; ex.dotHours += d.dotHours; ex.grossWages += d.grossWages; ex.end = sunday.toISOString().slice(0, 10); }
      else weekMap.set(key, { start: key, end: sunday.toISOString().slice(0, 10), totalHours: d.totalHours, otHours: d.otHours, dotHours: d.dotHours, grossWages: d.grossWages });
    });
    const weeks = Array.from(weekMap.values()).sort((a, b) => a.start.localeCompare(b.start));
    return (
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr>
            <th className="text-left py-1">Week</th>
            <th className="text-right py-1">Hours</th>
            {enabledMetrics.includes('otHours') && <th className="text-right py-1">OT</th>}
            {enabledMetrics.includes('dotHours') && <th className="text-right py-1">DOT</th>}
            <th className="text-right py-1">Wages</th>
            {enabledMetrics.includes('laborPct') && <th className="text-right py-1">Labor %</th>}
          </tr>
        </thead>
        <tbody>
          {weeks.map(w => (
            <tr key={w.start} className="border-b last:border-0">
              <td className="py-1.5">{format(new Date(w.start + 'T00:00:00'), 'MMM d')} – {format(new Date(w.end + 'T00:00:00'), 'MMM d, yyyy')}</td>
              <td className="py-1.5 text-right tabular-nums">{w.totalHours.toFixed(1)}</td>
              {enabledMetrics.includes('otHours') && <td className="py-1.5 text-right tabular-nums">{w.otHours.toFixed(1)}</td>}
              {enabledMetrics.includes('dotHours') && <td className="py-1.5 text-right tabular-nums">{w.dotHours.toFixed(1)}</td>}
              <td className="py-1.5 text-right tabular-nums">${w.grossWages.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
              {enabledMetrics.includes('laborPct') && <td className="py-1.5 text-right tabular-nums">—</td>}
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1.5">Total</td>
            <td className="py-1.5 text-right tabular-nums">{data.totalHours.toFixed(1)}</td>
            {enabledMetrics.includes('otHours') && <td className="py-1.5 text-right tabular-nums">{data.otHours.toFixed(1)}</td>}
            {enabledMetrics.includes('dotHours') && <td className="py-1.5 text-right tabular-nums">{data.dotHours.toFixed(1)}</td>}
            <td className="py-1.5 text-right tabular-nums">${data.grossWages.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
            {enabledMetrics.includes('laborPct') && <td className="py-1.5 text-right tabular-nums">{salesNet > 0 ? `${laborPct.toFixed(1)}%` : '—'}</td>}
          </tr>
        </tbody>
      </table>
    );
  }

  const all = [
    { key: 'totalHours', label: 'Total Hours', val: data.totalHours.toFixed(1) },
    { key: 'regularHours', label: 'Regular Hours', val: data.regularHours.toFixed(1) },
    { key: 'otHours', label: 'OT Hours', val: data.otHours.toFixed(1) },
    { key: 'dotHours', label: 'DOT Hours', val: data.dotHours.toFixed(1) },
    { key: 'grossWages', label: 'Gross Wages', val: `$${data.grossWages.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
    { key: 'laborPct', label: 'Labor %', val: salesNet > 0 ? `${laborPct.toFixed(1)}%` : '—' },
  ];
  const visible = all.filter(s => enabledMetrics.includes(s.key));
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
      {visible.map(s => (
        <div key={s.key} className="p-2 rounded bg-muted/40">
          <div className="text-xs text-muted-foreground">{s.label}</div>
          <div className="font-semibold">{s.val}</div>
        </div>
      ))}
    </div>
  );
}

function CashBlock({ data, options }: { data: any; options?: any }) {
  if (!data.days || data.days.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No cash drawer data for this period.</p>;
  }
  const view: 'daily' | 'weekly' | 'total' = options?.view ?? 'daily';

  if (view === 'total') {
    return (
      <div className="p-3 rounded bg-muted/40">
        <div className="text-xs text-muted-foreground">Total Over/Short</div>
        <div className={cn('text-2xl font-bold tabular-nums', data.totalVariance >= 0 ? 'text-emerald-600' : 'text-destructive')}>
          {data.totalVariance >= 0 ? '+' : ''}${data.totalVariance.toFixed(2)}
        </div>
        <div className="text-xs text-muted-foreground mt-1">Drawer Total: ${data.total.toFixed(2)}</div>
      </div>
    );
  }

  if (view === 'weekly') {
    const weekMap = new Map<string, { start: string; end: string; total: number; variance: number }>();
    data.days.forEach((d: any) => {
      const dt = new Date(d.date + 'T00:00:00');
      const day = (dt.getDay() + 6) % 7;
      const monday = new Date(dt); monday.setDate(dt.getDate() - day);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      const key = monday.toISOString().slice(0, 10);
      const ex = weekMap.get(key);
      if (ex) { ex.total += d.total; ex.variance += d.variance; ex.end = sunday.toISOString().slice(0, 10); }
      else weekMap.set(key, { start: key, end: sunday.toISOString().slice(0, 10), total: d.total, variance: d.variance });
    });
    const weeks = Array.from(weekMap.values()).sort((a, b) => a.start.localeCompare(b.start));
    return (
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr><th className="text-left py-1">Week</th><th className="text-right py-1">Drawer Total</th><th className="text-right py-1">Over/Short</th></tr>
        </thead>
        <tbody>
          {weeks.map(w => (
            <tr key={w.start} className="border-b last:border-0">
              <td className="py-1.5">{w.start} – {w.end}</td>
              <td className="py-1.5 text-right tabular-nums">${w.total.toFixed(2)}</td>
              <td className={cn('py-1.5 text-right tabular-nums', w.variance >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                {w.variance >= 0 ? '+' : ''}${w.variance.toFixed(2)}
              </td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1.5">Total</td>
            <td className="py-1.5 text-right tabular-nums">${data.total.toFixed(2)}</td>
            <td className={cn('py-1.5 text-right tabular-nums', data.totalVariance >= 0 ? 'text-emerald-600' : 'text-destructive')}>
              {data.totalVariance >= 0 ? '+' : ''}${data.totalVariance.toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr><th className="text-left py-1">Date</th><th className="text-right py-1">Drawer Total</th><th className="text-right py-1">Over/Short</th></tr>
        </thead>
        <tbody>
          {data.days.map((d: any) => (
            <tr key={d.date} className="border-b last:border-0">
              <td className="py-1.5">{d.date}</td>
              <td className="py-1.5 text-right tabular-nums">${d.total.toFixed(2)}</td>
              <td className={cn('py-1.5 text-right tabular-nums', d.variance >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                {d.variance >= 0 ? '+' : ''}${d.variance.toFixed(2)}
              </td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1.5">Total</td>
            <td className="py-1.5 text-right tabular-nums">${data.total.toFixed(2)}</td>
            <td className={cn('py-1.5 text-right tabular-nums', data.totalVariance >= 0 ? 'text-emerald-600' : 'text-destructive')}>
              {data.totalVariance >= 0 ? '+' : ''}${data.totalVariance.toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function renderBlock(block: ReportBlock, locationData: LocationReportData) {
  switch (block.type) {
    case 'header':
      return <h2 className="text-xl font-bold border-b pb-1">{block.title}</h2>;
    case 'text':
      return <p className="text-sm whitespace-pre-wrap">{block.options?.body || block.title}</p>;
    case 'spacer':
      return <div style={{ height: block.options?.height || 24 }} />;
    case 'inventory':
      return <div><h3 className="font-semibold text-sm mb-2">{block.title}</h3><InventoryBlock data={locationData.inventory} options={block.options} /></div>;
    case 'labor':
      return <div><h3 className="font-semibold text-sm mb-2">{block.title}</h3><LaborBlock data={locationData.labor} salesNet={locationData.sales.net} options={block.options} /></div>;
    case 'cash':
      return <div><h3 className="font-semibold text-sm mb-2">{block.title}</h3><CashBlock data={locationData.cash} options={block.options} /></div>;
    case 'sales':
      return (
        <div>
          <h3 className="font-semibold text-sm mb-2">{block.title}</h3>
          <div className="text-2xl font-bold tabular-nums">${locationData.sales.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          {block.options?.showGuests !== false && (
            <div className="text-xs text-muted-foreground">Guests: {locationData.sales.guests.toLocaleString()}</div>
          )}
        </div>
      );
  }
}

// ============ MAIN PAGE ============
export default function Reporting() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isOrgAdmin, isBrandAdmin, isSuperAdmin } = useUserRole();
  const { organizationId, locations: allLocations } = useAppLocation();

  const canAccess = isOrgAdmin || isBrandAdmin || isSuperAdmin;

  // Toolbar state
  const [preset, setPreset] = useState<DatePreset>('mtd');
  const [customRange, setCustomRange] = useState<{ from: Date; to: Date }>(presetRange('mtd'));
  const range = preset === 'custom' ? customRange : presetRange(preset);
  const [zoom, setZoom] = useState(1);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  // Report config
  const [config, setConfig] = useState<ReportConfig>({
    orientation: 'portrait',
    showCrooLogo: true,
    showBrandLogo: true,
    author: '',
    reportTitle: 'Operations Report',
    blocks: [
      { id: crypto.randomUUID(), type: 'header', title: 'Inventory' },
      { id: crypto.randomUUID(), type: 'inventory', title: 'Inventory Summary' },
      { id: crypto.randomUUID(), type: 'header', title: 'Labor' },
      { id: crypto.randomUUID(), type: 'labor', title: 'Gross Labor' },
      { id: crypto.randomUUID(), type: 'header', title: 'Cash' },
      { id: crypto.randomUUID(), type: 'cash', title: 'Cash Over/Short' },
    ],
    scope: 'org',
    locationIds: [],
    combineLocations: false,
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingBlock, setEditingBlock] = useState<ReportBlock | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [organizationName, setOrganizationName] = useState<string>('');
  const [loadedTemplateId, setLoadedTemplateId] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const isMobile = useIsMobile();
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [mobileDataPointsOpen, setMobileDataPointsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'build' | 'preview'>('build');

  // Fetch templates
  useEffect(() => {
    if (!organizationId) return;
    supabase.from('report_templates')
      .select('*')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false })
      .then(({ data }) => setTemplates(data || []));
  }, [organizationId]);

  // Fetch organization name for letterhead
  useEffect(() => {
    if (!organizationId) return;
    supabase.from('organizations').select('name').eq('id', organizationId).maybeSingle()
      .then(({ data }) => setOrganizationName(data?.name || ''));
  }, [organizationId]);

  // Auto-fill author with current user's name (only if empty)
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('profiles')
      .select('full_name, nickname')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const name = (data.nickname?.trim() || data.full_name?.trim() || '').toString();
        if (name) {
          setConfig(c => (c.author?.trim() ? c : { ...c, author: name }));
        }
      });
  }, [user?.id]);

  // Resolve which locations to render
  const targetLocations = useMemo(() => {
    if (config.scope === 'org') return allLocations.filter(l => l.organization_id === organizationId);
    return allLocations.filter(l => config.locationIds.includes(l.id));
  }, [config.scope, config.locationIds, allLocations, organizationId]);

  // ============ LIVE DATA ============
  const targetIds = useMemo(() => targetLocations.map(l => l.id), [targetLocations]);
  const { data: liveData, isLoading: dataLoading } = useMultiLocationReportData(targetIds, range.from, range.to);

  const EMPTY: LocationReportData = {
    inventory: { startingCount: 0, endingCount: 0, vendors: [], totalPurchases: 0, cogs: 0, cogsPct: 0, aligned: false },
    labor: { totalHours: 0, regularHours: 0, otHours: 0, dotHours: 0, grossWages: 0, days: [] },
    cash: { days: [], total: 0, totalVariance: 0 },
    sales: { net: 0, guests: 0 },
  };
  const combinedData = liveData?.combined ?? EMPTY;
  const dataByLocation = liveData?.byLocation ?? {};

  // ============ DRAG HANDLERS ============
  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    // Library drop
    if (String(active.id).startsWith('lib:')) {
      const type = String(active.id).slice(4) as BlockType;
      const lib = DATA_LIBRARY.find(d => d.type === type);
      if (!lib) return;
      const newBlock: ReportBlock = { id: crypto.randomUUID(), type, title: lib.title };
      setConfig(c => ({ ...c, blocks: [...c.blocks, newBlock] }));
      return;
    }
    // Reorder
    if (active.id !== over.id) {
      setConfig(c => {
        const oldIndex = c.blocks.findIndex(b => b.id === active.id);
        const newIndex = c.blocks.findIndex(b => b.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return c;
        return { ...c, blocks: arrayMove(c.blocks, oldIndex, newIndex) };
      });
    }
  };

  const addBlock = (type: BlockType) => {
    const lib = DATA_LIBRARY.find(d => d.type === type)!;
    setConfig(c => ({ ...c, blocks: [...c.blocks, { id: crypto.randomUUID(), type, title: lib.title }] }));
  };
  const removeBlock = (id: string) => setConfig(c => ({ ...c, blocks: c.blocks.filter(b => b.id !== id) }));
  const updateBlock = (id: string, patch: Partial<ReportBlock>) =>
    setConfig(c => ({ ...c, blocks: c.blocks.map(b => b.id === id ? { ...b, ...patch } : b) }));

  // ============ TEMPLATE SAVE/LOAD ============
  const refetchTemplates = async () => {
    if (!organizationId) return;
    const { data } = await supabase.from('report_templates').select('*').eq('organization_id', organizationId).order('updated_at', { ascending: false });
    setTemplates(data || []);
  };

  const saveTemplate = async () => {
    if (!organizationId || !templateName.trim()) return;
    const { data, error } = await supabase.from('report_templates').insert({
      organization_id: organizationId,
      name: templateName.trim(),
      description: templateDesc.trim() || null,
      config: config as any,
      created_by: user?.id,
    }).select('id').maybeSingle();
    if (error) { toast.error('Could not save: ' + error.message); return; }
    toast.success('Template saved');
    setSaveDialogOpen(false);
    setTemplateName(''); setTemplateDesc('');
    if (data?.id) setLoadedTemplateId(data.id);
    refetchTemplates();
  };

  const updateLoadedTemplate = async () => {
    if (!loadedTemplateId) return;
    const { error } = await supabase.from('report_templates').update({
      config: config as any,
      updated_at: new Date().toISOString(),
    }).eq('id', loadedTemplateId);
    if (error) { toast.error('Could not update: ' + error.message); return; }
    toast.success('Template updated');
    refetchTemplates();
  };

  const loadTemplate = (t: any) => {
    setConfig(t.config as ReportConfig);
    setLoadedTemplateId(t.id);
    setTemplatesOpen(false);
    toast.success(`Loaded: ${t.name}`);
  };

  const deleteTemplate = async (id: string) => {
    const { error } = await supabase.from('report_templates').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    setTemplates(t => t.filter(x => x.id !== id));
    toast.success('Template deleted');
  };

  // ============ EXPORT ============
  const exportPDF = async () => {
    if (!previewRef.current) return;
    toast.info('Generating PDF…');
    const canvas = await html2canvas(previewRef.current, { scale: 2, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: config.orientation, unit: 'pt', format: 'letter' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW - 40;
    const imgH = (canvas.height * imgW) / canvas.width;
    let heightLeft = imgH;
    let position = 20;
    pdf.addImage(imgData, 'PNG', 20, position, imgW, imgH);
    heightLeft -= (pageH - 40);
    while (heightLeft > 0) {
      pdf.addPage();
      position = 20 - (imgH - heightLeft);
      pdf.addImage(imgData, 'PNG', 20, position, imgW, imgH);
      heightLeft -= (pageH - 40);
    }
    pdf.save(`${config.reportTitle.replace(/\s+/g, '_')}_${format(range.from, 'yyyyMMdd')}-${format(range.to, 'yyyyMMdd')}.pdf`);
    toast.success('PDF downloaded');
  };

  const exportCSV = () => {
    const rows: any[] = [];
    targetLocations.forEach(loc => {
      const d = dataByLocation[loc.id] ?? EMPTY;
      rows.push({ Location: loc.name, Section: 'Inventory — Starting Count', Value: d.inventory.startingCount });
      rows.push({ Location: loc.name, Section: 'Inventory — Ending Count', Value: d.inventory.endingCount });
      d.inventory.vendors.forEach(v => rows.push({ Location: loc.name, Section: `Inventory — ${v.name}`, Value: v.amount }));
      rows.push({ Location: loc.name, Section: 'Inventory — Total Purchases', Value: d.inventory.totalPurchases });
      rows.push({ Location: loc.name, Section: 'Inventory — COGS', Value: d.inventory.cogs });
      rows.push({ Location: loc.name, Section: 'Inventory — COGS %', Value: d.inventory.cogsPct });
      rows.push({ Location: loc.name, Section: 'Labor — Total Hours', Value: d.labor.totalHours });
      rows.push({ Location: loc.name, Section: 'Labor — OT Hours', Value: d.labor.otHours });
      rows.push({ Location: loc.name, Section: 'Labor — DOT Hours', Value: d.labor.dotHours });
      rows.push({ Location: loc.name, Section: 'Labor — Gross Wages', Value: d.labor.grossWages });
      rows.push({ Location: loc.name, Section: 'Sales — Net', Value: d.sales.net });
      rows.push({ Location: loc.name, Section: 'Sales — Guests', Value: d.sales.guests });
    });
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${config.reportTitle.replace(/\s+/g, '_')}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
  };

  const sendEmail = async () => {
    const recips = emailRecipients.split(',').map(s => s.trim()).filter(Boolean);
    if (recips.length === 0) { toast.error('Add at least one recipient'); return; }
    if (!previewRef.current) { toast.error('Preview not ready'); return; }
    setEmailSending(true);
    try {
      toast.info('Generating PDF…');
      const canvas = await html2canvas(previewRef.current, { scale: 2, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: config.orientation, unit: 'pt', format: 'letter' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW - 40;
      const imgH = (canvas.height * imgW) / canvas.width;
      let heightLeft = imgH;
      let position = 20;
      pdf.addImage(imgData, 'PNG', 20, position, imgW, imgH);
      heightLeft -= (pageH - 40);
      while (heightLeft > 0) {
        pdf.addPage();
        position = 20 - (imgH - heightLeft);
        pdf.addImage(imgData, 'PNG', 20, position, imgW, imgH);
        heightLeft -= (pageH - 40);
      }
      const pdfBase64 = pdf.output('datauristring').split(',')[1];
      const fileName = `${config.reportTitle.replace(/\s+/g, '_')}_${format(range.from, 'yyyyMMdd')}-${format(range.to, 'yyyyMMdd')}.pdf`;
      const period = `${format(range.from, 'MMM d, yyyy')} – ${format(range.to, 'MMM d, yyyy')}`;
      const { error } = await supabase.functions.invoke('send-report-email', {
        body: { recipients: recips, reportTitle: config.reportTitle, period, author: config.author, pdfBase64, fileName },
      });
      if (error) throw error;
      toast.success(`Sent to ${recips.length} recipient${recips.length > 1 ? 's' : ''}`);
      setEmailDialogOpen(false);
      setEmailRecipients('');
    } catch (err: any) {
      toast.error('Send failed: ' + (err?.message || String(err)));
    } finally {
      setEmailSending(false);
    }
  };

  if (!canAccess) {
    return (
      <Layout>
        <div className="p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">Reporting</h1>
          <p className="text-muted-foreground">Org admin access required.</p>
        </div>
      </Layout>
    );
  }

  // Page sizing for canvas (visual only) — fixed width so landscape actually appears wider
  const pageWidthPx = config.orientation === 'portrait' ? 816 : 1056;
  const pageHeightPx = config.orientation === 'portrait' ? 1056 : 816;

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {/* HEADER BAR */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>
              <ArrowLeft className="h-4 w-4 mr-1" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold truncate">Reporting</h1>
              <p className="hidden sm:block text-xs text-muted-foreground">Build custom reports for your organization</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Sheet open={templatesOpen} onOpenChange={setTemplatesOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm"><Library className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Templates ({templates.length})</span></Button>
              </SheetTrigger>
              <SheetContent>
                <h3 className="font-semibold mb-3">Saved Templates</h3>
                <ScrollArea className="h-[80vh]">
                  <div className="space-y-2">
                    {templates.length === 0 && <p className="text-sm text-muted-foreground">No templates yet. Build a report and Save Template.</p>}
                    {templates.map(t => (
                      <Card key={t.id} className="p-3 hover:border-primary/40 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => loadTemplate(t)}>
                            <div className="font-medium text-sm truncate">{t.name}</div>
                            {t.description && <div className="text-xs text-muted-foreground truncate">{t.description}</div>}
                            <div className="text-xs text-muted-foreground mt-1">Updated {format(new Date(t.updated_at), 'MMM d, yyyy')}</div>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => deleteTemplate(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </SheetContent>
            </Sheet>

            <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
              <DialogTrigger asChild><Button variant="outline" size="sm"><Save className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Save Template</span></Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Save Report Template</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name</Label><Input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Monthly P&L" /></div>
                  <div><Label>Description (optional)</Label><Textarea value={templateDesc} onChange={e => setTemplateDesc(e.target.value)} /></div>
                </div>
                <DialogFooter className="gap-2">
                  {loadedTemplateId && (
                    <Button variant="outline" onClick={() => { updateLoadedTemplate(); setSaveDialogOpen(false); }}>Update existing</Button>
                  )}
                  <Button onClick={saveTemplate} disabled={!templateName.trim()}>Save as new</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
              <DialogTrigger asChild><Button size="sm"><Download className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Export</span></Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Export Report</DialogTitle></DialogHeader>
                <div className="grid grid-cols-3 gap-3">
                  <button onClick={() => { exportPDF(); setExportDialogOpen(false); }} className="p-4 rounded-lg border hover:border-primary/40 transition-colors text-center">
                    <FileText className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <div className="font-medium text-sm">PDF</div>
                    <div className="text-xs text-muted-foreground">Print-ready</div>
                  </button>
                  <button onClick={() => { exportCSV(); setExportDialogOpen(false); }} className="p-4 rounded-lg border hover:border-primary/40 transition-colors text-center">
                    <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <div className="font-medium text-sm">CSV</div>
                    <div className="text-xs text-muted-foreground">Raw data</div>
                  </button>
                  <button onClick={() => { setExportDialogOpen(false); setEmailDialogOpen(true); }} className="p-4 rounded-lg border hover:border-primary/40 transition-colors text-center">
                    <Mail className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <div className="font-medium text-sm">Email</div>
                    <div className="text-xs text-muted-foreground">Send PDF</div>
                  </button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
              <DialogContent>
                <DialogHeader><DialogTitle>Email Report</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Recipients (comma-separated)</Label><Input value={emailRecipients} onChange={e => setEmailRecipients(e.target.value)} placeholder="dave@store.com, gm@store.com" /></div>
                </div>
                <DialogFooter><Button onClick={sendEmail} disabled={emailSending}>{emailSending ? 'Sending…' : 'Send'}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* MOBILE CONTROL BAR — settings + data points + view toggle */}
        <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b bg-card">
          <Button variant="outline" size="sm" className="h-8 flex-1" onClick={() => setMobileSettingsOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />Settings
          </Button>
          <Button variant="outline" size="sm" className="h-8 flex-1" onClick={() => setMobileDataPointsOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Block
          </Button>
        </div>
        <div className="md:hidden border-b bg-muted/30 px-3 py-2">
          <Tabs value={mobileTab} onValueChange={v => setMobileTab(v as 'build' | 'preview')}>
            <TabsList className="h-8 grid grid-cols-2 w-full">
              <TabsTrigger value="build" className="text-xs h-7"><LayoutGrid className="h-3 w-3 mr-1" />Build</TabsTrigger>
              <TabsTrigger value="preview" className="text-xs h-7"><Eye className="h-3 w-3 mr-1" />Preview</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* MOBILE SETTINGS SHEET */}
        <Sheet open={mobileSettingsOpen} onOpenChange={setMobileSettingsOpen}>
          <SheetContent side="bottom" className="h-[85vh] overflow-y-auto">
            <h3 className="font-semibold mb-4">Report Settings</h3>
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Report Title</Label>
                <Input value={config.reportTitle} onChange={e => setConfig(c => ({ ...c, reportTitle: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Author</Label>
                <Input value={config.author} onChange={e => setConfig(c => ({ ...c, author: e.target.value }))} placeholder="Your name" />
              </div>
              <div className="flex items-center justify-between p-2 rounded border">
                <Label className="text-sm">Show CrooHQ logo</Label>
                <Switch checked={config.showCrooLogo} onCheckedChange={v => setConfig(c => ({ ...c, showCrooLogo: v }))} />
              </div>
              <div>
                <Label className="text-xs mb-2 block">Time Period</Label>
                <Select value={preset} onValueChange={v => setPreset(v as DatePreset)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="yesterday">Yesterday</SelectItem>
                    <SelectItem value="last7">Last 7 days</SelectItem>
                    <SelectItem value="mtd">Month to date</SelectItem>
                    <SelectItem value="lastMonth">Last month</SelectItem>
                    <SelectItem value="ytd">Year to date</SelectItem>
                    <SelectItem value="custom">Custom range</SelectItem>
                  </SelectContent>
                </Select>
                {preset === 'custom' && (
                  <div className="mt-2">
                    <Calendar mode="range" selected={{ from: customRange.from, to: customRange.to }}
                      onSelect={r => r?.from && r?.to && setCustomRange({ from: r.from, to: r.to })}
                      className="p-3 pointer-events-auto border rounded" />
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-2">
                  {format(range.from, 'MMM d, yyyy')} – {format(range.to, 'MMM d, yyyy')}
                </div>
              </div>
              <div>
                <Label className="text-xs mb-2 block">Orientation</Label>
                <Tabs value={config.orientation} onValueChange={v => setConfig(c => ({ ...c, orientation: v as Orientation }))}>
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="portrait">Portrait</TabsTrigger>
                    <TabsTrigger value="landscape">Landscape</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div>
                <Label className="text-xs mb-2 block">Scope</Label>
                <Tabs value={config.scope} onValueChange={v => setConfig(c => ({ ...c, scope: v as 'org' | 'locations' }))}>
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="org"><Building2 className="h-3.5 w-3.5 mr-1" />Org Total</TabsTrigger>
                    <TabsTrigger value="locations"><MapPin className="h-3.5 w-3.5 mr-1" />Pick Locations</TabsTrigger>
                  </TabsList>
                </Tabs>
                {config.scope === 'locations' && (
                  <div className="mt-3 space-y-2">
                    <ScrollArea className="h-48 border rounded p-2">
                      <div className="space-y-1">
                        {allLocations.filter(l => l.organization_id === organizationId).map(l => (
                          <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1.5 rounded">
                            <Checkbox checked={config.locationIds.includes(l.id)}
                              onCheckedChange={v => setConfig(c => ({ ...c, locationIds: v ? [...c.locationIds, l.id] : c.locationIds.filter(id => id !== l.id) }))} />
                            <span>{l.name}</span>
                          </label>
                        ))}
                      </div>
                    </ScrollArea>
                    <div className="flex items-center justify-between p-2 rounded border">
                      <Label className="text-sm">Combine into one report</Label>
                      <Switch checked={config.combineLocations} onCheckedChange={v => setConfig(c => ({ ...c, combineLocations: v }))} />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <Button className="w-full mt-4" onClick={() => setMobileSettingsOpen(false)}>Done</Button>
          </SheetContent>
        </Sheet>

        {/* MOBILE DATA POINTS SHEET */}
        <Sheet open={mobileDataPointsOpen} onOpenChange={setMobileDataPointsOpen}>
          <SheetContent side="bottom" className="h-[60vh] overflow-y-auto">
            <h3 className="font-semibold mb-3">Add Data Block</h3>
            <div className="space-y-2">
              {DATA_LIBRARY.map(item => {
                const Icon = item.icon;
                return (
                  <button key={item.type}
                    onClick={() => { addBlock(item.type); setMobileDataPointsOpen(false); }}
                    className="w-full flex items-start gap-3 p-3 rounded-lg border hover:border-primary/40 hover:bg-muted/30 text-left transition-colors">
                    <Icon className="h-5 w-5 mt-0.5 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="text-xs text-muted-foreground">{item.description}</div>
                    </div>
                    <Plus className="h-4 w-4 text-muted-foreground mt-1" />
                  </button>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>

        {/* ROW 1 — TITLE INFO + SETTINGS (desktop only) */}
        <div className="hidden md:block px-4 py-3 border-b bg-card">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <Label className="text-xs">Report Title</Label>
              <Input value={config.reportTitle} onChange={e => setConfig(c => ({ ...c, reportTitle: e.target.value }))} className="h-8" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <Label className="text-xs">Author</Label>
              <Input value={config.author} onChange={e => setConfig(c => ({ ...c, author: e.target.value }))} placeholder="Your name" className="h-8" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">CrooHQ logo</Label>
              <div className="h-8 flex items-center">
                <Switch checked={config.showCrooLogo} onCheckedChange={v => setConfig(c => ({ ...c, showCrooLogo: v }))} />
              </div>
            </div>
            <div className="flex flex-col gap-1 min-w-[260px]">
              <Label className="text-xs">Scope</Label>
              <div className="flex items-center gap-2">
                <Tabs value={config.scope} onValueChange={v => setConfig(c => ({ ...c, scope: v as 'org' | 'locations' }))}>
                  <TabsList className="h-8">
                    <TabsTrigger value="org" className="text-xs h-7"><Building2 className="h-3 w-3 mr-1" />Org Total</TabsTrigger>
                    <TabsTrigger value="locations" className="text-xs h-7"><MapPin className="h-3 w-3 mr-1" />Pick</TabsTrigger>
                  </TabsList>
                </Tabs>
                {config.scope === 'locations' && (
                  <>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 whitespace-nowrap">
                          {config.locationIds.length || 0} loc
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-2" align="end">
                        <ScrollArea className="h-48">
                          <div className="space-y-1">
                            {allLocations.filter(l => l.organization_id === organizationId).map(l => (
                              <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1 rounded">
                                <Checkbox checked={config.locationIds.includes(l.id)}
                                  onCheckedChange={v => setConfig(c => ({ ...c, locationIds: v ? [...c.locationIds, l.id] : c.locationIds.filter(id => id !== l.id) }))} />
                                <span>{l.name}</span>
                              </label>
                            ))}
                          </div>
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs whitespace-nowrap">Combine</Label>
                      <Switch checked={config.combineLocations} onCheckedChange={v => setConfig(c => ({ ...c, combineLocations: v }))} />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ROW 2 — TIME PERIOD TOOLBAR */}
        <div className="hidden md:flex items-center gap-2 px-4 py-2 border-b bg-muted/30 flex-wrap">
          <Tabs value={preset} onValueChange={v => setPreset(v as DatePreset)}>
            <TabsList className="h-8">
              <TabsTrigger value="today" className="text-xs h-7">Today</TabsTrigger>
              <TabsTrigger value="yesterday" className="text-xs h-7">Yest</TabsTrigger>
              <TabsTrigger value="last7" className="text-xs h-7">7d</TabsTrigger>
              <TabsTrigger value="mtd" className="text-xs h-7">MTD</TabsTrigger>
              <TabsTrigger value="lastMonth" className="text-xs h-7">Last Mo</TabsTrigger>
              <TabsTrigger value="ytd" className="text-xs h-7">YTD</TabsTrigger>
              <TabsTrigger value="custom" className="text-xs h-7">Custom</TabsTrigger>
            </TabsList>
          </Tabs>
          {preset === 'custom' && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <CalendarIcon className="h-3.5 w-3.5 mr-1" />
                  {format(customRange.from, 'MMM d')} – {format(customRange.to, 'MMM d, yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="range" selected={{ from: customRange.from, to: customRange.to }}
                  onSelect={r => r?.from && r?.to && setCustomRange({ from: r.from, to: r.to })}
                  className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          )}
          <Separator orientation="vertical" className="h-6" />
          <Badge variant="secondary" className="text-xs">
            {format(range.from, 'MMM d')} – {format(range.to, 'MMM d, yyyy')}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Tabs value={config.orientation} onValueChange={v => setConfig(c => ({ ...c, orientation: v as Orientation }))}>
              <TabsList className="h-8">
                <TabsTrigger value="portrait" className="text-xs h-7">Portrait</TabsTrigger>
                <TabsTrigger value="landscape" className="text-xs h-7">Landscape</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* ROW 3 — DATA POINTS (horizontal) */}
        <div className="hidden md:block border-b bg-card">
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Data Points:</span>
            <ScrollArea className="flex-1">
              <div className="flex items-center gap-2 pb-1">
                {DATA_LIBRARY.map(item => {
                  const Icon = item.icon;
                  return (
                    <button key={item.type} onClick={() => addBlock(item.type)}
                      title={item.description}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-background hover:bg-muted/50 hover:border-primary/40 text-xs font-medium whitespace-nowrap transition-colors">
                      <Icon className="h-3.5 w-3.5 text-primary" />
                      {item.title}
                      <Plus className="h-3 w-3 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* MAIN: BLOCKS LIST + PREVIEW */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex flex-1 overflow-hidden">
            {/* CANVAS / BLOCKS LIST */}
            <div className={cn(
              "border-r overflow-y-auto bg-muted/20 p-2",
              "md:w-56 md:flex-shrink-0",
              "w-full",
              isMobile && mobileTab !== 'build' && "hidden",
              isMobile && mobileTab === 'build' && "flex-1"
            )}>
              <div className="text-xs font-semibold text-muted-foreground mb-2 px-1">Report Blocks ({config.blocks.length})</div>
              <SortableContext items={config.blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {config.blocks.map(b => (
                    <SortableBlock key={b.id} block={b} onRemove={() => removeBlock(b.id)} onEdit={() => setEditingBlock(b)} />
                  ))}
                </div>
              </SortableContext>
              {config.blocks.length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm">Click data points above to add them.</div>
              )}
            </div>

            {/* PREVIEW */}
            <div ref={previewScrollRef} className={cn(
              "border-l bg-muted/20 overflow-auto p-4",
              "md:w-[50%] md:flex-shrink-0",
              "w-full flex-1",
              isMobile && mobileTab !== 'preview' && "hidden"
            )}>
              <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" />Live Preview</div>
                <div className="flex items-center gap-0.5 border rounded-md px-0.5 py-0.5 bg-background ml-2">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2)))} title="Zoom out">
                    <ZoomOut className="h-3.5 w-3.5" />
                  </Button>
                  <button onClick={() => setZoom(1)} className="text-xs font-medium tabular-nums w-10 text-center hover:text-primary" title="Reset to 100%">
                    {Math.round(zoom * 100)}%
                  </button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))} title="Zoom in">
                    <ZoomIn className="h-3.5 w-3.5" />
                  </Button>
                  <Separator orientation="vertical" className="h-4 mx-0.5" />
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                    const el = previewScrollRef.current;
                    if (!el) return;
                    const avail = el.clientWidth - 32;
                    const fit = Math.max(0.25, Math.min(2, avail / pageWidthPx));
                    setZoom(+fit.toFixed(2));
                  }} title="Fit to screen">
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div style={{ width: pageWidthPx * zoom, height: pageHeightPx * zoom, margin: '0 auto' }}>
                <div className="bg-white shadow-lg" style={{ width: pageWidthPx, minHeight: pageHeightPx, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
                <div ref={previewRef} className="p-4 sm:p-8 md:p-12 text-foreground bg-white" style={{ color: '#000' }}>
                  {/* LETTERHEAD */}
                  <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-black">
                    <div>
                      <h1 className="text-2xl font-bold">{config.reportTitle}</h1>
                      {config.scope === 'org' && organizationName && (
                        <p className="text-sm font-semibold text-gray-700 mt-0.5">{organizationName}</p>
                      )}
                      <p className="text-sm text-gray-600 mt-1">{format(range.from, 'MMM d, yyyy')} – {format(range.to, 'MMM d, yyyy')}</p>
                      {config.author && <p className="text-xs text-gray-500 mt-2">Prepared by: {config.author}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      {config.showCrooLogo && <div className="text-right"><div className="text-xs text-gray-400">Powered by</div><div className="font-bold text-sm">CrooHQ</div></div>}
                    </div>
                  </div>

                  {/* CONTENT — per location section + grand total */}
                  {targetLocations.length === 0 && config.scope === 'locations' && (
                    <p className="text-sm text-gray-500 italic">Select at least one location.</p>
                  )}
                  {(config.scope === 'org' || config.combineLocations) && (
                    <div className="space-y-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                        {config.scope === 'org' ? 'Organization Total' : 'Combined Total'}
                      </div>
                      {dataLoading && <p className="text-sm text-gray-400">Loading data…</p>}
                      {config.blocks.map(b => <div key={b.id}>{renderBlock(b, combinedData)}</div>)}
                    </div>
                  )}
                  {config.scope === 'locations' && !config.combineLocations && targetLocations.map((loc, i) => (
                    <div key={loc.id} className={cn('space-y-4', i > 0 && 'mt-8 pt-8 border-t')}>
                      <h2 className="text-lg font-bold">{loc.name}</h2>
                      {config.blocks.map(b => <div key={b.id}>{renderBlock(b, dataByLocation[loc.id] ?? EMPTY)}</div>)}
                    </div>
                  ))}
                  {config.scope === 'locations' && !config.combineLocations && targetLocations.length > 1 && (
                    <div className="mt-8 pt-8 border-t-2 border-black space-y-4">
                      <h2 className="text-lg font-bold">Grand Total</h2>
                      {config.blocks.map(b => <div key={b.id}>{renderBlock(b, combinedData)}</div>)}
                    </div>
                  )}
                </div>
              </div>
              </div>
            </div>
          </div>

          <DragOverlay>
            {activeId && config.blocks.find(b => b.id === activeId) && (
              <div className="p-3 rounded-lg border bg-card shadow-lg text-sm font-medium">
                {config.blocks.find(b => b.id === activeId)?.title}
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {/* EDIT BLOCK DIALOG */}
        <Dialog open={!!editingBlock} onOpenChange={v => !v && setEditingBlock(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Block</DialogTitle></DialogHeader>
            {editingBlock && (
              <div className="space-y-4">
                <div><Label>Title</Label><Input value={editingBlock.title} onChange={e => setEditingBlock({ ...editingBlock, title: e.target.value })} /></div>

                {editingBlock.type === 'text' && (
                  <div><Label>Body</Label><Textarea rows={5} value={editingBlock.options?.body || ''}
                    onChange={e => setEditingBlock({ ...editingBlock, options: { ...editingBlock.options, body: e.target.value } })} /></div>
                )}

                {editingBlock.type === 'labor' && (() => {
                  const opts = editingBlock.options || {};
                  const view = opts.view ?? 'summary';
                  const metrics: string[] = opts.metrics ?? ['totalHours', 'otHours', 'dotHours', 'grossWages', 'laborPct'];
                  const toggleMetric = (k: string) => {
                    const next = metrics.includes(k) ? metrics.filter(m => m !== k) : [...metrics, k];
                    setEditingBlock({ ...editingBlock, options: { ...opts, metrics: next } });
                  };
                  return (
                    <>
                      <div>
                        <Label>View</Label>
                        <Select value={view} onValueChange={v => setEditingBlock({ ...editingBlock, options: { ...opts, view: v } })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="summary">Month Summary (totals)</SelectItem>
                            <SelectItem value="weekly">Weekly Breakdown</SelectItem>
                            <SelectItem value="percent">Labor % only</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {view !== 'percent' && (
                        <div>
                          <Label>Metrics shown</Label>
                          <div className="grid grid-cols-2 gap-2 mt-1">
                            {[
                              { k: 'totalHours', l: 'Total Hours' },
                              { k: 'regularHours', l: 'Regular Hours' },
                              { k: 'otHours', l: 'OT Hours' },
                              { k: 'dotHours', l: 'DOT Hours' },
                              { k: 'grossWages', l: 'Gross Wages' },
                              { k: 'laborPct', l: 'Labor %' },
                            ].map(m => (
                              <label key={m.k} className="flex items-center gap-2 text-sm">
                                <Checkbox checked={metrics.includes(m.k)} onCheckedChange={() => toggleMetric(m.k)} />
                                {m.l}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}

                {editingBlock.type === 'cash' && (
                  <div>
                    <Label>View</Label>
                    <Select
                      value={editingBlock.options?.view ?? 'daily'}
                      onValueChange={v => setEditingBlock({ ...editingBlock, options: { ...editingBlock.options, view: v } })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="total">Month Total only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {editingBlock.type === 'inventory' && (() => {
                  const opts = editingBlock.options || {};
                  return (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={opts.showVendors !== false}
                          onCheckedChange={v => setEditingBlock({ ...editingBlock, options: { ...opts, showVendors: v === true } })} />
                        Show purchases by vendor
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={opts.showCogs !== false}
                          onCheckedChange={v => setEditingBlock({ ...editingBlock, options: { ...opts, showCogs: v === true } })} />
                        Show usage / COGS rows
                      </label>
                    </div>
                  );
                })()}

                {editingBlock.type === 'sales' && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={editingBlock.options?.showGuests !== false}
                      onCheckedChange={v => setEditingBlock({ ...editingBlock, options: { ...editingBlock.options, showGuests: v === true } })} />
                    Show guest count
                  </label>
                )}

                {editingBlock.type === 'spacer' && (
                  <div>
                    <Label>Height (px)</Label>
                    <Input type="number" value={editingBlock.options?.height ?? 24}
                      onChange={e => setEditingBlock({ ...editingBlock, options: { ...editingBlock.options, height: Number(e.target.value) } })} />
                  </div>
                )}
              </div>
            )}
            <DialogFooter><Button onClick={() => { if (editingBlock) updateBlock(editingBlock.id, editingBlock); setEditingBlock(null); }}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
