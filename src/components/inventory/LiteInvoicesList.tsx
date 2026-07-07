import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FileText, Upload, Loader2, ExternalLink, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import LiteInvoiceUploadDialog from "./LiteInvoiceUploadDialog";
import PackSizeInlineEdit from "./PackSizeInlineEdit";

interface Props {
  locationId: string;
}

interface LiteInvoice {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  delivery_date: string | null;
  total_amount: number | null;
  status: string;
  storage_path: string | null;
  parsed_at: string | null;
  created_at: string;
}

interface LiteInvoiceLine {
  id: string;
  product_name: string;
  item_number: string | null;
  pack_size: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_price: number | null;
  match_status: string;
  matched_item_id: string | null;
  candidate_item_id: string | null;
  fuzzy_score: number | null;
}

interface CandidateItem {
  id: string;
  name: string;
  pack_size: string | null;
  vendor_name_normalized: string | null;
  item_number: string | null;
}

/**
 * Lite Invoices tab — read-only ledger of every invoice uploaded for this
 * location. Tap a row to see the parsed line items and open the original PDF.
 * Purely a viewer; edits happen via re-uploading.
 */
export default function LiteInvoicesList({ locationId }: Props) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["lite-invoices", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<LiteInvoice[]> => {
      const { data, error } = await supabase
        .from("lite_vendor_invoices" as any)
        .select(
          "id, vendor_name, invoice_number, invoice_date, delivery_date, total_amount, status, storage_path, parsed_at, created_at"
        )
        .eq("location_id", locationId)
        .order("invoice_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const { data: lineCounts } = useQuery({
    queryKey: ["lite-invoice-line-counts", locationId, invoices?.length],
    enabled: !!invoices && invoices.length > 0,
    queryFn: async (): Promise<Map<string, { total: number; fuzzy: number }>> => {
      const ids = (invoices || []).map((i) => i.id);
      if (ids.length === 0) return new Map();
      const { data } = await supabase
        .from("lite_vendor_invoice_items" as any)
        .select("invoice_id, match_status")
        .in("invoice_id", ids);
      const counts = new Map<string, { total: number; fuzzy: number }>();
      (data as any[] | null)?.forEach((r) => {
        const c = counts.get(r.invoice_id) || { total: 0, fuzzy: 0 };
        c.total += 1;
        if (r.match_status === "fuzzy") c.fuzzy += 1;
        counts.set(r.invoice_id, c);
      });
      return counts;
    },
  });

  const openInvoice = useMemo(
    () => invoices?.find((i) => i.id === openInvoiceId) || null,
    [invoices, openInvoiceId]
  );

  const fmtMoney = (n: number | null) =>
    n == null ? "—" : `$${Number(n).toFixed(2)}`;

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">
              Invoices ({invoices?.length ?? 0})
            </h3>
          </div>
          <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" />
            Upload Invoice
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (invoices?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
            <FileText className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground max-w-sm">
              No invoices uploaded yet. Every invoice you upload is stored here
              so you can look up prices, pack sizes, and totals later.
            </p>
            <Button onClick={() => setUploadOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              Upload Invoice
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {invoices!.map((inv) => (
              <button
                key={inv.id}
                onClick={() => setOpenInvoiceId(inv.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">
                      {inv.vendor_name || "Unknown vendor"}
                    </span>
                    {inv.status !== "parsed" && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                        {inv.status}
                      </Badge>
                    )}
                    {(lineCounts?.get(inv.id)?.fuzzy ?? 0) > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] h-4 px-1.5 border-amber-500/50 text-amber-600 bg-amber-500/10"
                      >
                        {lineCounts!.get(inv.id)!.fuzzy} to review
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {inv.invoice_date || "no date"}
                    {inv.invoice_number ? ` • #${inv.invoice_number}` : ""}
                    {lineCounts?.get(inv.id)?.total
                      ? ` • ${lineCounts.get(inv.id)!.total} lines`
                      : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold tabular-nums">
                    {fmtMoney(inv.total_amount)}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </Card>

      <LiteInvoiceUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        locationId={locationId}
      />

      <InvoiceDetailSheet
        invoice={openInvoice}
        onClose={() => setOpenInvoiceId(null)}
      />
    </>
  );
}

function InvoiceDetailSheet({
  invoice,
  onClose,
}: {
  invoice: LiteInvoice | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: lines, isLoading } = useQuery({
    queryKey: ["lite-invoice-lines", invoice?.id],
    enabled: !!invoice,
    queryFn: async (): Promise<LiteInvoiceLine[]> => {
      const { data, error } = await supabase
        .from("lite_vendor_invoice_items" as any)
        .select(
          "id, product_name, item_number, pack_size, quantity, unit, unit_price, total_price, match_status, matched_item_id, candidate_item_id"
        )
        .eq("invoice_id", invoice!.id)
        .order("product_name");
      if (error) throw error;
      return (data as any) || [];
    },
  });

  /**
   * Save pack_size on an invoice line. If the line is matched (or has a
   * candidate) to a lite_inventory_items row that is currently empty, backfill
   * that item's pack_size too — same forward-flow behavior as the parser's
   * initial match. Existing item pack_sizes are NEVER overwritten from here
   * (Items list edit is the tool for correcting a stale current value).
   */
  const savePackSize = async (line: LiteInvoiceLine, next: string | null) => {
    const { error } = await supabase
      .from("lite_vendor_invoice_items" as any)
      .update({ pack_size: next })
      .eq("id", line.id);
    if (error) {
      toast.error("Couldn't save pack size", { description: error.message });
      throw error;
    }

    const itemId = line.matched_item_id || line.candidate_item_id;
    if (itemId && next) {
      const { data: item } = await supabase
        .from("lite_inventory_items" as any)
        .select("id, pack_size")
        .eq("id", itemId)
        .maybeSingle();
      if (item && !(item as any).pack_size) {
        await supabase
          .from("lite_inventory_items" as any)
          .update({ pack_size: next })
          .eq("id", itemId);
        qc.invalidateQueries({ queryKey: ["lite-inventory-items"] });
      }
    }

    qc.setQueryData<LiteInvoiceLine[]>(
      ["lite-invoice-lines", invoice!.id],
      (prev) => prev?.map((l) => (l.id === line.id ? { ...l, pack_size: next } : l)) || prev,
    );
    toast.success(next ? "Pack size saved" : "Pack size cleared");
  };


  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const openPdf = async () => {
    if (!invoice?.storage_path) return;
    const { data } = await supabase.storage
      .from("vendor-invoices")
      .createSignedUrl(invoice.storage_path, 600);
    if (data?.signedUrl) {
      setSignedUrl(data.signedUrl);
      window.open(data.signedUrl, "_blank");
    }
  };

  const fmtMoney = (n: number | null) =>
    n == null ? "—" : `$${Number(n).toFixed(2)}`;

  return (
    <Sheet open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">
            {invoice?.vendor_name || "Invoice"}
          </SheetTitle>
        </SheetHeader>

        {invoice && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[11px] text-muted-foreground">Invoice #</div>
                <div className="font-medium">{invoice.invoice_number || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Total</div>
                <div className="font-semibold tabular-nums">
                  {fmtMoney(invoice.total_amount)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Invoice date</div>
                <div className="font-medium">{invoice.invoice_date || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Delivered</div>
                <div className="font-medium">{invoice.delivery_date || "—"}</div>
              </div>
            </div>

            {invoice.storage_path && (
              <Button
                variant="outline"
                size="sm"
                onClick={openPdf}
                className="gap-2 w-full"
              >
                <ExternalLink className="h-4 w-4" />
                Open original PDF
              </Button>
            )}

            <div className="border-t border-border/50 pt-3">
              <div className="text-xs font-semibold text-muted-foreground mb-2">
                Line items {lines ? `(${lines.length})` : ""}
              </div>
              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {lines?.map((ln) => (
                    <div key={ln.id} className="py-2">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">
                              {ln.product_name}
                            </span>
                            <PackSizeInlineEdit
                              value={ln.pack_size}
                              onSave={(next) => savePackSize(ln, next)}
                            />
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {ln.item_number ? `#${ln.item_number} • ` : ""}
                            {ln.quantity ?? "?"} {ln.unit || ""} @{" "}
                            {fmtMoney(ln.unit_price)}
                          </div>
                        </div>
                        <div className="text-sm font-semibold tabular-nums shrink-0">
                          {fmtMoney(ln.total_price)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
