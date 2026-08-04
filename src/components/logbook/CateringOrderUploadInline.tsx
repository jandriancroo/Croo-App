import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/utils/imageCompression";
import { format, parseISO } from "date-fns";

interface CateringOrderUploadInlineProps {
  onDone: () => void;
  currentLocationId: string;
  currentLocationName: string;
  userId: string;
  timezone: string;
  toast: (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => void;
}

export function CateringOrderUploadInline({
  onDone,
  currentLocationId,
  currentLocationName,
  userId,
  timezone,
  toast,
}: CateringOrderUploadInlineProps) {
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      let fileToUpload = file;
      if (file.type.startsWith("image/")) {
        fileToUpload = await compressImage(file, 1200, 1200, 0.85);
      }

      const fileExt = file.name.split(".").pop();
      const filePath = `catering-orders/${currentLocationId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("checklist-images")
        .upload(filePath, fileToUpload);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("checklist-images")
        .getPublicUrl(filePath);

      toast({ title: "Parsing order with AI..." });

      const { data: parseResult, error: parseError } = await supabase.functions.invoke(
        "ai-extraction-service?action=parse-catering-order",
        { body: { imageUrl: urlData.publicUrl, timezone } }
      );
      if (parseError) throw parseError;
      if (!parseResult?.success) throw new Error(parseResult?.error || "Failed to parse");

      const orderData = parseResult.data;

      const { error: insertError } = await supabase.from("catering_orders").insert({
        location_id: currentLocationId,
        order_number: orderData.order_number || null,
        customer_name: orderData.customer_name,
        pickup_date: orderData.pickup_date,
        pickup_time: orderData.pickup_time,
        headcount: orderData.headcount || null,
        items: orderData.items,
        notes: orderData.notes || null,
        source_url: urlData.publicUrl,
        created_by: userId,
        contact_phone: orderData.contact_phone || null,
        total_price: orderData.total_price || null,
      });
      if (insertError) throw insertError;

      try {
        await supabase.functions.invoke("send-push-notification", {
          body: {
            notification_type: "catering_order",
            title: `New Catering Order - ${currentLocationName}`,
            body: `${orderData.customer_name} - ${format(parseISO(orderData.pickup_date), "MMM d")} at ${orderData.pickup_time}`,
            location_id: currentLocationId,
            roles: ["admin", "manager", "shift_manager", "shift_manager_in_training"],
          },
        });
      } catch (err) {
        console.error("Push notification failed:", err);
      }

      toast({ title: "Catering order added!" });
      onDone();
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Failed to process order",
        description: err?.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Catering Order</h2>
      <p className="text-sm text-muted-foreground">
        Upload a PDF or screenshot of the catering order. AI will automatically extract
        customer, pickup time, items, and total.
      </p>
      <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-8 cursor-pointer hover:border-primary/60 transition-colors">
        <Upload className="h-6 w-6 text-muted-foreground" />
        <span className="text-sm font-medium">Tap to upload</span>
        <span className="text-xs text-muted-foreground">Image or PDF</span>
        <Input
          type="file"
          accept="image/*,.pdf"
          onChange={handleFileUpload}
          disabled={uploading}
          className="hidden"
        />
      </label>
      {uploading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Processing order...
        </div>
      )}
    </div>
  );
}
