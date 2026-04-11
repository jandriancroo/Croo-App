import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Camera, Upload, Loader2, CheckCircle2, AlertCircle, Package } from "lucide-react";

interface InvoiceUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  countId?: string;
}

interface ParseResult {
  vendor_name: string;
  total_items: number;
  matched: number;
  unmatched: number;
  new_gap_alerts: number;
  price_updates: number;
}

export default function InvoiceUploadDialog({
  open, onOpenChange, locationId, countId,
}: InvoiceUploadDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
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
      // Upload to storage
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${locationId}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("vendor-invoices")
        .upload(path, file);
      if (uploadErr) throw uploadErr;

      // Create invoice record
      const { data: invoice, error: insertErr } = await supabase
        .from("vendor_invoices")
        .insert({
          location_id: locationId,
          vendor_name: "Unknown",
          image_url: `vendor-invoices/${path}`,
          uploaded_by: user?.id,
          inventory_count_id: countId || null,
          status: "pending",
        } as any)
        .select()
        .single();
      if (insertErr) throw insertErr;

      setUploading(false);
      setParsing(true);

      // Call AI parsing edge function
      const { data: parseData, error: parseErr } = await supabase.functions.invoke(
        "parse-vendor-invoice",
        { body: { invoiceId: (invoice as any).id } }
      );

      if (parseErr) throw new Error(parseErr.message || "Parsing failed");
      if (parseData?.error) throw new Error(parseData.error);

      setResult(parseData as ParseResult);
      toast.success(`Parsed ${parseData.total_items} items from ${parseData.vendor_name}`);
      
      // Invalidate relevant queries
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
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleClose = () => {
    setResult(null);
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Upload Vendor Invoice
          </DialogTitle>
          <DialogDescription>
            Snap a photo or upload a PDF of a vendor invoice. AI will extract line items and update pricing.
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
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Parsed: {result.vendor_name}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold">{result.total_items}</p>
                <p className="text-muted-foreground">Line Items</p>
              </div>
              <div className="bg-emerald-500/10 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-emerald-600">{result.matched}</p>
                <p className="text-muted-foreground">Matched</p>
              </div>
              {result.price_updates > 0 && (
                <div className="bg-primary/10 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-primary">{result.price_updates}</p>
                  <p className="text-muted-foreground">Prices Updated</p>
                </div>
              )}
              {result.unmatched > 0 && (
                <div className="bg-amber-500/10 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-amber-600">{result.unmatched}</p>
                  <p className="text-muted-foreground">Unmatched</p>
                </div>
              )}
            </div>
            {result.new_gap_alerts > 0 && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 text-xs">
                <Package className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="text-amber-700 dark:text-amber-400">
                  {result.new_gap_alerts} new item{result.new_gap_alerts > 1 ? "s" : ""} sent to Vendor Gap Finder for brand review
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
              >
                Upload Another
              </Button>
              <Button size="sm" className="flex-1" onClick={handleClose}>
                Done
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
