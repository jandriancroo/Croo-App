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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, startOfDay, startOfMonth, startOfYear, endOfDay, endOfMonth, endOfYear, subDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import Papa from 'papaparse';

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
    <div ref={setNodeRef} style={style} className="group flex items-center gap-2 p-3 rounded-lg border bg-card hover:border-primary/40 transition-colors">
      <button {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
        <GripVertical className="h-4 w-4" />
      </button>
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 text-sm font-medium truncate">{block.title}</span>
      <Button size="sm" variant="ghost" onClick={onEdit}><Settings2 className="h-3.5 w-3.5" /></Button>
      <Button size="sm" variant="ghost" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
    </div>
  );
}

// ============ MOCK DATA RENDERERS ============
function InventoryBlock({ data }: { data: any }) {
  const usage = (data.startingCount ?? 0) + (data.totalPurchases ?? 0) - (data.endingCount ?? 0);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="p-2 rounded bg-muted/40">
          <div className="text-xs text-muted-foreground">Starting Count</div>
          <div className="font-semibold">${data.startingCount.toLocaleString()}</div>
        </div>
        <div className="p-2 rounded bg-muted/40">
          <div className="text-xs text-muted-foreground">Ending Count</div>
          <div className="font-semibold">${data.endingCount.toLocaleString()}</div>
        </div>
        <div className="p-2 rounded bg-muted/40">
          <div className="text-xs text-muted-foreground">COGS %</div>
          <div className="font-semibold">{data.cogsPct}%</div>
        </div>
      </div>
      <div className="text-xs font-semibold mt-3 mb-1">Purchases by Vendor</div>
      <table className="w-full text-sm">
        <tbody>
          {data.vendors.map((v: any) => (
            <tr key={v.name} className="border-b last:border-0">
              <td className="py-1.5">{v.name}</td>
              <td className="py-1.5 text-right tabular-nums">${v.amount.toLocaleString()}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1.5">Total Purchases</td>
            <td className="py-1.5 text-right tabular-nums">${data.totalPurchases.toLocaleString()}</td>
          </tr>
          <tr className="font-semibold">
            <td className="py-1.5">Usage (Start + Purchases − End)</td>
            <td className="py-1.5 text-right tabular-nums">${usage.toLocaleString()}</td>
          </tr>
          <tr className="font-semibold text-primary">
            <td className="py-1.5">COGS</td>
            <td className="py-1.5 text-right tabular-nums">${data.cogs.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function LaborBlock({ data }: { data: any }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
      {[
        { label: 'Total Hours', val: data.totalHours.toFixed(1) },
        { label: 'OT Hours', val: data.otHours.toFixed(1) },
        { label: 'DOT Hours', val: data.dotHours.toFixed(1) },
        { label: 'Gross Wages', val: `$${data.grossWages.toLocaleString()}` },
      ].map(s => (
        <div key={s.label} className="p-2 rounded bg-muted/40">
          <div className="text-xs text-muted-foreground">{s.label}</div>
          <div className="font-semibold">{s.val}</div>
        </div>
      ))}
    </div>
  );
}

function CashBlock({ data }: { data: any }) {
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

function renderBlock(block: ReportBlock, locationData: any) {
  switch (block.type) {
    case 'header':
      return <h2 className="text-xl font-bold border-b pb-1">{block.title}</h2>;
    case 'text':
      return <p className="text-sm whitespace-pre-wrap">{block.options?.body || block.title}</p>;
    case 'spacer':
      return <div style={{ height: block.options?.height || 24 }} />;
    case 'inventory':
      return <div><h3 className="font-semibold text-sm mb-2">{block.title}</h3><InventoryBlock data={locationData.inventory} /></div>;
    case 'labor':
      return <div><h3 className="font-semibold text-sm mb-2">{block.title}</h3><LaborBlock data={locationData.labor} /></div>;
    case 'cash':
      return <div><h3 className="font-semibold text-sm mb-2">{block.title}</h3><CashBlock data={locationData.cash} /></div>;
    case 'sales':
      return (
        <div>
          <h3 className="font-semibold text-sm mb-2">{block.title}</h3>
          <div className="text-2xl font-bold tabular-nums">${locationData.sales.net.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Guests: {locationData.sales.guests.toLocaleString()}</div>
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
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Fetch templates
  useEffect(() => {
    if (!organizationId) return;
    supabase.from('report_templates')
      .select('*')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false })
      .then(({ data }) => setTemplates(data || []));
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

  // ============ MOCK DATA — replace with live queries in Phase 2 ============
  const mockLocationData = useMemo(() => ({
    inventory: {
      startingCount: 12450,
      endingCount: 12120,
      vendors: [
        { name: 'PFG', amount: 4560 },
        { name: 'Produce Alliance', amount: 2000 },
      ],
      totalPurchases: 6560,
      cogs: 6890,
      cogsPct: 28.4,
    },
    labor: { totalHours: 1240.5, otHours: 32.0, dotHours: 4.0, grossWages: 28450 },
    cash: {
      days: [
        { date: format(range.from, 'MMM d'), total: 1245.50, variance: -2.50 },
        { date: format(range.to, 'MMM d'), total: 1389.00, variance: 5.00 },
      ],
      total: 2634.50,
      totalVariance: 2.50,
    },
    sales: { net: 24230, guests: 1850 },
  }), [range.from, range.to]);

  // Resolve which locations to render
  const targetLocations = useMemo(() => {
    if (config.scope === 'org') return allLocations.filter(l => l.organization_id === organizationId);
    return allLocations.filter(l => config.locationIds.includes(l.id));
  }, [config.scope, config.locationIds, allLocations, organizationId]);

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
  const saveTemplate = async () => {
    if (!organizationId || !templateName.trim()) return;
    const { error } = await supabase.from('report_templates').insert({
      organization_id: organizationId,
      name: templateName.trim(),
      description: templateDesc.trim() || null,
      config: config as any,
      created_by: user?.id,
    });
    if (error) { toast.error('Could not save: ' + error.message); return; }
    toast.success('Template saved');
    setSaveDialogOpen(false);
    setTemplateName(''); setTemplateDesc('');
    const { data } = await supabase.from('report_templates').select('*').eq('organization_id', organizationId).order('updated_at', { ascending: false });
    setTemplates(data || []);
  };

  const loadTemplate = (t: any) => {
    setConfig(t.config as ReportConfig);
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
      rows.push({ Location: loc.name, Section: 'Inventory — Starting Count', Value: mockLocationData.inventory.startingCount });
      mockLocationData.inventory.vendors.forEach(v => rows.push({ Location: loc.name, Section: `Inventory — ${v.name}`, Value: v.amount }));
      rows.push({ Location: loc.name, Section: 'Inventory — COGS', Value: mockLocationData.inventory.cogs });
      rows.push({ Location: loc.name, Section: 'Inventory — COGS %', Value: mockLocationData.inventory.cogsPct });
      rows.push({ Location: loc.name, Section: 'Labor — Total Hours', Value: mockLocationData.labor.totalHours });
      rows.push({ Location: loc.name, Section: 'Labor — OT Hours', Value: mockLocationData.labor.otHours });
      rows.push({ Location: loc.name, Section: 'Labor — DOT Hours', Value: mockLocationData.labor.dotHours });
      rows.push({ Location: loc.name, Section: 'Labor — Gross Wages', Value: mockLocationData.labor.grossWages });
      rows.push({ Location: loc.name, Section: 'Cash — Total', Value: mockLocationData.cash.total });
      rows.push({ Location: loc.name, Section: 'Cash — Variance', Value: mockLocationData.cash.totalVariance });
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
    toast.info('Email send — coming online with delivery service. PDF generation works now.');
    setEmailDialogOpen(false);
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

  // Page sizing for canvas (visual only)
  const pageW = config.orientation === 'portrait' ? 'max-w-[816px]' : 'max-w-[1056px]';

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {/* HEADER BAR */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>
              <ArrowLeft className="h-4 w-4 mr-1" />
            </Button>
            <div>
              <h1 className="text-lg font-bold">Reporting</h1>
              <p className="text-xs text-muted-foreground">Build custom reports for your organization</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Sheet open={templatesOpen} onOpenChange={setTemplatesOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm"><Library className="h-4 w-4 mr-1" />Templates ({templates.length})</Button>
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
              <DialogTrigger asChild><Button variant="outline" size="sm"><Save className="h-4 w-4 mr-1" />Save Template</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Save Report Template</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name</Label><Input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Monthly P&L" /></div>
                  <div><Label>Description (optional)</Label><Textarea value={templateDesc} onChange={e => setTemplateDesc(e.target.value)} /></div>
                </div>
                <DialogFooter><Button onClick={saveTemplate} disabled={!templateName.trim()}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
              <DialogTrigger asChild><Button size="sm"><Download className="h-4 w-4 mr-1" />Export</Button></DialogTrigger>
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
                <DialogFooter><Button onClick={sendEmail}>Send</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* ROW 1 — TITLE INFO + SETTINGS */}
        <div className="px-4 py-3 border-b bg-card">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <div>
              <Label className="text-xs">Report Title</Label>
              <Input value={config.reportTitle} onChange={e => setConfig(c => ({ ...c, reportTitle: e.target.value }))} className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Author</Label>
              <Input value={config.author} onChange={e => setConfig(c => ({ ...c, author: e.target.value }))} placeholder="Dave Patrick" className="h-8" />
            </div>
            <div className="flex items-center gap-4 h-8">
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">CrooHQ logo</Label>
                <Switch checked={config.showCrooLogo} onCheckedChange={v => setConfig(c => ({ ...c, showCrooLogo: v }))} />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">Brand logo</Label>
                <Switch checked={config.showBrandLogo} onCheckedChange={v => setConfig(c => ({ ...c, showBrandLogo: v }))} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Scope</Label>
              <div className="flex items-center gap-2">
                <Tabs value={config.scope} onValueChange={v => setConfig(c => ({ ...c, scope: v as 'org' | 'locations' }))} className="flex-1">
                  <TabsList className="h-8 w-full grid grid-cols-2">
                    <TabsTrigger value="org" className="text-xs h-7"><Building2 className="h-3 w-3 mr-1" />Org Total</TabsTrigger>
                    <TabsTrigger value="locations" className="text-xs h-7"><MapPin className="h-3 w-3 mr-1" />Pick</TabsTrigger>
                  </TabsList>
                </Tabs>
                {config.scope === 'locations' && (
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
                )}
                <div className="flex items-center gap-1">
                  <Label className="text-xs whitespace-nowrap">Combine</Label>
                  <Switch checked={config.combineLocations} onCheckedChange={v => setConfig(c => ({ ...c, combineLocations: v }))} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ROW 2 — TIME PERIOD TOOLBAR */}
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30 flex-wrap">
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
        <div className="border-b bg-card">
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
            <div className="w-80 border-r overflow-y-auto bg-muted/20 p-3">
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
            <div className="w-[50%] border-l bg-muted/20 overflow-y-auto p-4">
              <div className="flex items-center gap-1 mb-2 text-xs text-muted-foreground"><Eye className="h-3.5 w-3.5" />Live Preview</div>
              <div className={cn('mx-auto bg-white shadow-lg', pageW)} style={{ minHeight: config.orientation === 'portrait' ? '1056px' : '816px' }}>
                <div ref={previewRef} className="p-12 text-foreground bg-white" style={{ color: '#000' }}>
                  {/* LETTERHEAD */}
                  <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-black">
                    <div>
                      <h1 className="text-2xl font-bold">{config.reportTitle}</h1>
                      <p className="text-sm text-gray-600 mt-1">{format(range.from, 'MMM d, yyyy')} – {format(range.to, 'MMM d, yyyy')}</p>
                      {config.author && <p className="text-xs text-gray-500 mt-2">Prepared by: {config.author}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      {config.showBrandLogo && <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400"><ImageIcon className="h-6 w-6" /></div>}
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
                      {config.blocks.map(b => <div key={b.id}>{renderBlock(b, mockLocationData)}</div>)}
                    </div>
                  )}
                  {config.scope === 'locations' && !config.combineLocations && targetLocations.map((loc, i) => (
                    <div key={loc.id} className={cn('space-y-4', i > 0 && 'mt-8 pt-8 border-t')}>
                      <h2 className="text-lg font-bold">{loc.name}</h2>
                      {config.blocks.map(b => <div key={b.id}>{renderBlock(b, mockLocationData)}</div>)}
                    </div>
                  ))}
                  {config.scope === 'locations' && !config.combineLocations && targetLocations.length > 1 && (
                    <div className="mt-8 pt-8 border-t-2 border-black space-y-4">
                      <h2 className="text-lg font-bold">Grand Total</h2>
                      {config.blocks.map(b => <div key={b.id}>{renderBlock(b, mockLocationData)}</div>)}
                    </div>
                  )}
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
              <div className="space-y-3">
                <div><Label>Title</Label><Input value={editingBlock.title} onChange={e => setEditingBlock({ ...editingBlock, title: e.target.value })} /></div>
                {editingBlock.type === 'text' && (
                  <div><Label>Body</Label><Textarea rows={5} value={editingBlock.options?.body || ''}
                    onChange={e => setEditingBlock({ ...editingBlock, options: { ...editingBlock.options, body: e.target.value } })} /></div>
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
