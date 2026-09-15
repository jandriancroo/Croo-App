import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Store, Link2, PackagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Vendor names read off invoice photos that do not exactly match a known vendor.
 * Nothing is ever auto-linked or auto-created — even a high-confidence fuzzy
 * match waits here for a human tap.
 */

interface Candidate {
  id: string;
  raw_name: string;
  normalized_name: string;
  suggested_vendor_id: string | null;
  similarity_score: number | null;
  created_at: string;
  location_id: string | null;
}

interface RegistryVendor {
  id: string;
  key: string;
  display_name: string;
  category: string | null;
}

export default function PendingVendorsCard() {
  const queryClient = useQueryClient();
  const [createFor, setCreateFor] = useState<Candidate | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const { data: candidates = [] } = useQuery({
    queryKey: ['vendor-name-candidates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_name_candidates' as any)
        .select('id, raw_name, normalized_name, suggested_vendor_id, similarity_score, created_at, location_id')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as any as Candidate[]) || [];
    },
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendor-registry'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_registry' as any)
        .select('id, key, display_name, category')
        .order('display_name');
      if (error) throw error;
      return (data as any as RegistryVendor[]) || [];
    },
  });

  const vendorById = new Map(vendors.map(v => [v.id, v]));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['vendor-name-candidates'] });
    queryClient.invalidateQueries({ queryKey: ['vendor-registry'] });
  };

  // Link the invoice spelling to an existing registry vendor and remember it.
  const linkVendor = useMutation({
    mutationFn: async ({ candidate, vendorId }: { candidate: Candidate; vendorId: string }) => {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes?.user?.id ?? null;

      const { error: aliasErr } = await supabase
        .from('vendor_registry_aliases' as any)
        .insert({
          vendor_id: vendorId,
          normalized_alias: candidate.normalized_name,
          raw_alias: candidate.raw_name,
          created_by: userId,
        } as any);
      // A duplicate alias is harmless — it means someone already confirmed it.
      if (aliasErr && !aliasErr.message?.includes('duplicate')) throw aliasErr;

      const { error } = await supabase
        .from('vendor_name_candidates' as any)
        .update({
          status: 'approved',
          resolved_vendor_id: vendorId,
          resolved_by: userId,
          resolved_at: new Date().toISOString(),
        } as any)
        .eq('id', candidate.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Vendor confirmed'); invalidate(); },
    onError: (e: any) => toast.error(e?.message || 'Could not confirm vendor'),
  });

  // Create a clean new registry vendor from this invoice spelling.
  const createVendor = useMutation({
    mutationFn: async () => {
      if (!createFor) throw new Error('No vendor selected');
      const key = newKey.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      if (!key) throw new Error('Short name is required');
      if (!newDisplay.trim()) throw new Error('Vendor name is required');

      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes?.user?.id ?? null;

      const { data: created, error: createErr } = await supabase
        .from('vendor_registry' as any)
        .insert({
          key,
          display_name: newDisplay.trim(),
          category: newCategory.trim() || null,
          is_integrated: false,
          sync_methods: [],
        } as any)
        .select('id')
        .single();
      if (createErr) throw createErr;

      const vendorId = (created as any).id as string;

      await supabase.from('vendor_registry_aliases' as any).insert({
        vendor_id: vendorId,
        normalized_alias: createFor.normalized_name,
        raw_alias: createFor.raw_name,
        created_by: userId,
      } as any);

      const { error } = await supabase
        .from('vendor_name_candidates' as any)
        .update({
          status: 'approved',
          resolved_vendor_id: vendorId,
          resolved_by: userId,
          resolved_at: new Date().toISOString(),
        } as any)
        .eq('id', createFor.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Vendor added');
      setCreateFor(null);
      setNewKey(''); setNewDisplay(''); setNewCategory('');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || 'Could not add vendor'),
  });

  const dismiss = useMutation({
    mutationFn: async (candidate: Candidate) => {
      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('vendor_name_candidates' as any)
        .update({
          status: 'rejected',
          resolved_by: userRes?.user?.id ?? null,
          resolved_at: new Date().toISOString(),
        } as any)
        .eq('id', candidate.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Dismissed'); invalidate(); },
    onError: (e: any) => toast.error(e?.message || 'Could not dismiss'),
  });

  if (candidates.length === 0) return null;

  return (
    <>
      <Card className="border-sky-500/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Store className="h-4 w-4 text-sky-600" />
            Vendors to confirm
            <Badge variant="secondary" className="ml-auto">{candidates.length}</Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Names read off invoices that don't exactly match a vendor you already have.
            Nothing is linked until you tap.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {candidates.map((c) => {
            const suggestion = c.suggested_vendor_id ? vendorById.get(c.suggested_vendor_id) : null;
            const score = c.similarity_score != null ? Math.round(Number(c.similarity_score) * 100) : null;
            return (
              <div key={c.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.raw_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      as printed on the invoice
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => dismiss.mutate(c)}
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {suggestion && (
                  <p className="text-xs text-muted-foreground">
                    Closest match:{' '}
                    <span className="font-medium text-foreground">{suggestion.display_name}</span>
                    {score != null && <span className="ml-1">({score}% similar)</span>}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {suggestion && (
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={linkVendor.isPending}
                      onClick={() => linkVendor.mutate({ candidate: c, vendorId: suggestion.id })}
                    >
                      {linkVendor.isPending
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Link2 className="h-3.5 w-3.5 mr-1" />}
                      Link to {suggestion.display_name}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => {
                      setCreateFor(c);
                      setNewDisplay(c.raw_name);
                      setNewKey(c.normalized_name);
                      setNewCategory('');
                    }}
                  >
                    <PackagePlus className="h-3.5 w-3.5 mr-1" />
                    New vendor
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!createFor} onOpenChange={(o) => !o && setCreateFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add vendor</DialogTitle>
            <DialogDescription>
              Creates a clean vendor record and remembers this invoice spelling for next time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="v-display" className="text-xs">Vendor name</Label>
              <Input id="v-display" value={newDisplay} onChange={(e) => setNewDisplay(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-key" className="text-xs">Short name (no spaces)</Label>
              <Input id="v-key" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-cat" className="text-xs">Category (optional)</Label>
              <Input
                id="v-cat"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="e.g. beer & wine"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFor(null)}>Cancel</Button>
            <Button onClick={() => createVendor.mutate()} disabled={createVendor.isPending}>
              {createVendor.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add vendor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
