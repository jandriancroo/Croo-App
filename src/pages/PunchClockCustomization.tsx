import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, Plus, Clock, Trash2, Edit, Image, Cake, Sparkles, Mountain, Landmark, ArrowLeft, Eye, Calendar } from "lucide-react";
import { compressImage } from "@/utils/imageCompression";
import { format, addDays, addHours } from "date-fns";
import crooLogo from "@/assets/croo-logo.png";

// Built-in theme IDs
const BUILT_IN_THEME_IDS = ["nature_facts", "historical_quotes"];

interface ThemeSlide {
  imageUrl: string;
  text: string;
}

interface PunchClockTheme {
  id: string;
  name: string;
  background_urls: string[];
  overlay_texts: string[];
  text_color: string;
  text_shadow: boolean;
  start_at: string | null;
  end_at: string | null;
  is_active: boolean;
}

export default function PunchClockCustomization() {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  
  const [locationName, setLocationName] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [birthdayEventsEnabled, setBirthdayEventsEnabled] = useState(true);
  const [uploading, setUploading] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewSlideIndex, setPreviewSlideIndex] = useState(0);

  // Themes list
  const [themes, setThemes] = useState<PunchClockTheme[]>([]);
  const [themesLoading, setThemesLoading] = useState(true);
  const [selectedThemeId, setSelectedThemeId] = useState<string>("nature_facts");
  
  // Theme editor state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<PunchClockTheme | null>(null);
  
  // Form state for theme editor
  const [formName, setFormName] = useState("");
  const [formSlides, setFormSlides] = useState<ThemeSlide[]>([{ imageUrl: "", text: "" }]);
  const [formTextColor, setFormTextColor] = useState("#FFFFFF");
  const [formTextShadow, setFormTextShadow] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);
  const [formStartDate, setFormStartDate] = useState("");
  const [formStartTime, setFormStartTime] = useState("00:00");
  const [formDuration, setFormDuration] = useState<string>("custom");
  const [formEndDate, setFormEndDate] = useState("");
  const [formEndTime, setFormEndTime] = useState("23:59");

  useEffect(() => {
    if (locationId) {
      fetchLocation();
      fetchSettings();
      fetchThemes();
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
        .select("id, punch_clock_background_url, birthday_events_enabled")
        .eq("location_id", locationId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setBirthdayEventsEnabled(data.birthday_events_enabled ?? true);
        
        // Determine selected theme from stored value
        if (data.punch_clock_background_url) {
          if (BUILT_IN_THEME_IDS.includes(data.punch_clock_background_url)) {
            setSelectedThemeId(data.punch_clock_background_url);
          } else {
            // It's a custom theme ID
            setSelectedThemeId(data.punch_clock_background_url);
          }
        } else {
          setSelectedThemeId("nature_facts");
        }
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    }
  };

  const fetchThemes = async () => {
    if (!locationId) return;

    try {
      const { data, error } = await supabase
        .from("punch_clock_templates")
        .select("*")
        .eq("location_id", locationId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      const formattedThemes: PunchClockTheme[] = (data || []).map(t => ({
        id: t.id,
        name: t.name,
        background_urls: (t.background_urls as string[]) || [],
        overlay_texts: (t.overlay_texts as string[]) || [],
        text_color: t.text_color || "#FFFFFF",
        text_shadow: (t as any).text_shadow || false,
        start_at: t.start_at,
        end_at: t.end_at,
        is_active: t.is_active ?? true,
      }));
      
      setThemes(formattedThemes);
    } catch (error) {
      console.error("Error fetching themes:", error);
    } finally {
      setThemesLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, slideIndex: number) => {
    const file = e.target.files?.[0];
    if (!file || !locationId) return;

    setUploading(slideIndex);
    try {
      const compressedFile = await compressImage(file, 1920, 1080, 0.85);
      const fileName = `${locationId}/punch-clock-${Date.now()}-${slideIndex}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from("organization-branding")
        .upload(fileName, compressedFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("organization-branding")
        .getPublicUrl(fileName);

      setFormSlides(prev => {
        const updated = [...prev];
        updated[slideIndex] = { ...updated[slideIndex], imageUrl: urlData.publicUrl };
        return updated;
      });
      toast({ title: "Image uploaded" });
    } catch (error) {
      console.error("Error uploading image:", error);
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(null);
    }
  };

  const handleSaveDefaultTheme = async () => {
    if (!locationId) return;
    
    setLoading(true);
    try {
      const settingsData = {
        punch_clock_background_url: selectedThemeId,
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
    setFormSlides([{ imageUrl: "", text: "" }]);
    setFormTextColor("#FFFFFF");
    setFormTextShadow(false);
    setIsScheduled(false);
    setFormStartDate("");
    setFormStartTime("00:00");
    setFormDuration("custom");
    setFormEndDate("");
    setFormEndTime("23:59");
    setEditingTheme(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (theme: PunchClockTheme) => {
    setEditingTheme(theme);
    setFormName(theme.name);
    setFormTextColor(theme.text_color);
    setFormTextShadow(theme.text_shadow);
    
    // Build slides from arrays
    const slides: ThemeSlide[] = [];
    const maxLen = Math.max(theme.background_urls.length, theme.overlay_texts.length, 1);
    for (let i = 0; i < maxLen; i++) {
      slides.push({
        imageUrl: theme.background_urls[i] || "",
        text: theme.overlay_texts[i] || "",
      });
    }
    setFormSlides(slides);
    
    // Check if scheduled
    if (theme.start_at && theme.end_at) {
      setIsScheduled(true);
      setFormStartDate(format(new Date(theme.start_at), "yyyy-MM-dd"));
      setFormStartTime(format(new Date(theme.start_at), "HH:mm"));
      setFormEndDate(format(new Date(theme.end_at), "yyyy-MM-dd"));
      setFormEndTime(format(new Date(theme.end_at), "HH:mm"));
    } else {
      setIsScheduled(false);
    }
    
    setFormDuration("custom");
    setDialogOpen(true);
  };

  const addSlide = () => {
    if (formSlides.length >= 10) return;
    setFormSlides(prev => [...prev, { imageUrl: "", text: "" }]);
  };

  const removeSlide = (index: number) => {
    if (formSlides.length <= 1) return;
    setFormSlides(prev => prev.filter((_, i) => i !== index));
  };

  const updateSlide = (index: number, field: "imageUrl" | "text", value: string) => {
    setFormSlides(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleSaveTheme = async () => {
    if (!locationId || !formName.trim()) {
      toast({ title: "Please enter a theme name", variant: "destructive" });
      return;
    }

    // Filter out empty slides (no image and no text)
    const validSlides = formSlides.filter(s => s.imageUrl || s.text);
    if (validSlides.length === 0) {
      toast({ title: "Please add at least one slide with an image or text", variant: "destructive" });
      return;
    }

    const backgroundUrls = validSlides.map(s => s.imageUrl).filter(Boolean);
    const overlayTexts = validSlides.map(s => s.text);

    let startAt: string | null = null;
    let endAt: string | null = null;

    if (isScheduled) {
      if (!formStartDate || !formEndDate) {
        toast({ title: "Please set start and end dates for scheduled theme", variant: "destructive" });
        return;
      }
      startAt = new Date(`${formStartDate}T${formStartTime}`).toISOString();
      endAt = new Date(`${formEndDate}T${formEndTime}`).toISOString();
    }

    try {
      if (editingTheme) {
        const { error } = await supabase
          .from("punch_clock_templates")
          .update({
            name: formName.trim(),
            background_urls: backgroundUrls,
            overlay_texts: overlayTexts,
            text_color: formTextColor,
            text_shadow: formTextShadow,
            start_at: startAt,
            end_at: endAt,
          })
          .eq("id", editingTheme.id);

        if (error) throw error;
        toast({ title: "Theme updated" });
      } else {
        const { error } = await supabase
          .from("punch_clock_templates")
          .insert({
            location_id: locationId,
            name: formName.trim(),
            background_urls: backgroundUrls,
            overlay_texts: overlayTexts,
            text_color: formTextColor,
            text_shadow: formTextShadow,
            start_at: startAt,
            end_at: endAt,
            created_by: user?.id,
          });

        if (error) throw error;
        toast({ title: "Theme created" });
      }

      setDialogOpen(false);
      resetForm();
      fetchThemes();
    } catch (error) {
      console.error("Error saving theme:", error);
      toast({ title: "Failed to save theme", variant: "destructive" });
    }
  };

  const handleDeleteTheme = async (id: string) => {
    if (!confirm("Delete this theme?")) return;

    try {
      const { error } = await supabase
        .from("punch_clock_templates")
        .delete()
        .eq("id", id);

      if (error) throw error;
      
      // If deleted theme was selected, revert to default
      if (selectedThemeId === id) {
        setSelectedThemeId("nature_facts");
      }
      
      toast({ title: "Theme deleted" });
      fetchThemes();
    } catch (error) {
      console.error("Error deleting theme:", error);
      toast({ title: "Failed to delete theme", variant: "destructive" });
    }
  };

  const getThemeStatus = (theme: PunchClockTheme) => {
    if (!theme.start_at || !theme.end_at) {
      return { label: "Always", color: "bg-primary" };
    }
    
    const now = new Date();
    const start = new Date(theme.start_at);
    const end = new Date(theme.end_at);

    if (now < start) return { label: "Scheduled", color: "bg-blue-500" };
    if (now >= start && now <= end) return { label: "Active", color: "bg-green-500" };
    return { label: "Expired", color: "bg-muted-foreground" };
  };

  // Get preview data based on current selection
  const getPreviewData = () => {
    if (selectedThemeId === "nature_facts") {
      return {
        backgroundImage: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80",
        overlayText: "Did you know? Honey never spoils.",
        textColor: "#FFFFFF",
        textShadow: false,
      };
    }
    if (selectedThemeId === "historical_quotes") {
      return {
        backgroundImage: "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=800&q=80",
        overlayText: '"The only way to do great work is to love what you do." - Steve Jobs',
        textColor: "#FFFFFF",
        textShadow: false,
      };
    }
    
    // Custom theme
    const theme = themes.find(t => t.id === selectedThemeId);
    if (theme && theme.background_urls.length > 0) {
      const slideIdx = previewSlideIndex % Math.max(theme.background_urls.length, theme.overlay_texts.length);
      return {
        backgroundImage: theme.background_urls[slideIdx] || theme.background_urls[0],
        overlayText: theme.overlay_texts[slideIdx] || "",
        textColor: theme.text_color,
        textShadow: theme.text_shadow,
      };
    }
    
    return {
      backgroundImage: null,
      overlayText: null,
      textColor: "#FFFFFF",
      textShadow: false,
    };
  };

  const previewData = getPreviewData();
  
  // Auto-rotate preview slides
  useEffect(() => {
    const timer = setInterval(() => {
      setPreviewSlideIndex(prev => prev + 1);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

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

        {/* Themes Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Themes</CardTitle>
                <CardDescription>
                  Select a theme or create custom themes. Scheduled themes override the default.
                </CardDescription>
              </div>
              <Button onClick={openCreateDialog} size="sm">
                <Plus className="h-4 w-4 mr-1" />
                New Theme
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Theme Selector */}
            <div className="space-y-2">
              <Label>Default Theme</Label>
              <Select value={selectedThemeId} onValueChange={setSelectedThemeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nature_facts">
                    <div className="flex items-center gap-2">
                      <Mountain className="h-4 w-4" />
                      Nature & Random Facts
                    </div>
                  </SelectItem>
                  <SelectItem value="historical_quotes">
                    <div className="flex items-center gap-2">
                      <Landmark className="h-4 w-4" />
                      Historical & Wise Quotes
                    </div>
                  </SelectItem>
                  {themes.filter(t => !t.start_at).map(theme => (
                    <SelectItem key={theme.id} value={theme.id}>
                      <div className="flex items-center gap-2">
                        <Image className="h-4 w-4" />
                        {theme.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                This theme is used when no scheduled theme is active
              </p>
            </div>

            {/* Custom Themes List */}
            {themesLoading ? (
              <p className="text-sm text-muted-foreground">Loading themes...</p>
            ) : themes.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Your Themes</Label>
                {themes.map((theme) => {
                  const status = getThemeStatus(theme);
                  return (
                    <div
                      key={theme.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border bg-card ${
                        selectedThemeId === theme.id ? "border-primary" : ""
                      }`}
                    >
                      {theme.background_urls[0] ? (
                        <div
                          className="w-16 h-10 rounded bg-cover bg-center flex-shrink-0"
                          style={{ backgroundImage: `url(${theme.background_urls[0]})` }}
                        />
                      ) : (
                        <div className="w-16 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <Image className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{theme.name}</span>
                          {theme.background_urls.length > 1 && (
                            <span className="text-xs text-muted-foreground">
                              ({theme.background_urls.length} slides)
                            </span>
                          )}
                          {theme.start_at && (
                            <span className={`text-xs px-2 py-0.5 rounded-full text-white ${status.color}`}>
                              {status.label}
                            </span>
                          )}
                        </div>
                        {theme.start_at && theme.end_at && (
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(theme.start_at), "MMM d, h:mm a")} - {format(new Date(theme.end_at), "MMM d, h:mm a")}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(theme)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeleteTheme(theme.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Birthday Events Toggle */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
              <div className="flex items-center gap-3">
                <Cake className="h-5 w-5 text-primary" />
                <div>
                  <Label>Birthday Events</Label>
                  <p className="text-xs text-muted-foreground">
                    Birthday messages override all themes when active
                  </p>
                </div>
              </div>
              <Switch
                checked={birthdayEventsEnabled}
                onCheckedChange={setBirthdayEventsEnabled}
              />
            </div>

            <Button onClick={handleSaveDefaultTheme} disabled={loading}>
              {loading ? "Saving..." : "Save Settings"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden">
          <div className="grid md:grid-cols-2">
            {/* Left Side - Theme Preview */}
            <div 
              className="relative min-h-[500px] bg-cover bg-center transition-all duration-500"
              style={{ 
                backgroundImage: previewData.backgroundImage 
                  ? `url(${previewData.backgroundImage})` 
                  : 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary)/0.7) 100%)'
              }}
            >
              <div className="absolute inset-0 bg-black/40" />
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-8">
                <img 
                  src={crooLogo} 
                  alt="Logo" 
                  className="h-16 mb-4 transition-all duration-500"
                  style={{ filter: 'brightness(0) invert(1)' }}
                />
                <div className="text-5xl font-bold mb-2">
                  {format(new Date(), "h:mm:ss a")}
                </div>
                <div className="text-lg mb-6 opacity-80">
                  {format(new Date(), "EEEE, MMMM d, yyyy")}
                </div>
                {previewData.overlayText && (
                  <div 
                    className={`text-xl font-medium text-center max-w-sm ${previewData.textShadow ? '' : 'drop-shadow-lg'}`}
                    style={{ 
                      color: previewData.textColor,
                      textShadow: previewData.textShadow ? '2px 2px 4px rgba(0,0,0,0.9), -1px -1px 2px rgba(0,0,0,0.5), 0 0 20px rgba(0,0,0,0.8)' : undefined
                    }}
                  >
                    {previewData.overlayText}
                  </div>
                )}
              </div>
            </div>

            {/* Right Side - Number Pad Preview */}
            <div className="p-8 flex flex-col justify-center bg-card">
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-semibold mb-4 text-center">Enter Your PIN</h3>
                  <div className="text-center mb-6">
                    <div className="text-3xl font-mono tracking-widest h-16 flex items-center justify-center border-2 border-primary/20 rounded-lg bg-muted/50">
                      {'••••'}
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <Button
                      key={num}
                      variant="outline"
                      size="lg"
                      className="h-14 text-xl font-semibold pointer-events-none"
                    >
                      {num}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    size="lg"
                    className="h-14 text-sm pointer-events-none"
                  >
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-14 text-xl font-semibold pointer-events-none"
                  >
                    0
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    className="h-14 text-sm pointer-events-none"
                  >
                    ←
                  </Button>
                </div>

                <Button
                  className="w-full h-12 text-lg pointer-events-none"
                  disabled
                >
                  Enter
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Theme Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTheme ? "Edit Theme" : "Create Theme"}</DialogTitle>
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

            {/* Slides */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Slides ({formSlides.length}/10)</Label>
                {formSlides.length < 10 && (
                  <Button variant="outline" size="sm" onClick={addSlide}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Slide
                  </Button>
                )}
              </div>
              
              <div className="space-y-3">
                {formSlides.map((slide, index) => (
                  <div key={index} className="p-3 rounded-lg border bg-muted/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Slide {index + 1}</span>
                      {formSlides.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removeSlide(index)}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    
                    {/* Image */}
                    {slide.imageUrl ? (
                      <div className="relative">
                        <div
                          className="w-full h-24 rounded-lg bg-cover bg-center border"
                          style={{ backgroundImage: `url(${slide.imageUrl})` }}
                        />
                        <Button
                          variant="destructive"
                          size="sm"
                          className="absolute top-1 right-1 h-6 w-6 p-0"
                          onClick={() => updateSlide(index, "imageUrl", "")}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div
                        className="w-full h-24 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
                        onClick={() => fileInputRefs.current[index]?.click()}
                      >
                        <div className="text-center text-muted-foreground">
                          {uploading === index ? (
                            <p className="text-sm">Uploading...</p>
                          ) : (
                            <>
                              <Upload className="h-5 w-5 mx-auto mb-1" />
                              <p className="text-xs">Upload image</p>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    <input
                      ref={el => fileInputRefs.current[index] = el}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleImageUpload(e, index)}
                      disabled={uploading !== null}
                    />
                    
                    {/* Text */}
                    <Input
                      value={slide.text}
                      onChange={(e) => updateSlide(index, "text", e.target.value)}
                      placeholder="Text overlay for this slide (optional)"
                      maxLength={100}
                    />
                  </div>
                ))}
              </div>
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

            {/* Text Shadow */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div>
                <Label>Text Shadow Outline</Label>
                <p className="text-xs text-muted-foreground">
                  Add shadow outline so text pops off the image
                </p>
              </div>
              <Switch
                checked={formTextShadow}
                onCheckedChange={setFormTextShadow}
              />
            </div>

            {/* Schedule Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                <div>
                  <Label>Schedule This Theme</Label>
                  <p className="text-xs text-muted-foreground">
                    Set specific dates when this theme is active
                  </p>
                </div>
              </div>
              <Switch
                checked={isScheduled}
                onCheckedChange={setIsScheduled}
              />
            </div>

            {/* Schedule Options */}
            {isScheduled && (
              <div className="space-y-3 pl-4 border-l-2 border-primary/30">
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
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveTheme}>
                {editingTheme ? "Update Theme" : "Create Theme"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
