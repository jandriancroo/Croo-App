import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Camera, Upload, Loader2, CheckCircle2, AlertCircle, Package, Save } from "lucide-react";

interface InvoiceUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  countId?: string;
}

interface ParseResult {
  invoice_id: string;
  vendor_name: string;
  invoice_date: string | null;
  delivery_date: string | null;
  total_amount: number | null;
  total_items: number;
  matched: number;
  unmatched: number;
  new_gap_alerts: number;
  price_updates: number;
}

interface PreviewLine {
  id: string;
  product_name: string;
  item_number: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_price: number | null;
  match_status: string;
}

export default function InvoiceUploadDialog({
  open, onOpenChange, locationId, countId,
}: InvoiceUploadDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<PreviewLine[]>([]);

  // Editable fields for preview
  const [vendorName, setVendorName] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [totalAmount, setTotalAmount] = useState<string>("");

  // Sync editable fields when a new parse result arrives + load lines
  useEffect(() => {
    if (!result) return;
    setVendorName(result.vendor_name || "");
    setInvoiceDate(result.invoice_date || "");
    setDeliveryDate(result.delivery_date || "");
    setTotalAmount(result.total_amount != null ? String(result.total_amount) : "");

    (async () => {
      const { data } = await supabase
        .from("vendor_invoice_items")
        .select("id, product_name, item_number, quantity, unit_price, total_price, match_status")
        .eq("invoice_id", result.invoice_id)
        .order("created_at", { ascending: true });
      setLines((data as any) || []);
    })();
  }, [result]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/png", "image/heic", "image/webp", "application/pdf"];
    if (!validTypes.includes(file.type)) {
      toast.error("Please upload a photo (JPG/PNG) or PDF");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large (max 20MB)");
      return;
    }

    setResult(null);
    setError(null);
    setUploading(true);

    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${locationId}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("vendor-invoices")
        .upload(path, file);
      if (uploadErr) throw uploadErr;

      setUploading(false);
      setParsing(true);

      // Edge function creates the vendor_invoices row (service role — avoids stale-JWT RLS issues)
      const { data: parseData, error: parseErr } = await supabase.functions.invoke(
        "parse-vendor-invoice",
        {
          body: {
            storagePath: path,
            locationId,
            countId: countId || null,
          },
        }
      );

      if (parseErr) throw new Error(parseErr.message || "Parsing failed");
      if (parseData?.error) throw new Error(parseData.error);

      setResult(parseData as ParseResult);
      toast.success(`Parsed ${parseData.total_items} items — review below`);

      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      queryClient.invalidateQueries({ queryKey: ["brand-inventory-templates"] });
      queryClient.invalidateQueries({ queryKey: ["period-cogs"] });
    } catch (err: any) {
      console.error("Invoice upload error:", err);
      setError(err.message || "Upload failed");
      toast.error("Failed to process invoice");
    } finally {
      setUploading(false);
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!result) return;
    if (!vendorName.trim()) {
      toast.error("Vendor name is required");
      return;
    }
    if (!invoiceDate) {
      toast.error("Invoice date is required for COGS reporting");
      return;
    }

    setSaving(true);
    try {
      const parsedTotal = totalAmount ? Number(totalAmount) : null;
      const { error: updErr } = await supabase
        .from("vendor_invoices")
        .update({
          vendor_name: vendorName.trim(),
          invoice_date: invoiceDate,
          delivery_date: deliveryDate || invoiceDate,
          total_amount: parsedTotal,
        } as any)
        .eq("id", result.invoice_id);
      if (updErr) throw updErr;

      toast.success("Invoice saved");
      queryClient.invalidateQueries({ queryKey: ["period-cogs"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      handleClose();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setError(null);
    setLines([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Upload Vendor Invoice
          </DialogTitle>
          <DialogDescription>
            Snap a photo or upload a PDF. AI extracts line items — you review and confirm before it hits COGS.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="hidden"
          onChange={handleFileSelect}
        />

        {!result && !error && (
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full h-20 border-dashed flex-col gap-2"
              disabled={uploading || parsing}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Uploading...</span>
                </>
              ) : parsing ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs text-primary font-medium">AI is reading the invoice...</span>
                </>
              ) : (
                <>
                  <Camera className="h-6 w-6 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Tap to take photo or choose file</span>
                </>
              )}
            </Button>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Parsed — review and confirm
            </div>

            {/* Editable metadata */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label htmlFor="vendor" className="text-xs">Vendor (seller)</Label>
                <Input
                  id="vendor"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="e.g. Reyes Beverage"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="inv-date" className="text-xs">Invoice date *</Label>
                <Input
                  id="inv-date"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="del-date" className="text-xs">Delivery date</Label>
                <Input
                  id="del-date"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="total" className="text-xs">Total amount</Label>
                <Input
                  id="total"
                  type="number"
                  step="0.01"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                />
              </div>
            </div>

            {/* Match stats */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-muted/50 rounded-lg p-2 text-center">
                <p className="text-base font-bold">{result.total_items}</p>
                <p className="text-muted-foreground">Lines</p>
              </div>
              <div className="bg-emerald-500/10 rounded-lg p-2 text-center">
                <p className="text-base font-bold text-emerald-600">{result.matched}</p>
                <p className="text-muted-foreground">Matched</p>
              </div>
              <div className="bg-amber-500/10 rounded-lg p-2 text-center">
                <p className="text-base font-bold text-amber-600">{result.unmatched}</p>
                <p className="text-muted-foreground">Unmatched</p>
              </div>
            </div>

            {/* Line items preview */}
            {lines.length > 0 && (
              <div className="border rounded-lg divide-y max-h-56 overflow-y-auto text-xs">
                {lines.map((l) => (
                  <div key={l.id} className="p-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{l.product_name}</p>
                      <p className="text-muted-foreground">
                        {l.item_number || "—"} · qty {l.quantity ?? "?"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono">${(l.total_price ?? 0).toFixed(2)}</p>
                      <p className={`text-[10px] ${l.match_status === "matched" ? "text-emerald-600" : "text-amber-600"}`}>
                        {l.match_status}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result.new_gap_alerts > 0 && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 text-xs">
                <Package className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="text-amber-700 dark:text-amber-400">
                  {result.new_gap_alerts} new item{result.new_gap_alerts > 1 ? "s" : ""} sent to Vendor Gap Finder
                </span>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={saving}
                onClick={() => {
                  setResult(null);
                  setLines([]);
                  setError(null);
                }}
              >
                Re-upload
              </Button>
              <Button size="sm" className="flex-1" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" /> Save</>}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-sm">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-destructive">{error}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setError(null);
                setResult(null);
              }}
            >
              Try Again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
