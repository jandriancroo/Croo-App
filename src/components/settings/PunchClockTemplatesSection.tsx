import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useLocation } from "@/hooks/useLocation";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, Plus, Calendar, Clock, Trash2, Edit, Image } from "lucide-react";
import { compressImage } from "@/utils/imageCompression";
import { format, addDays, addHours } from "date-fns";

interface PunchClockTemplate {
  id: string;
  name: string;
  background_url: string | null;
  overlay_text: string | null;
  text_color: string;
  start_at: string;
  end_at: string;
  is_active: boolean;
}

interface PunchClockTemplatesSectionProps {
  locationId?: string;
}

export const PunchClockTemplatesSection = ({ locationId }: PunchClockTemplatesSectionProps) => {
  const { currentLocation } = useLocation();
  const { user } = useAuth();
  const effectiveLocationId = locationId || currentLocation?.id;
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [templates, setTemplates] = useState<PunchClockTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PunchClockTemplate | null>(null);
  const [uploading, setUploading] = useState(false);
  
  // Form state
  const [formName, setFormName] = useState("");
  const [formBackgroundUrl, setFormBackgroundUrl] = useState<string | null>(null);
  const [formOverlayText, setFormOverlayText] = useState("");
  const [formTextColor, setFormTextColor] = useState("#FFFFFF");
  const [formStartDate, setFormStartDate] = useState("");
  const [formStartTime, setFormStartTime] = useState("00:00");
  const [formDuration, setFormDuration] = useState<string>("custom");
  const [formEndDate, setFormEndDate] = useState("");
  const [formEndTime, setFormEndTime] = useState("23:59");

  useEffect(() => {
    fetchTemplates();
  }, [effectiveLocationId]);

  const fetchTemplates = async () => {
    if (!effectiveLocationId) return;

    try {
      const { data, error } = await supabase
        .from("punch_clock_templates")
        .select("*")
        .eq("location_id", effectiveLocationId)
        .order("start_at", { ascending: true });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error("Error fetching templates:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !effectiveLocationId) return;

    setUploading(true);
    try {
      const compressedFile = await compressImage(file, 1920, 1080, 0.85);
      const fileName = `${effectiveLocationId}/punch-template-${Date.now()}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from("organization-branding")
        .upload(fileName, compressedFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("organization-branding")
        .getPublicUrl(fileName);

      setFormBackgroundUrl(urlData.publicUrl);
    } catch (error) {
      console.error("Error uploading image:", error);
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDurationChange = (duration: string) => {
    setFormDuration(duration);
    
    if (duration !== "custom" && formStartDate && formStartTime) {
      const startDateTime = new Date(`${formStartDate}T${formStartTime}`);
      let endDateTime: Date;
      
      switch (duration) {
        case "24h":
          endDateTime = addHours(startDateTime, 24);
          break;
        case "3d":
          endDateTime = addDays(startDateTime, 3);
          break;
        case "5d":
          endDateTime = addDays(startDateTime, 5);
          break;
        default:
          return;
      }
      
      setFormEndDate(format(endDateTime, "yyyy-MM-dd"));
      setFormEndTime(format(endDateTime, "HH:mm"));
    }
  };

  const handleStartChange = () => {
    // Recalculate end date if duration is set
    if (formDuration !== "custom") {
      handleDurationChange(formDuration);
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormBackgroundUrl(null);
    setFormOverlayText("");
    setFormTextColor("#FFFFFF");
    setFormStartDate("");
    setFormStartTime("00:00");
    setFormDuration("custom");
    setFormEndDate("");
    setFormEndTime("23:59");
    setEditingTemplate(null);
  };

  const openCreateDialog = () => {
    resetForm();
    // Default to tomorrow
    const tomorrow = addDays(new Date(), 1);
    setFormStartDate(format(tomorrow, "yyyy-MM-dd"));
    setDialogOpen(true);
  };

  const openEditDialog = (template: PunchClockTemplate) => {
    setEditingTemplate(template);
    setFormName(template.name);
    setFormBackgroundUrl(template.background_url);
    setFormOverlayText(template.overlay_text || "");
    setFormTextColor(template.text_color);
    setFormStartDate(format(new Date(template.start_at), "yyyy-MM-dd"));
    setFormStartTime(format(new Date(template.start_at), "HH:mm"));
    setFormEndDate(format(new Date(template.end_at), "yyyy-MM-dd"));
    setFormEndTime(format(new Date(template.end_at), "HH:mm"));
    setFormDuration("custom");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!effectiveLocationId || !formName.trim() || !formStartDate || !formEndDate) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    const startAt = new Date(`${formStartDate}T${formStartTime}`).toISOString();
    const endAt = new Date(`${formEndDate}T${formEndTime}`).toISOString();

    try {
      if (editingTemplate) {
        const { error } = await supabase
          .from("punch_clock_templates")
          .update({
            name: formName.trim(),
            background_url: formBackgroundUrl,
            overlay_text: formOverlayText || null,
            text_color: formTextColor,
            start_at: startAt,
            end_at: endAt,
          })
          .eq("id", editingTemplate.id);

        if (error) throw error;
        toast({ title: "Template updated" });
      } else {
        const { error } = await supabase
          .from("punch_clock_templates")
          .insert({
            location_id: effectiveLocationId,
            name: formName.trim(),
            background_url: formBackgroundUrl,
            overlay_text: formOverlayText || null,
            text_color: formTextColor,
            start_at: startAt,
            end_at: endAt,
            created_by: user?.id,
          });

        if (error) throw error;
        toast({ title: "Template created" });
      }

      setDialogOpen(false);
      resetForm();
      fetchTemplates();
    } catch (error) {
      console.error("Error saving template:", error);
      toast({ title: "Failed to save template", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this template?")) return;

    try {
      const { error } = await supabase
        .from("punch_clock_templates")
        .delete()
        .eq("id", id);

      if (error) throw error;
      toast({ title: "Template deleted" });
      fetchTemplates();
    } catch (error) {
      console.error("Error deleting template:", error);
      toast({ title: "Failed to delete template", variant: "destructive" });
    }
  };

  const getTemplateStatus = (template: PunchClockTemplate) => {
    const now = new Date();
    const start = new Date(template.start_at);
    const end = new Date(template.end_at);

    if (now < start) return { label: "Scheduled", color: "bg-blue-500" };
    if (now >= start && now <= end) return { label: "Active", color: "bg-green-500" };
    return { label: "Expired", color: "bg-muted-foreground" };
  };

  if (!effectiveLocationId) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Scheduled Themes
              </CardTitle>
              <CardDescription>
                Schedule custom punch clock backgrounds for specific dates
              </CardDescription>
            </div>
            <Button onClick={openCreateDialog} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              New Theme
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No scheduled themes yet. Create one to override the default punch clock display during specific times.
            </p>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => {
                const status = getTemplateStatus(template);
                return (
                  <div
                    key={template.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                  >
                    {template.background_url ? (
                      <div
                        className="w-16 h-10 rounded bg-cover bg-center flex-shrink-0"
                        style={{ backgroundImage: `url(${template.background_url})` }}
                      />
                    ) : (
                      <div className="w-16 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                        <Image className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{template.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full text-white ${status.color}`}>
                          {status.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(template.start_at), "MMM d, h:mm a")} - {format(new Date(template.end_at), "MMM d, h:mm a")}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(template)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(template.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Theme" : "New Scheduled Theme"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Theme Name *</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Holiday Theme, Grand Opening"
              />
            </div>

            {/* Background Image */}
            <div className="space-y-2">
              <Label>Background Image</Label>
              {formBackgroundUrl ? (
                <div className="relative">
                  <div
                    className="w-full h-32 rounded-lg bg-cover bg-center border"
                    style={{ backgroundImage: `url(${formBackgroundUrl})` }}
                  >
                    {formOverlayText && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-lg font-bold drop-shadow-lg" style={{ color: formTextColor }}>
                          {formOverlayText}
                        </span>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => setFormBackgroundUrl(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div
                  className="w-full h-32 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="text-center text-muted-foreground">
                    <Upload className="h-6 w-6 mx-auto mb-1" />
                    <p className="text-sm">Upload image</p>
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
                disabled={uploading}
              />
            </div>

            {/* Text Overlay */}
            <div className="space-y-2">
              <Label>Text Overlay</Label>
              <Input
                value={formOverlayText}
                onChange={(e) => setFormOverlayText(e.target.value)}
                placeholder="e.g., Happy Holidays!"
                maxLength={50}
              />
            </div>

            {/* Text Color */}
            <div className="space-y-2">
              <Label>Text Color</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={formTextColor}
                  onChange={(e) => setFormTextColor(e.target.value)}
                  className="w-10 h-10 rounded border cursor-pointer"
                />
                <Input
                  value={formTextColor}
                  onChange={(e) => setFormTextColor(e.target.value)}
                  className="w-28"
                />
              </div>
            </div>

            {/* Scheduling */}
            <div className="space-y-3 pt-2 border-t">
              <Label className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Schedule
              </Label>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Start Date *</Label>
                  <Input
                    type="date"
                    value={formStartDate}
                    onChange={(e) => { setFormStartDate(e.target.value); handleStartChange(); }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Start Time</Label>
                  <Input
                    type="time"
                    value={formStartTime}
                    onChange={(e) => { setFormStartTime(e.target.value); handleStartChange(); }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Duration</Label>
                <Select value={formDuration} onValueChange={handleDurationChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">Next 24 hours</SelectItem>
                    <SelectItem value="3d">Next 3 days</SelectItem>
                    <SelectItem value="5d">Next 5 days</SelectItem>
                    <SelectItem value="custom">Custom end date</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">End Date *</Label>
                  <Input
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">End Time</Label>
                  <Input
                    type="time"
                    value={formEndTime}
                    onChange={(e) => setFormEndTime(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={uploading}>
              {editingTemplate ? "Update" : "Create"} Theme
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
