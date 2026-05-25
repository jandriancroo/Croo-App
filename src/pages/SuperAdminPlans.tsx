import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus, Pencil, Trash2, Save, Copy, Loader2, Lock, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';

interface PlanRow {
  id: string;
  catalog_id: string;
  key: string;
  display_name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  badge_label: string | null;
  badge_style: string | null;
  icon_key: string | null;
  sort_order: number;
  is_visible: boolean;
  tier_rank: number;
  feature_bullets: string[];
}

const ICON_OPTIONS = ['zap', 'rocket', 'star', 'crown', 'gem', 'sparkles'];
const BADGE_STYLES = ['', 'primary', 'founder'];

export default function SuperAdminPlans() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isSuperAdmin, loading: roleLoading } = useUserRole();

  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [grantsForEditing, setGrantsForEditing] = useState<Set<string>>(new Set());
  const [bulletsText, setBulletsText] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: catalogs = [] } = useQuery({
    queryKey: ['admin-plan-catalogs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_catalogs')
        .select('id, brand_id, organization_id, name, is_active, brands(id, name), organizations(id, name)')
        .order('brand_id', { nullsFirst: true });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['admin-plans-brands'],
    queryFn: async () => {
      const { data, error } = await supabase.from('brands').select('id, name').order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: organizations = [] } = useQuery({
    queryKey: ['admin-plans-orgs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, brand_id, brands(name)')
        .order('name');
      if (error) throw error;
      return data as any[];
    },
  });

  const activeCatalog = useMemo(() => {
    if (selectedCatalogId) return catalogs.find((c) => c.id === selectedCatalogId);
    return catalogs[0];
  }, [catalogs, selectedCatalogId]);

  const { data: plans = [], refetch: refetchPlans } = useQuery({
    queryKey: ['admin-plans', activeCatalog?.id],
    enabled: !!activeCatalog?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plans')
        .select('*')
        .eq('catalog_id', activeCatalog!.id)
        .order('sort_order');
      if (error) throw error;
      return data as PlanRow[];
    },
  });

  const { data: capabilities = [] } = useQuery({
    queryKey: ['admin-plan-capabilities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_capabilities_lookup')
        .select('*')
        .order('sort_order');
      if (error) throw error;
      return data;
    },
  });

  const { data: allGrants = [] } = useQuery({
    queryKey: ['admin-plan-grants', activeCatalog?.id],
    enabled: !!activeCatalog?.id && plans.length > 0,
    queryFn: async () => {
      const planIds = plans.map((p) => p.id);
      const { data, error } = await supabase
        .from('plan_capability_grants')
        .select('*')
        .in('plan_id', planIds);
      if (error) throw error;
      return data;
    },
  });

  const grantsByPlan = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of allGrants) {
      const arr = m.get(g.plan_id) ?? [];
      arr.push(g.capability_key);
      m.set(g.plan_id, arr);
    }
    return m;
  }, [allGrants]);

  const openEdit = (p: PlanRow | null) => {
    if (p) {
      setEditing({ ...p });
      setGrantsForEditing(new Set(grantsByPlan.get(p.id) ?? []));
      setBulletsText((p.feature_bullets ?? []).join('\n'));
    } else {
      setEditing({
        id: '',
        catalog_id: activeCatalog!.id,
        key: '',
        display_name: '',
        description: '',
        price_cents: 0,
        currency: 'usd',
        stripe_price_id: '',
        stripe_product_id: '',
        badge_label: '',
        badge_style: '',
        icon_key: 'zap',
        sort_order: (plans.at(-1)?.sort_order ?? 0) + 10,
        is_visible: true,
        tier_rank: 1,
        feature_bullets: [],
      });
      setGrantsForEditing(new Set());
      setBulletsText('');
    }
    setDialogOpen(true);
  };

  const savePlan = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload: any = {
        catalog_id: editing.catalog_id,
        key: editing.key.trim(),
        display_name: editing.display_name.trim(),
        description: editing.description || null,
        price_cents: Number(editing.price_cents) || 0,
        currency: editing.currency || 'usd',
        stripe_price_id: editing.stripe_price_id || null,
        stripe_product_id: editing.stripe_product_id || null,
        badge_label: editing.badge_label || null,
        badge_style: editing.badge_style && editing.badge_style !== 'none' ? editing.badge_style : null,
        icon_key: editing.icon_key || null,
        sort_order: Number(editing.sort_order) || 0,
        is_visible: editing.is_visible,
        tier_rank: Number(editing.tier_rank) || 0,
        feature_bullets: bulletsText.split('\n').map((s) => s.trim()).filter(Boolean),
      };

      let planId = editing.id;
      if (editing.id) {
        const { error } = await supabase.from('plans').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('plans').insert(payload).select('id').single();
        if (error) throw error;
        planId = data.id;
      }

      // Sync grants: delete then insert
      await supabase.from('plan_capability_grants').delete().eq('plan_id', planId);
      if (grantsForEditing.size > 0) {
        const rows = Array.from(grantsForEditing).map((capability_key) => ({
          plan_id: planId,
          capability_key,
        }));
        const { error } = await supabase.from('plan_capability_grants').insert(rows);
        if (error) throw error;
      }

      toast.success('Plan saved');
      setDialogOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['admin-plans'] });
      qc.invalidateQueries({ queryKey: ['admin-plan-grants'] });
      qc.invalidateQueries({ queryKey: ['plans'] });
      refetchPlans();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save plan');
    } finally {
      setSaving(false);
    }
  };

  const deletePlan = async (p: PlanRow) => {
    if (!confirm(`Delete plan "${p.display_name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('plans').delete().eq('id', p.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Plan deleted');
    qc.invalidateQueries({ queryKey: ['admin-plans'] });
    refetchPlans();
  };

  const toggleVisibility = async (p: PlanRow) => {
    const { error } = await supabase
      .from('plans')
      .update({ is_visible: !p.is_visible })
      .eq('id', p.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(p.is_visible ? `Hidden "${p.display_name}"` : `Showing "${p.display_name}"`);
    qc.invalidateQueries({ queryKey: ['admin-plans'] });
    qc.invalidateQueries({ queryKey: ['plans'] });
    refetchPlans();
  };

  const cloneFromGlobal = async (newCatalogId: string) => {
    const globalCat = catalogs.find((c) => !c.brand_id && !c.organization_id);
    if (!globalCat) return;
    const { data: srcPlans } = await supabase
      .from('plans')
      .select('*')
      .eq('catalog_id', globalCat.id);
    if (!srcPlans || srcPlans.length === 0) return;
    const { data: srcGrants } = await supabase
      .from('plan_capability_grants')
      .select('*')
      .in('plan_id', srcPlans.map((p) => p.id));
    for (const sp of srcPlans) {
      const { id: oldId, created_at, updated_at, ...rest } = sp as any;
      const { data: newPlan, error: pErr } = await supabase
        .from('plans')
        .insert({ ...rest, catalog_id: newCatalogId })
        .select('id')
        .single();
      if (pErr) throw pErr;
      const myGrants = (srcGrants ?? []).filter((g) => g.plan_id === oldId);
      if (myGrants.length > 0) {
        await supabase.from('plan_capability_grants').insert(
          myGrants.map((g) => ({ plan_id: newPlan.id, capability_key: g.capability_key }))
        );
      }
    }
  };

  const createBrandCatalog = async (brandId: string) => {
    const brand = brands.find((b) => b.id === brandId);
    if (!brand) return;
    if (catalogs.some((c) => c.brand_id === brandId && !c.organization_id)) {
      toast.error('This brand already has a catalog');
      return;
    }
    setSaving(true);
    try {
      const { data: cat, error: catErr } = await supabase
        .from('plan_catalogs')
        .insert({ brand_id: brandId, name: `${brand.name} Plans`, is_active: true })
        .select('id')
        .single();
      if (catErr) throw catErr;
      await cloneFromGlobal(cat.id);
      toast.success(`Created catalog for ${brand.name}`);
      qc.invalidateQueries({ queryKey: ['admin-plan-catalogs'] });
      setSelectedCatalogId(cat.id);
    } catch (e: any) {
      toast.error(e.message || 'Failed to create catalog');
    } finally {
      setSaving(false);
    }
  };

  const createOrgCatalog = async (orgId: string) => {
    const org = organizations.find((o) => o.id === orgId);
    if (!org) return;
    if (catalogs.some((c) => c.organization_id === orgId)) {
      toast.error('This org already has a catalog');
      return;
    }
    setSaving(true);
    try {
      const { data: cat, error: catErr } = await supabase
        .from('plan_catalogs')
        .insert({ organization_id: orgId, brand_id: null, name: `${org.name} Plans`, is_active: true })
        .select('id')
        .single();
      if (catErr) throw catErr;
      await cloneFromGlobal(cat.id);
      toast.success(`Created catalog for ${org.name}`);
      qc.invalidateQueries({ queryKey: ['admin-plan-catalogs'] });
      setSelectedCatalogId(cat.id);
    } catch (e: any) {
      toast.error(e.message || 'Failed to create catalog');
    } finally {
      setSaving(false);
    }
  };

  const deleteCatalog = async () => {
    if (!activeCatalog || (!activeCatalog.brand_id && !activeCatalog.organization_id)) return;
    const scopeLabel = activeCatalog.organization_id ? 'org' : 'brand';
    if (!confirm(`Delete catalog "${activeCatalog.name}"? This ${scopeLabel} will fall back to the ${activeCatalog.organization_id ? 'brand catalog or ' : ''}global default.`)) return;
    const { error } = await supabase.from('plan_catalogs').delete().eq('id', activeCatalog.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Catalog deleted');
    setSelectedCatalogId(null);
    qc.invalidateQueries({ queryKey: ['admin-plan-catalogs'] });
  };

  if (roleLoading) {
    return <Layout><div className="text-center py-8">Loading...</div></Layout>;
  }
  if (!isSuperAdmin) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Lock className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-4">Only super administrators can manage plans.</p>
          <Button variant="outline" onClick={() => navigate('/settings')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Settings
          </Button>
        </div>
      </Layout>
    );
  }

  const brandsWithoutCatalog = brands.filter((b) => !catalogs.some((c) => c.brand_id === b.id && !c.organization_id));
  const orgsWithoutCatalog = organizations.filter((o) => !catalogs.some((c) => c.organization_id === o.id));

  const globalCatalogs = catalogs.filter((c) => !c.brand_id && !c.organization_id);
  const brandCatalogs = catalogs.filter((c) => c.brand_id && !c.organization_id);
  const orgCatalogs = catalogs.filter((c) => c.organization_id);

  const labelFor = (c: any) => {
    if (c.organization_id) return `🏢 ${c.organizations?.name ?? 'Org'} — ${c.name}`;
    if (c.brand_id) return `${c.brands?.name ?? 'Brand'} — ${c.name}`;
    return `🌐 ${c.name}`;
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold">Plan Catalogs</h1>
            <p className="text-muted-foreground text-sm">
              Customize plans per brand or per org. Resolution: org → brand → Global Default.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Catalog</CardTitle>
            <CardDescription>Pick a catalog to edit, or create one for a brand or org.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Select
                value={activeCatalog?.id ?? ''}
                onValueChange={(v) => setSelectedCatalogId(v)}
              >
                <SelectTrigger className="sm:w-96">
                  <SelectValue placeholder="Select catalog" />
                </SelectTrigger>
                <SelectContent>
                  {globalCatalogs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{labelFor(c)}</SelectItem>
                  ))}
                  {brandCatalogs.length > 0 && (
                    <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Brand catalogs</div>
                  )}
                  {brandCatalogs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{labelFor(c)}</SelectItem>
                  ))}
                  {orgCatalogs.length > 0 && (
                    <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Org catalogs</div>
                  )}
                  {orgCatalogs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{labelFor(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(activeCatalog?.brand_id || activeCatalog?.organization_id) && (
                <Button variant="outline" onClick={deleteCatalog}>
                  <Trash2 className="h-4 w-4 mr-2" /> Delete catalog
                </Button>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t">
              {brandsWithoutCatalog.length > 0 && (
                <div className="space-y-1">
                  <Select onValueChange={(v) => createBrandCatalog(v)} disabled={saving}>
                    <SelectTrigger>
                      <SelectValue placeholder="+ New catalog for brand…" />
                    </SelectTrigger>
                    <SelectContent>
                      {brandsWithoutCatalog.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Copy className="h-3 w-3" /> Applies to all orgs in this brand
                  </p>
                </div>
              )}
              {orgsWithoutCatalog.length > 0 && (
                <div className="space-y-1">
                  <Select onValueChange={(v) => createOrgCatalog(v)} disabled={saving}>
                    <SelectTrigger>
                      <SelectValue placeholder="+ New catalog for org…" />
                    </SelectTrigger>
                    <SelectContent>
                      {orgsWithoutCatalog.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}{o.brands?.name ? ` (${o.brands.name})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Copy className="h-3 w-3" /> Overrides brand catalog for this org only
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>


        {activeCatalog && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>
                  {labelFor(activeCatalog)}
                </CardTitle>
                <CardDescription>{plans.length} plan(s)</CardDescription>
              </div>
              <Button onClick={() => openEdit(null)} size="sm">
                <Plus className="h-4 w-4 mr-2" /> Add plan
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {plans.map((p) => {
                  const grants = grantsByPlan.get(p.id) ?? [];
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-4 p-3 rounded-lg border bg-card hover:bg-accent/30 transition"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{p.display_name}</span>
                          <Badge variant="outline" className="text-xs">{p.key}</Badge>
                          {p.badge_label && <Badge className="text-xs">{p.badge_label}</Badge>}
                          {!p.is_visible && <Badge variant="secondary" className="text-xs">Hidden</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          ${(p.price_cents / 100).toFixed(0)}/mo · tier {p.tier_rank} · sort {p.sort_order} ·{' '}
                          {grants.length} capabilities
                        </div>
                        {!p.stripe_price_id && (
                          <div className="text-xs text-destructive mt-1">⚠ No Stripe price ID set</div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleVisibility(p)}
                        title={p.is_visible ? 'Hide from billing page' : 'Show on billing page'}
                      >
                        {p.is_visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deletePlan(p)} title="Delete (permanent)">
                        <Trash2 className="h-4 w-4 text-destructive/70" />
                      </Button>
                    </div>
                  );
                })}
                {plans.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No plans yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit plan' : 'New plan'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Key (internal)</Label>
                  <Input
                    value={editing.key}
                    onChange={(e) => setEditing({ ...editing, key: e.target.value })}
                    placeholder="e.g. pro"
                  />
                </div>
                <div>
                  <Label>Display name</Label>
                  <Input
                    value={editing.display_name}
                    onChange={(e) => setEditing({ ...editing, display_name: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>Description</Label>
                <Input
                  value={editing.description ?? ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Price (cents)</Label>
                  <Input
                    type="number"
                    value={editing.price_cents}
                    onChange={(e) => setEditing({ ...editing, price_cents: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Sort order</Label>
                  <Input
                    type="number"
                    value={editing.sort_order}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Tier rank</Label>
                  <Input
                    type="number"
                    value={editing.tier_rank}
                    onChange={(e) => setEditing({ ...editing, tier_rank: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Stripe price ID</Label>
                  <Input
                    value={editing.stripe_price_id ?? ''}
                    onChange={(e) => setEditing({ ...editing, stripe_price_id: e.target.value })}
                    placeholder="price_..."
                  />
                </div>
                <div>
                  <Label>Stripe product ID</Label>
                  <Input
                    value={editing.stripe_product_id ?? ''}
                    onChange={(e) => setEditing({ ...editing, stripe_product_id: e.target.value })}
                    placeholder="prod_..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Badge label</Label>
                  <Input
                    value={editing.badge_label ?? ''}
                    onChange={(e) => setEditing({ ...editing, badge_label: e.target.value })}
                    placeholder="e.g. Most Popular"
                  />
                </div>
                <div>
                  <Label>Badge style</Label>
                  <Select
                    value={editing.badge_style ?? ''}
                    onValueChange={(v) => setEditing({ ...editing, badge_style: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      {BADGE_STYLES.map((s) => (
                        <SelectItem key={s || 'none'} value={s || 'none'}>
                          {s || 'none'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Icon</Label>
                  <Select
                    value={editing.icon_key ?? ''}
                    onValueChange={(v) => setEditing({ ...editing, icon_key: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ICON_OPTIONS.map((i) => (
                        <SelectItem key={i} value={i}>{i}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  checked={editing.is_visible}
                  onCheckedChange={(v) => setEditing({ ...editing, is_visible: v })}
                />
                <Label>Visible on billing page</Label>
              </div>

              <div>
                <Label>Feature bullets (one per line)</Label>
                <Textarea
                  rows={6}
                  value={bulletsText}
                  onChange={(e) => setBulletsText(e.target.value)}
                  placeholder={'Everything in Core\nInventory management\nAdvanced reporting'}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Empty lines are ignored on save. Spaces and punctuation are preserved.
                </p>
              </div>

              <div>
                <Label className="mb-2 block">Capabilities granted</Label>
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-3 border rounded-md">
                  {capabilities.map((cap) => (
                    <label key={cap.key} className="flex items-start gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={grantsForEditing.has(cap.key)}
                        onCheckedChange={(checked) => {
                          const next = new Set(grantsForEditing);
                          if (checked) next.add(cap.key);
                          else next.delete(cap.key);
                          setGrantsForEditing(next);
                        }}
                      />
                      <span>
                        <span className="font-medium">{cap.label}</span>
                        <span className="text-muted-foreground"> · {cap.key}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={savePlan} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
