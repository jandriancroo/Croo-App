import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, Plus, Trash2, Edit, Image, Cake, Sparkles, ArrowLeft, Eye, Calendar, Check, Crop } from "lucide-react";
import { compressImage } from "@/utils/imageCompression";
import { format, addDays, addHours } from "date-fns";
import crooLogo from "@/assets/croo-logo.png";
import { ImageCropDialog } from "@/components/ImageCropDialog";

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
  text_position: 'overlay' | 'below';
  start_at: string | null;
  end_at: string | null;
  is_active: boolean;
  is_builtin?: boolean;
}

// Default built-in themes (seeded if not in DB)
const BUILTIN_THEMES: Omit<PunchClockTheme, 'id' | 'start_at' | 'end_at' | 'is_active'>[] = [
  {
    name: "Nature & Random Facts",
    background_urls: ["https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80"],
    overlay_texts: ["Did you know? Honey never spoils."],
    text_color: "#FFFFFF",
    text_shadow: false,
    text_position: 'overlay' as const,
    is_builtin: true,
  },
  {
    name: "Historical & Wise Quotes",
    background_urls: ["https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=800&q=80"],
    overlay_texts: ['"The only way to do great work is to love what you do." - Steve Jobs'],
    text_color: "#FFFFFF",
    text_shadow: false,
    text_position: 'overlay' as const,
    is_builtin: true,
  },
];

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
  const [activeTab, setActiveTab] = useState<string>("themes");

  // Themes list
  const [themes, setThemes] = useState<PunchClockTheme[]>([]);
  const [themesLoading, setThemesLoading] = useState(true);
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [savedThemeId, setSavedThemeId] = useState<string | null>(null);
  
  // Timing settings for selected theme (in Themes tab)
  const [timingMode, setTimingMode] = useState<"always" | "scheduled">("always");
  const [timingStartDate, setTimingStartDate] = useState("");
  const [timingStartTime, setTimingStartTime] = useState("00:00");
  const [timingEndDate, setTimingEndDate] = useState("");
  const [timingEndTime, setTimingEndTime] = useState("23:59");
  const [timingDuration, setTimingDuration] = useState<string>("custom");
  
  // Theme editor state (Edit tab)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<PunchClockTheme | null>(null);
  
  // Form state for theme editor
  const [formName, setFormName] = useState("");
  const [formSlides, setFormSlides] = useState<ThemeSlide[]>([{ imageUrl: "", text: "" }]);
  const [formTextColor, setFormTextColor] = useState("#FFFFFF");
  const [formTextShadow, setFormTextShadow] = useState(false);
  const [formTextPosition, setFormTextPosition] = useState<'overlay' | 'below'>('overlay');
  
  // Image crop state
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string>("");
  const [cropSlideIndex, setCropSlideIndex] = useState<number>(0);

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
        if (data.punch_clock_background_url) {
          setSavedThemeId(data.punch_clock_background_url);
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
        .order("created_at", { ascending: true });

      if (error) throw error;
      
      let themesData = data || [];
      
      // Check if we need to seed built-in themes (by name)
      const existingNames = themesData.map(t => t.name);
      const missingBuiltins = BUILTIN_THEMES.filter(bt => !existingNames.includes(bt.name));
      
      if (missingBuiltins.length > 0) {
        // Seed missing built-in themes
        const seedPromises = missingBuiltins.map(theme => 
          supabase.from("punch_clock_templates").insert({
            location_id: locationId,
            name: theme.name,
            background_urls: theme.background_urls,
            overlay_texts: theme.overlay_texts,
            text_color: theme.text_color,
            text_shadow: theme.text_shadow,
            start_at: new Date('2000-01-01T00:00:00').toISOString(),
            end_at: new Date('2099-12-31T23:59:59').toISOString(),
            created_by: user?.id,
          }).select().single()
        );
        
        const results = await Promise.all(seedPromises);
        const newThemes = results.map(r => r.data).filter(Boolean) as any[];
        themesData = [...themesData, ...newThemes];
      }
      
      const formattedThemes: PunchClockTheme[] = themesData.map(t => ({
        id: t.id,
        name: t.name,
        background_urls: (t.background_urls as string[]) || [],
        overlay_texts: (t.overlay_texts as string[]) || [],
        text_color: t.text_color || "#FFFFFF",
        text_shadow: (t as any).text_shadow || false,
        text_position: ((t as any).text_position as 'overlay' | 'below') || 'overlay',
        start_at: t.start_at,
        end_at: t.end_at,
        is_active: t.is_active ?? true,
        is_builtin: (t as any).is_builtin || false,
      }));
      
      setThemes(formattedThemes);
      
      // Auto-select the saved theme or first theme
      if (formattedThemes.length > 0 && !selectedThemeId) {
        const toSelect = savedThemeId && formattedThemes.find(t => t.id === savedThemeId)
          ? savedThemeId
          : formattedThemes[0].id;
        setSelectedThemeId(toSelect);
        loadTimingFromTheme(formattedThemes.find(t => t.id === toSelect));
      }
    } catch (error) {
      console.error("Error fetching themes:", error);
    } finally {
      setThemesLoading(false);
    }
  };

  const loadTimingFromTheme = (theme: PunchClockTheme | undefined) => {
    if (!theme) return;
    
    // Check if it's an "always" theme (dates span 2000-2099)
    const start = theme.start_at ? new Date(theme.start_at) : null;
    const end = theme.end_at ? new Date(theme.end_at) : null;
    
    const isAlways = start && end && 
      start.getFullYear() <= 2001 && end.getFullYear() >= 2098;
    
    if (isAlways) {
      setTimingMode("always");
      setTimingStartDate("");
      setTimingEndDate("");
    } else if (start && end) {
      setTimingMode("scheduled");
      setTimingStartDate(format(start, "yyyy-MM-dd"));
      setTimingStartTime(format(start, "HH:mm"));
      setTimingEndDate(format(end, "yyyy-MM-dd"));
      setTimingEndTime(format(end, "HH:mm"));
    }
  };

  const handleThemeSelect = (themeId: string) => {
    setSelectedThemeId(themeId);
    const theme = themes.find(t => t.id === themeId);
    loadTimingFromTheme(theme);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, slideIndex: number) => {
    const file = e.target.files?.[0];
    if (!file || !locationId) return;

    // Read file and open crop dialog
    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result as string);
      setCropSlideIndex(slideIndex);
      setCropDialogOpen(true);
    };
    reader.readAsDataURL(file);
    
    // Reset file input so same file can be selected again
    e.target.value = '';
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    if (!locationId) return;
    
    setUploading(cropSlideIndex);
    try {
      const compressedFile = await compressImage(croppedBlob as File, 1920, 1080, 0.85);
      const fileName = `${locationId}/punch-clock-${Date.now()}-${cropSlideIndex}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from("organization-branding")
        .upload(fileName, compressedFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("organization-branding")
        .getPublicUrl(fileName);

      setFormSlides(prev => {
        const updated = [...prev];
        updated[cropSlideIndex] = { ...updated[cropSlideIndex], imageUrl: urlData.publicUrl };
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

  const handleEditImage = (slideIndex: number, imageUrl: string) => {
    setCropImageSrc(imageUrl);
    setCropSlideIndex(slideIndex);
    setCropDialogOpen(true);
  };

  const handleApplyTheme = async () => {
    if (!locationId || !selectedThemeId) return;
    
    setLoading(true);
    try {
      // Update timing on the theme itself
      let startAt: string;
      let endAt: string;
      
      if (timingMode === "always") {
        startAt = new Date('2000-01-01T00:00:00').toISOString();
        endAt = new Date('2099-12-31T23:59:59').toISOString();
      } else {
        if (!timingStartDate || !timingEndDate) {
          toast({ title: "Please set start and end dates", variant: "destructive" });
          setLoading(false);
          return;
        }
        startAt = new Date(`${timingStartDate}T${timingStartTime}`).toISOString();
        endAt = new Date(`${timingEndDate}T${timingEndTime}`).toISOString();
      }
      
      // Update theme timing
      await supabase
        .from("punch_clock_templates")
        .update({ start_at: startAt, end_at: endAt })
        .eq("id", selectedThemeId);
      
      // Save as the active theme in location settings
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
          .insert({ location_id: locationId, ...settingsData })
          .select()
          .single();
        if (error) throw error;
        setSettingsId(data.id);
      }

      setSavedThemeId(selectedThemeId);
      toast({ title: "Theme applied!" });
      fetchThemes();
    } catch (error) {
      console.error("Error applying theme:", error);
      toast({ title: "Failed to apply theme", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDurationChange = (duration: string) => {
    setTimingDuration(duration);
    
    if (duration !== "custom" && timingStartDate && timingStartTime) {
      const startDateTime = new Date(`${timingStartDate}T${timingStartTime}`);
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
      
      setTimingEndDate(format(endDateTime, "yyyy-MM-dd"));
      setTimingEndTime(format(endDateTime, "HH:mm"));
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormSlides([{ imageUrl: "", text: "" }]);
    setFormTextColor("#FFFFFF");
    setFormTextShadow(false);
    setFormTextPosition('overlay');
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
    setFormTextPosition(theme.text_position || 'overlay');
    
    const slides: ThemeSlide[] = [];
    const maxLen = Math.max(theme.background_urls.length, theme.overlay_texts.length, 1);
    for (let i = 0; i < maxLen; i++) {
      slides.push({
        imageUrl: theme.background_urls[i] || "",
        text: theme.overlay_texts[i] || "",
      });
    }
    setFormSlides(slides);
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

    const validSlides = formSlides.filter(s => s.imageUrl || s.text);
    if (validSlides.length === 0) {
      toast({ title: "Please add at least one slide with an image or text", variant: "destructive" });
      return;
    }

    const backgroundUrls = validSlides.map(s => s.imageUrl).filter(Boolean);
    const overlayTexts = validSlides.map(s => s.text);

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
            text_position: formTextPosition,
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
            text_position: formTextPosition,
            start_at: new Date('2000-01-01T00:00:00').toISOString(),
            end_at: new Date('2099-12-31T23:59:59').toISOString(),
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
      
      if (selectedThemeId === id) {
        setSelectedThemeId(themes.find(t => t.id !== id)?.id || null);
      }
      if (savedThemeId === id) {
        setSavedThemeId(null);
      }
      
      toast({ title: "Theme deleted" });
      fetchThemes();
    } catch (error) {
      console.error("Error deleting theme:", error);
      toast({ title: "Failed to delete theme", variant: "destructive" });
    }
  };

  // Get preview data based on current selection
  const getPreviewData = () => {
    const theme = themes.find(t => t.id === selectedThemeId);
    if (theme) {
      const validUrls = theme.background_urls.filter(url => url && url.trim() !== "");
      const slideCount = Math.max(validUrls.length, theme.overlay_texts.length, 1);
      const slideIdx = previewSlideIndex % slideCount;
      return {
        backgroundImage: validUrls[slideIdx] || validUrls[0] || null,
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
          <Button variant="outline" onClick={() => setShowPreview(true)} disabled={!selectedThemeId}>
            <Eye className="h-4 w-4 mr-2" />
            Preview
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="themes">Themes</TabsTrigger>
            <TabsTrigger value="edit">Edit</TabsTrigger>
          </TabsList>

          {/* Themes Tab - Select and Apply */}
          <TabsContent value="themes" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Select Theme</CardTitle>
                <CardDescription>
                  Choose a theme and set when it should be active
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {themesLoading ? (
                  <p className="text-sm text-muted-foreground">Loading themes...</p>
                ) : themes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No themes yet. Go to Edit tab to create one.</p>
                ) : (
                  <>
                    {/* Theme Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {themes.map((theme) => (
                        <div
                          key={theme.id}
                          onClick={() => handleThemeSelect(theme.id)}
                          className={`relative cursor-pointer rounded-lg border-2 transition-all overflow-hidden ${
                            selectedThemeId === theme.id 
                              ? "border-primary ring-2 ring-primary/20" 
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          {/* Thumbnail */}
                          <div
                            className="aspect-video bg-cover bg-center"
                            style={{ 
                              backgroundImage: theme.background_urls[0] 
                                ? `url(${theme.background_urls[0]})` 
                                : 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary)/0.7) 100%)'
                            }}
                          >
                            <div className="absolute inset-0 bg-black/30" />
                          </div>
                          
                          {/* Name */}
                          <div className="p-2 bg-card">
                            <p className="text-sm font-medium truncate">{theme.name}</p>
                            {theme.background_urls.length > 1 && (
                              <p className="text-xs text-muted-foreground">
                                {theme.background_urls.length} slides
                              </p>
                            )}
                          </div>
                          
                          {/* Active badge */}
                          {savedThemeId === theme.id && (
                            <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Check className="h-3 w-3" />
                              Active
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Timing Settings */}
                    {selectedThemeId && (
                      <div className="space-y-4 p-4 rounded-lg bg-muted/30">
                        <Label className="text-base font-medium">Timing</Label>
                        
                        <div className="flex gap-2">
                          <Button
                            variant={timingMode === "always" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setTimingMode("always")}
                          >
                            Always Active
                          </Button>
                          <Button
                            variant={timingMode === "scheduled" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setTimingMode("scheduled")}
                          >
                            <Calendar className="h-4 w-4 mr-1" />
                            Scheduled
                          </Button>
                        </div>

                        {timingMode === "scheduled" && (
                          <div className="space-y-3 pl-4 border-l-2 border-primary/30">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Start Date</Label>
                                <Input
                                  type="date"
                                  value={timingStartDate}
                                  onChange={(e) => {
                                    setTimingStartDate(e.target.value);
                                    if (timingDuration !== "custom") handleDurationChange(timingDuration);
                                  }}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Start Time</Label>
                                <Input
                                  type="time"
                                  value={timingStartTime}
                                  onChange={(e) => {
                                    setTimingStartTime(e.target.value);
                                    if (timingDuration !== "custom") handleDurationChange(timingDuration);
                                  }}
                                />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs">Duration</Label>
                              <Select value={timingDuration} onValueChange={handleDurationChange}>
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
                                <Label className="text-xs">End Date</Label>
                                <Input
                                  type="date"
                                  value={timingEndDate}
                                  onChange={(e) => setTimingEndDate(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">End Time</Label>
                                <Input
                                  type="time"
                                  value={timingEndTime}
                                  onChange={(e) => setTimingEndTime(e.target.value)}
                                />
                              </div>
                            </div>
                          </div>
                        )}
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

                    {/* Apply Button */}
                    <Button 
                      onClick={handleApplyTheme} 
                      disabled={loading || !selectedThemeId}
                      className="w-full"
                      size="lg"
                    >
                      {loading ? "Applying..." : "Apply Theme"}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Edit Tab - Create/Edit/Delete themes */}
          <TabsContent value="edit" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Manage Themes</CardTitle>
                    <CardDescription>
                      Create, edit, or delete themes
                    </CardDescription>
                  </div>
                  <Button onClick={openCreateDialog} size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    New Theme
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {themesLoading ? (
                  <p className="text-sm text-muted-foreground">Loading themes...</p>
                ) : themes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No themes yet. Create your first theme.</p>
                ) : (
                  themes.map((theme) => (
                    <div
                      key={theme.id}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                    >
                      {theme.background_urls[0] ? (
                        <div
                          className="w-20 h-12 rounded bg-cover bg-center flex-shrink-0"
                          style={{ backgroundImage: `url(${theme.background_urls[0]})` }}
                        />
                      ) : (
                        <div className="w-20 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
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
                          {savedThemeId === theme.id && (
                            <span className="text-xs px-2 py-0.5 rounded-full text-white bg-green-500">
                              Active
                            </span>
                          )}
                        </div>
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
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden" aria-describedby={undefined}>
          <DialogHeader className="sr-only">
            <DialogTitle>Punch Clock Preview</DialogTitle>
          </DialogHeader>
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
                        <div className="absolute top-1 right-1 flex gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => handleEditImage(index, slide.imageUrl)}
                            title="Crop & Zoom"
                          >
                            <Crop className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => updateSlide(index, "imageUrl", "")}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
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

            {/* Text Position */}
            <div className="space-y-2">
              <Label>Text Position</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={formTextPosition === "overlay" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFormTextPosition('overlay')}
                >
                  Overlay on Image
                </Button>
                <Button
                  type="button"
                  variant={formTextPosition === "below" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFormTextPosition('below')}
                >
                  Below Image
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Choose whether text appears on top of the image or in a separate area below it
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveTheme}>
                {editingTheme ? "Update Theme" : "Create Theme"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Image Crop Dialog */}
      <ImageCropDialog
        open={cropDialogOpen}
        onOpenChange={setCropDialogOpen}
        imageSrc={cropImageSrc}
        onCropComplete={handleCropComplete}
        cropShape="rect"
        aspect={16 / 9}
      />
    </Layout>
  );
}
