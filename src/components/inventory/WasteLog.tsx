import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Camera, Plus, Trash2, AlertTriangle, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface WasteLogProps {
  locationId: string;
}

const WasteLog = ({ locationId }: WasteLogProps) => {
  const { user } = useAuth();
  const { isManager } = useUserRole();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch active inventory items for this location
  const { data: items } = useQuery({
    queryKey: ["inventory-items-active", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, unit, cost_per_unit")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch waste logs
  const { data: wasteLogs, isLoading } = useQuery({
    queryKey: ["waste-logs", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_waste_logs")
        .select(`
          *,
          inventory_items!inventory_waste_logs_item_id_fkey(name, unit),
          profiles!inventory_waste_logs_logged_by_fkey(full_name)
        `)
        .eq("location_id", locationId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (logId: string) => {
      const { error } = await supabase
        .from("inventory_waste_logs")
        .delete()
        .eq("id", logId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waste-logs", locationId] });
      toast.success("Waste log deleted");
    },
    onError: () => toast.error("Failed to delete"),
  });

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const resetForm = () => {
    setSelectedItemId("");
    setQuantity("");
    setReason("");
    setPhotoFile(null);
    setPhotoPreview(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!selectedItemId || !quantity || !reason) {
      toast.error("Item, quantity, and reason are required");
      return;
    }
    if (!photoFile) {
      toast.error("A photo of the waste is required");
      return;
    }

    setIsSubmitting(true);
    try {
      // Upload photo
      const ext = photoFile.name.split(".").pop() || "jpg";
      const filePath = `${locationId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("waste-photos")
        .upload(filePath, photoFile);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("waste-photos")
        .getPublicUrl(filePath);

      // Get item info for cost calculation
      const item = items?.find((i) => i.id === selectedItemId);
      const estimatedCost = item?.cost_per_unit
        ? Number(quantity) * Number(item.cost_per_unit)
        : null;

      // Insert waste log
      const { error: insertError } = await supabase
        .from("inventory_waste_logs")
        .insert({
          location_id: locationId,
          item_id: selectedItemId,
          quantity: Number(quantity),
          unit: item?.unit || "units",
          reason,
          photo_url: urlData.publicUrl,
          estimated_cost: estimatedCost,
          logged_by: user?.id,
        });
      if (insertError) throw insertError;

      // Send push notification to managers
      try {
        await supabase.functions.invoke("send-push-notification", {
          body: {
            notification_type: "waste_log",
            title: `Waste Logged`,
            body: `${item?.name || "Item"} — ${quantity} ${item?.unit || "units"} wasted. Reason: ${reason.slice(0, 60)}`,
            location_id: locationId,
            roles: ["admin", "manager", "super_admin", "brand_admin", "org_admin"],
          },
        });
      } catch (e) {
        console.error("[WasteLog] Push notification failed:", e);
      }

      // Send email notification to managers at location
      try {
        // Get manager+ emails at this location
        const { data: locationName } = await supabase
          .from("locations")
          .select("name")
          .eq("id", locationId)
          .single();

        const { data: loggerProfile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user?.id)
          .single();

        // Get manager+ users at this location
        const { data: locationMembers } = await supabase
          .from("user_locations")
          .select("user_id")
          .eq("location_id", locationId);

        if (locationMembers && locationMembers.length > 0) {
          const memberIds = locationMembers.map((m) => m.user_id);
          const { data: managerRoles } = await supabase
            .from("user_roles")
            .select("user_id")
            .in("user_id", memberIds)
            .in("role", ["manager", "admin", "org_admin", "brand_admin", "super_admin"]);

          if (managerRoles && managerRoles.length > 0) {
            const managerUserIds = managerRoles.map((r) => r.user_id);
            const { data: managerProfiles } = await supabase
              .from("profiles")
              .select("email")
              .in("id", managerUserIds)
              .not("email", "is", null);

            const managerEmails = managerProfiles
              ?.map((p) => p.email)
              .filter(Boolean) as string[];

            if (managerEmails.length > 0) {
              await supabase.functions.invoke("send-notification-email", {
                body: {
                  type: "waste_log",
                  to: managerEmails,
                  data: {
                    item_name: item?.name || "Unknown",
                    quantity: `${quantity} ${item?.unit || "units"}`,
                    reason,
                    estimated_cost: estimatedCost
                      ? `$${estimatedCost.toFixed(2)}`
                      : "N/A",
                    photo_url: urlData.publicUrl,
                    logged_by: loggerProfile?.full_name || "Team Member",
                    location_name: locationName?.name || "Location",
                    date: format(new Date(), "MMM d, yyyy h:mm a"),
                  },
                },
              });
            }
          }
        }
      } catch (e) {
        console.error("[WasteLog] Email notification failed:", e);
      }

      queryClient.invalidateQueries({ queryKey: ["waste-logs", locationId] });
      toast.success("Waste logged successfully");
      resetForm();
    } catch (err) {
      console.error("[WasteLog] Submit failed:", err);
      toast.error("Failed to log waste");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Waste Log</h2>
          <p className="text-sm text-muted-foreground">Track spoilage, drops, and waste</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Log Waste
        </Button>
      </div>

      {/* Waste log entries */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : !wasteLogs?.length ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No waste logged yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {wasteLogs.map((log: any) => (
            <Card key={log.id} className="overflow-hidden">
              <CardContent className="p-3">
                <div className="flex gap-3">
                  {log.photo_url && (
                    <img
                      src={log.photo_url}
                      alt="Waste photo"
                      className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm truncate">
                          {(log as any).inventory_items?.name || "Item"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {log.quantity} {log.unit}
                          {log.estimated_cost != null && (
                            <span className="ml-1 text-destructive font-medium">
                              (~${Number(log.estimated_cost).toFixed(2)})
                            </span>
                          )}
                        </p>
                      </div>
                      {isManager && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          onClick={() => deleteMutation.mutate(log.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <p className="text-xs mt-1 line-clamp-2">{log.reason}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                      <span>{(log as any).profiles?.full_name || "Unknown"}</span>
                      <span>·</span>
                      <span>{format(new Date(log.created_at), "MMM d, h:mm a")}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* New waste log form sheet */}
      <Sheet open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <SheetContent side="bottom" className="max-h-[85vh] rounded-t-2xl pb-safe overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Log Waste</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 pt-4">
            {/* Item selector */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Item</label>
              <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select item..." />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {items?.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({item.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Quantity */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Quantity{" "}
                {selectedItemId && items?.find((i) => i.id === selectedItemId) && (
                  <span className="text-muted-foreground font-normal">
                    ({items.find((i) => i.id === selectedItemId)?.unit})
                  </span>
                )}
              </label>
              <Input
                type="number"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                min="0"
                step="any"
              />
            </div>

            {/* Reason */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Why did this happen? <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Dropped pan, expired product, equipment failure..."
                rows={3}
              />
            </div>

            {/* Photo */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Photo of waste <span className="text-destructive">*</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoCapture}
              />
              {photoPreview ? (
                <div className="relative">
                  <img
                    src={photoPreview}
                    alt="Waste preview"
                    className="w-full h-48 rounded-lg object-cover"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute bottom-2 right-2"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Retake
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full h-32 flex-col gap-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-6 w-6" />
                  <span className="text-sm">Take Photo</span>
                </Button>
              )}
            </div>

            {/* Estimated cost preview */}
            {selectedItemId && quantity && (() => {
              const item = items?.find((i) => i.id === selectedItemId);
              if (!item?.cost_per_unit) return null;
              const cost = Number(quantity) * Number(item.cost_per_unit);
              return (
                <div className="bg-destructive/10 rounded-lg p-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium">
                    Estimated loss: ${cost.toFixed(2)}
                  </span>
                </div>
              );
            })()}

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={isSubmitting || !selectedItemId || !quantity || !reason || !photoFile}
            >
              {isSubmitting ? "Submitting..." : "Submit Waste Log"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default WasteLog;
