import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useLocation } from "@/hooks/useLocation";
import { Upload, X, Image, Type, Cake } from "lucide-react";
import { compressImage } from "@/utils/imageCompression";

interface PunchClockSettingsSectionProps {
  locationId?: string;
}

export const PunchClockSettingsSection = ({ locationId }: PunchClockSettingsSectionProps) => {
  const { currentLocation } = useLocation();
  const effectiveLocationId = locationId || currentLocation?.id;
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [loading, setLoading] = useState(false);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [overlayText, setOverlayText] = useState("");
  const [textColor, setTextColor] = useState("#FFFFFF");
  const [birthdayEventsEnabled, setBirthdayEventsEnabled] = useState(true);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchSettings();
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
        setBackgroundUrl(data.punch_clock_background_url);
        setOverlayText(data.punch_clock_overlay_text || "");
        setTextColor(data.punch_clock_text_color || "#FFFFFF");
        setBirthdayEventsEnabled(data.birthday_events_enabled ?? true);
      }
    } catch (error) {
      console.error("Error fetching punch clock settings:", error);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !effectiveLocationId) return;

    setUploading(true);
    try {
      // Compress image
      const compressedFile = await compressImage(file, 1920, 1080, 0.85);
      
      const fileName = `${effectiveLocationId}/punch-clock-bg-${Date.now()}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from("organization-branding")
        .upload(fileName, compressedFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("organization-branding")
        .getPublicUrl(fileName);

      setBackgroundUrl(urlData.publicUrl);
      toast({
        title: "Image uploaded",
        description: "Background image uploaded successfully.",
      });
    } catch (error) {
      console.error("Error uploading image:", error);
      toast({
        title: "Upload failed",
        description: "Failed to upload background image.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveBackground = () => {
    setBackgroundUrl(null);
  };

  const handleSave = async () => {
    if (!effectiveLocationId) return;
    
    setLoading(true);
    try {
      const settingsData = {
        punch_clock_background_url: backgroundUrl,
        punch_clock_overlay_text: overlayText || null,
        punch_clock_text_color: textColor,
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

      toast({
        title: "Success",
        description: "Punch clock settings saved successfully.",
      });
    } catch (error) {
      console.error("Error saving punch clock settings:", error);
      toast({
        title: "Error",
        description: "Failed to save punch clock settings.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!effectiveLocationId) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Image className="h-5 w-5" />
          Punch Clock Customization
        </CardTitle>
        <CardDescription>
          Customize the punch clock display with your own background and message
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Background Image */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Background Image
          </Label>
          
          {backgroundUrl ? (
            <div className="relative">
              <div 
                className="w-full h-40 rounded-lg bg-cover bg-center border"
                style={{ backgroundImage: `url(${backgroundUrl})` }}
              >
                {overlayText && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span 
                      className="text-2xl font-bold drop-shadow-lg"
                      style={{ color: textColor }}
                    >
                      {overlayText}
                    </span>
                  </div>
                )}
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="absolute top-2 right-2"
                onClick={handleRemoveBackground}
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
            onChange={handleImageUpload}
            disabled={uploading}
          />
          
          {!backgroundUrl && (
            <Button 
              variant="outline" 
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading..." : "Upload Image"}
            </Button>
          )}
        </div>

        {/* Text Overlay */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <Type className="h-4 w-4" />
            Text Overlay
          </Label>
          <Input
            value={overlayText}
            onChange={(e) => setOverlayText(e.target.value)}
            placeholder="e.g., Welcome to Our Team!"
            maxLength={50}
          />
          <p className="text-xs text-muted-foreground">
            This text will appear over the background image
          </p>
        </div>

        {/* Text Color */}
        <div className="space-y-3">
          <Label>Text Color</Label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={textColor}
              onChange={(e) => setTextColor(e.target.value)}
              className="w-10 h-10 rounded border cursor-pointer"
            />
            <Input
              value={textColor}
              onChange={(e) => setTextColor(e.target.value)}
              className="w-28"
              placeholder="#FFFFFF"
            />
          </div>
        </div>

        {/* Birthday Events Toggle */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
          <div className="flex items-center gap-3">
            <Cake className="h-5 w-5 text-primary" />
            <div>
              <Label>Birthday Events on Schedule</Label>
              <p className="text-xs text-muted-foreground">
                Show employee birthdays on the punch clock and schedule
              </p>
            </div>
          </div>
          <Switch
            checked={birthdayEventsEnabled}
            onCheckedChange={setBirthdayEventsEnabled}
          />
        </div>

        <Button onClick={handleSave} disabled={loading}>
          {loading ? "Saving..." : "Save Punch Clock Settings"}
        </Button>
      </CardContent>
    </Card>
  );
};
