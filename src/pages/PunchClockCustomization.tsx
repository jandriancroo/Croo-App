import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, Plus, Calendar, Clock, Trash2, Edit, Image, Cake, Sparkles, Mountain, Landmark, ArrowLeft, Eye } from "lucide-react";
import { compressImage } from "@/utils/imageCompression";
import { format, addDays, addHours } from "date-fns";
import crooLogo from "@/assets/croo-logo.png";

// Nature landscapes - high resolution beautiful nature images
const NATURE_PREVIEW_IMAGE = "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80";
// Historical landmarks preview image  
const HISTORICAL_PREVIEW_IMAGE = "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=800&q=80";

// Built-in theme definitions
const BUILT_IN_THEMES = {
  nature_facts: {
    id: "nature_facts",
    name: "Nature & Random Facts",
    description: "10 rotating beautiful nature landscapes with interesting random facts",
    icon: Mountain,
    previewImage: NATURE_PREVIEW_IMAGE,
    previewText: "Did you know? Honey never spoils.",
  },
  historical_quotes: {
    id: "historical_quotes",
    name: "Historical & Wise Quotes",
    description: "10 rotating historical landmarks with inspirational quotes",
    icon: Landmark,
    previewImage: HISTORICAL_PREVIEW_IMAGE,
    previewText: '"The only way to do great work is to love what you do." - Steve Jobs',
  },
  custom: {
    id: "custom",
    name: "Custom Theme",
    description: "Upload your own background and message",
    icon: Image,
    previewImage: null,
    previewText: null,
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

export default function PunchClockCustomization() {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [locationName, setLocationName] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<string>("nature_facts");
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState<string | null>(null);
  const [customOverlayText, setCustomOverlayText] = useState("");
  const [customTextColor, setCustomTextColor] = useState("#FFFFFF");
  const [customTextShadow, setCustomTextShadow] = useState(false);
  const [birthdayEventsEnabled, setBirthdayEventsEnabled] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

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
    if (locationId) {
      fetchLocation();
      fetchSettings();
      fetchTemplates();
    }
  }, [locationId]);

  const fetchLocation = async () => {
    const { data } = await supabase
      .from("locations")
      .select("name")
      .eq("id", locationId)
      .single();
    if (data) setLocationName(data.name);
  };

  const fetchSettings = async () => {
    if (!locationId) return;

    try {
      const { data, error } = await supabase
        .from("location_settings")
        .select("id, punch_clock_background_url, punch_clock_overlay_text, punch_clock_text_color, birthday_events_enabled, punch_clock_text_shadow")
        .eq("location_id", locationId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setBirthdayEventsEnabled(data.birthday_events_enabled ?? true);
        setCustomTextShadow((data as any).punch_clock_text_shadow ?? false);
        
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
      console.error("Error fetching settings:", error);
    }
  };

  const fetchTemplates = async () => {
    if (!locationId) return;

    try {
      const { data, error } = await supabase
        .from("punch_clock_templates")
        .select("*")
        .eq("location_id", locationId)
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
    if (!file || !locationId) return;

    setUploading(true);
    try {
      const compressedFile = await compressImage(file, 1920, 1080, 0.85);
      const fileName = `${locationId}/punch-clock-${Date.now()}.jpg`;
      
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
    if (!locationId) return;
    
    setLoading(true);
    try {
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
        punch_clock_text_shadow: selectedTheme === "custom" ? customTextShadow : false,
        birthday_events_enabled: birthdayEventsEnabled,
        updated_at: new Date().toISOString(),
      };

      if (settingsId) {
        const { error } = await supabase
          .from("location_settings")
          .update(settingsData)
          .eq("location_id", locationId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("location_settings")
          .insert({
            location_id: locationId,
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
    if (!locationId || !formName.trim() || !formStartDate || !formEndDate) {
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
            location_id: locationId,
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

  // Get preview data based on current selection
  const getPreviewData = () => {
    if (selectedTheme === "custom") {
      return {
        backgroundImage: customBackgroundUrl,
        overlayText: customOverlayText,
        textColor: customTextColor,
        textShadow: customTextShadow,
      };
    }
    const theme = BUILT_IN_THEMES[selectedTheme as keyof typeof BUILT_IN_THEMES];
    return {
      backgroundImage: theme?.previewImage || null,
      overlayText: theme?.previewText || null,
      textColor: "#FFFFFF",
      textShadow: false,
    };
  };

  const previewData = getPreviewData();

  return (
    <Layout>
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate(`/location/${locationId}`)} 
            className="mt-1 flex-shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <Sparkles className="h-6 w-6 sm:h-8 sm:w-8 text-primary flex-shrink-0" />
              Punch Clock Customization
            </h1>
            <p className="text-sm text-muted-foreground">
              {locationName} • Customize how the punch clock looks for employees
            </p>
          </div>
          <Button variant="outline" onClick={() => setShowPreview(true)}>
            <Eye className="h-4 w-4 mr-2" />
            Preview
          </Button>
        </div>

        {/* Default Theme Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Default Theme</CardTitle>
            <CardDescription>
              Choose how the punch clock looks when no scheduled theme is active
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
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
                    {theme.previewImage && (
                      <div 
                        className="w-20 h-12 rounded bg-cover bg-center flex-shrink-0"
                        style={{ backgroundImage: `url(${theme.previewImage})` }}
                      />
                    )}
                  </div>
                );
              })}
            </RadioGroup>

            {/* Custom Theme Options */}
            {selectedTheme === "custom" && (
              <div className="space-y-4 pl-4 border-l-2 border-primary/30">
                <div className="space-y-2">
                  <Label>Background Image</Label>
                  {customBackgroundUrl ? (
                    <div className="relative">
                      <div
                        className="w-full h-40 rounded-lg bg-cover bg-center border"
                        style={{ backgroundImage: `url(${customBackgroundUrl})` }}
                      >
                        {customOverlayText && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xl font-bold drop-shadow-lg" style={{ color: customTextColor }}>
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
                      className="w-full h-40 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <div className="text-center text-muted-foreground">
                        <Upload className="h-8 w-8 mx-auto mb-2" />
                        <p className="text-sm">Click to upload background image</p>
                        <p className="text-xs">Recommended: 1920x1080</p>
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

                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div>
                    <Label>Text Shadow Outline</Label>
                    <p className="text-xs text-muted-foreground">
                      Add shadow outline so text pops off the image
                    </p>
                  </div>
                  <Switch
                    checked={customTextShadow}
                    onCheckedChange={setCustomTextShadow}
                  />
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
                    Show employee birthdays on the punch clock
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
          </CardContent>
        </Card>

        {/* Scheduled Themes */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Scheduled Themes
                </CardTitle>
                <CardDescription>
                  Override the default theme for holidays, events, or promotions
                </CardDescription>
              </div>
              <Button onClick={openCreateDialog} size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Schedule
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {templatesLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8 bg-muted/20 rounded-lg">
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
          </CardContent>
        </Card>
      </div>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden">
          <div 
            className="relative w-full aspect-video bg-cover bg-center"
            style={{ 
              backgroundImage: previewData.backgroundImage 
                ? `url(${previewData.backgroundImage})` 
                : 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary)/0.7) 100%)'
            }}
          >
            {/* Dark overlay */}
            <div className="absolute inset-0 bg-black/40" />
            
            {/* Content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-8">
              {/* Logo */}
              <img src={crooLogo} alt="Logo" className="h-12 mb-4" />
              
              {/* Time */}
              <div className="text-6xl font-bold mb-2">
                {format(new Date(), "h:mm:ss a")}
              </div>
              
              {/* Date */}
              <div className="text-xl mb-8 opacity-80">
                {format(new Date(), "EEEE, MMMM d, yyyy")}
              </div>

              {/* Overlay Text or Fact */}
              {previewData.overlayText && (
                <div 
                  className={`text-2xl font-medium text-center max-w-2xl ${previewData.textShadow ? '' : 'drop-shadow-lg'}`}
                  style={{ 
                    color: previewData.textColor,
                    textShadow: previewData.textShadow ? '2px 2px 4px rgba(0,0,0,0.9), -1px -1px 2px rgba(0,0,0,0.5), 0 0 20px rgba(0,0,0,0.8)' : undefined
                  }}
                >
                  {previewData.overlayText}
                </div>
              )}

              {/* PIN Indicator */}
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
                <div className="text-lg opacity-70">Enter PIN to clock in/out</div>
                <div className="flex justify-center gap-2 mt-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="w-4 h-4 rounded-full bg-white/30" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
    </Layout>
  );
}
