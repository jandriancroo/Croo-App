import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useLocation } from "@/hooks/useLocation";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, Plus, Calendar, Clock, Trash2, Edit, Image, Cake, Sparkles, Mountain, Landmark, Quote } from "lucide-react";
import { compressImage } from "@/utils/imageCompression";
import { format, addDays, addHours } from "date-fns";

// Built-in theme definitions
export const BUILT_IN_THEMES = {
  nature_facts: {
    id: "nature_facts",
    name: "Nature & Random Facts",
    description: "Beautiful nature landscapes with interesting random facts",
    icon: Mountain,
  },
  historical_quotes: {
    id: "historical_quotes",
    name: "Historical & Wise Quotes",
    description: "Historical landscapes with inspirational quotes",
    icon: Landmark,
  },
  custom: {
    id: "custom",
    name: "Custom Theme",
    description: "Upload your own background and message",
    icon: Image,
  },
} as const;

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

interface PunchClockSettingsSectionProps {
  locationId?: string;
}

export const PunchClockSettingsSection = ({ locationId }: PunchClockSettingsSectionProps) => {
  const { currentLocation } = useLocation();
  const { user } = useAuth();
  const effectiveLocationId = locationId || currentLocation?.id;
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Settings state
  const [loading, setLoading] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<string>("nature_facts");
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState<string | null>(null);
  const [customOverlayText, setCustomOverlayText] = useState("");
  const [customTextColor, setCustomTextColor] = useState("#FFFFFF");
  const [birthdayEventsEnabled, setBirthdayEventsEnabled] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Scheduled templates state
  const [templates, setTemplates] = useState<PunchClockTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PunchClockTemplate | null>(null);
  
  // Template form state
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
    fetchSettings();
    fetchTemplates();
  }, [effectiveLocationId]);

  const fetchSettings = async () => {
    if (!effectiveLocationId) return;

    try {
      const { data, error } = await supabase
        .from("location_settings")
        .select("id, punch_clock_background_url, punch_clock_overlay_text, punch_clock_text_color, birthday_events_enabled")
        .eq("location_id", effectiveLocationId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setBirthdayEventsEnabled(data.birthday_events_enabled ?? true);
        
        // Determine which theme is selected based on stored values
        if (data.punch_clock_background_url === "historical_quotes") {
          setSelectedTheme("historical_quotes");
        } else if (data.punch_clock_background_url && data.punch_clock_background_url !== "nature_facts") {
          setSelectedTheme("custom");
          setCustomBackgroundUrl(data.punch_clock_background_url);
          setCustomOverlayText(data.punch_clock_overlay_text || "");
          setCustomTextColor(data.punch_clock_text_color || "#FFFFFF");
        } else {
          setSelectedTheme("nature_facts");
        }
      }
    } catch (error) {
      console.error("Error fetching punch clock settings:", error);
    }
  };

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
      setTemplatesLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, forTemplate = false) => {
    const file = e.target.files?.[0];
    if (!file || !effectiveLocationId) return;

    setUploading(true);
    try {
      const compressedFile = await compressImage(file, 1920, 1080, 0.85);
      const fileName = `${effectiveLocationId}/punch-clock-${Date.now()}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from("organization-branding")
        .upload(fileName, compressedFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("organization-branding")
        .getPublicUrl(fileName);

      if (forTemplate) {
        setFormBackgroundUrl(urlData.publicUrl);
      } else {
        setCustomBackgroundUrl(urlData.publicUrl);
      }
      toast({ title: "Image uploaded" });
    } catch (error) {
      console.error("Error uploading image:", error);
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!effectiveLocationId) return;
    
    setLoading(true);
    try {
      // Store the theme identifier for built-in themes, or the actual URL for custom
      let backgroundValue: string | null = null;
      let overlayValue: string | null = null;
      let colorValue = "#FFFFFF";

      if (selectedTheme === "nature_facts") {
        backgroundValue = "nature_facts";
      } else if (selectedTheme === "historical_quotes") {
        backgroundValue = "historical_quotes";
      } else if (selectedTheme === "custom") {
        backgroundValue = customBackgroundUrl;
        overlayValue = customOverlayText || null;
        colorValue = customTextColor;
      }

      const settingsData = {
        punch_clock_background_url: backgroundValue,
        punch_clock_overlay_text: overlayValue,
        punch_clock_text_color: colorValue,
        birthday_events_enabled: birthdayEventsEnabled,
        updated_at: new Date().toISOString(),
      };

      if (settingsId) {
        const { error } = await supabase
          .from("location_settings")
          .update(settingsData)
          .eq("location_id", effectiveLocationId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("location_settings")
          .insert({
            location_id: effectiveLocationId,
            ...settingsData,
          })
          .select()
          .single();

        if (error) throw error;
        setSettingsId(data.id);
      }

      toast({ title: "Settings saved" });
    } catch (error) {
      console.error("Error saving settings:", error);
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Template functions
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

  const handleSaveTemplate = async () => {
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

  const handleDeleteTemplate = async (id: string) => {
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
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Punch Clock Customization
          </CardTitle>
          <CardDescription>
            Choose a default theme and schedule special themes for holidays or events
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Default Theme Selection */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Default Theme</Label>
            <RadioGroup value={selectedTheme} onValueChange={setSelectedTheme} className="space-y-3">
              {Object.values(BUILT_IN_THEMES).map((theme) => {
                const IconComponent = theme.icon;
                return (
                  <div
                    key={theme.id}
                    className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedTheme === theme.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    }`}
                    onClick={() => setSelectedTheme(theme.id)}
                  >
                    <RadioGroupItem value={theme.id} id={theme.id} className="mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <IconComponent className="h-4 w-4 text-primary" />
                        <Label htmlFor={theme.id} className="font-medium cursor-pointer">
                          {theme.name}
                        </Label>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{theme.description}</p>
                    </div>
                  </div>
                );
              })}
            </RadioGroup>
          </div>

          {/* Custom Theme Options */}
          {selectedTheme === "custom" && (
            <div className="space-y-4 pl-4 border-l-2 border-primary/30">
              <div className="space-y-2">
                <Label>Background Image</Label>
                {customBackgroundUrl ? (
                  <div className="relative">
                    <div
                      className="w-full h-32 rounded-lg bg-cover bg-center border"
                      style={{ backgroundImage: `url(${customBackgroundUrl})` }}
                    >
                      {customOverlayText && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-lg font-bold drop-shadow-lg" style={{ color: customTextColor }}>
                            {customOverlayText}
                          </span>
                        </div>
                      )}
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => setCustomBackgroundUrl(null)}
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
                  onChange={(e) => handleImageUpload(e, false)}
                  disabled={uploading}
                />
              </div>

              <div className="space-y-2">
                <Label>Text Overlay</Label>
                <Input
                  value={customOverlayText}
                  onChange={(e) => setCustomOverlayText(e.target.value)}
                  placeholder="e.g., Welcome to Our Team!"
                  maxLength={50}
                />
              </div>

              <div className="space-y-2">
                <Label>Text Color</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={customTextColor}
                    onChange={(e) => setCustomTextColor(e.target.value)}
                    className="w-10 h-10 rounded border cursor-pointer"
                  />
                  <Input
                    value={customTextColor}
                    onChange={(e) => setCustomTextColor(e.target.value)}
                    className="w-28"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Birthday Events Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              <Cake className="h-5 w-5 text-primary" />
              <div>
                <Label>Birthday Events</Label>
                <p className="text-xs text-muted-foreground">
                  Show employee birthdays on schedule
                </p>
              </div>
            </div>
            <Switch
              checked={birthdayEventsEnabled}
              onCheckedChange={setBirthdayEventsEnabled}
            />
          </div>

          <Button onClick={handleSaveSettings} disabled={loading}>
            {loading ? "Saving..." : "Save Settings"}
          </Button>

          {/* Scheduled Themes Section */}
          <div className="pt-6 border-t space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Scheduled Themes
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Override the default theme for specific dates (holidays, events, etc.)
                </p>
              </div>
              <Button onClick={openCreateDialog} size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" />
                Schedule
              </Button>
            </div>

            {templatesLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6 bg-muted/20 rounded-lg">
                No scheduled themes. Schedule one to override the default during special occasions.
              </p>
            ) : (
              <div className="space-y-2">
                {templates.map((template) => {
                  const status = getTemplateStatus(template);
                  return (
                    <div
                      key={template.id}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                    >
                      {template.background_url ? (
                        <div
                          className="w-14 h-9 rounded bg-cover bg-center flex-shrink-0"
                          style={{ backgroundImage: `url(${template.background_url})` }}
                        />
                      ) : (
                        <div className="w-14 h-9 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <Image className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate text-sm">{template.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full text-white ${status.color}`}>
                            {status.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(template.start_at), "MMM d, h:mm a")} - {format(new Date(template.end_at), "MMM d, h:mm a")}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(template)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeleteTemplate(template.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit Template Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Scheduled Theme" : "Schedule Theme"}</DialogTitle>
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
                  onClick={() => document.getElementById('template-file-input')?.click()}
                >
                  <div className="text-center text-muted-foreground">
                    <Upload className="h-6 w-6 mx-auto mb-1" />
                    <p className="text-sm">Upload image</p>
                  </div>
                </div>
              )}
              <input
                id="template-file-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleImageUpload(e, true)}
                disabled={uploading}
              />
            </div>

            <div className="space-y-2">
              <Label>Text Overlay</Label>
              <Input
                value={formOverlayText}
                onChange={(e) => setFormOverlayText(e.target.value)}
                placeholder="e.g., Happy Holidays!"
                maxLength={50}
              />
            </div>

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
                    onChange={(e) => {
                      setFormStartDate(e.target.value);
                      if (formDuration !== "custom") handleDurationChange(formDuration);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Start Time</Label>
                  <Input
                    type="time"
                    value={formStartTime}
                    onChange={(e) => {
                      setFormStartTime(e.target.value);
                      if (formDuration !== "custom") handleDurationChange(formDuration);
                    }}
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

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveTemplate}>
                {editingTemplate ? "Update" : "Schedule Theme"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
