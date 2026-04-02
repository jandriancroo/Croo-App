import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MapPin, ArrowLeft, Save, Shield, CalendarIcon, X } from 'lucide-react';
import { LocationMap } from '@/components/settings/LocationMap';
import { LaborRulesSection } from '@/components/settings/LaborRulesSection';
import { IntegrationsSection } from '@/components/settings/IntegrationsSection';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { format } from 'date-fns';

const TIMEZONES = [
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HT)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
];

const DAYS_OF_WEEK = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];

interface DayHours {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

export default function LocationProfile() {
  const { locationId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const { user } = useAuth();
  const { isSuperAdmin } = useUserRole();
  const isNew = locationId === 'new';
  const orgId = searchParams.get('org');
  
  const [location, setLocation] = useState<any>(isNew ? { name: '', address: '', location_type: 'standard' } : null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  // Settings state (merged from LocationSettingsSection)
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [blackoutDates, setBlackoutDates] = useState<Date[]>([]);
  const [businessHours, setBusinessHours] = useState<DayHours[]>(
    DAYS_OF_WEEK.map(day => ({
      day_of_week: day.value,
      open_time: "11:00",
      close_time: "22:00",
      is_closed: false,
    }))
  );

  // Scroll to hash section on load
  useEffect(() => {
    if (routerLocation.hash && !loading) {
      const elementId = routerLocation.hash.replace('#', '');
      setTimeout(() => {
        const element = document.getElementById(elementId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }, [routerLocation.hash, loading]);

  useEffect(() => {
    if (locationId && !isNew) {
      fetchLocation();
      fetchLocationSettings();
      fetchBusinessHours();
    }
  }, [locationId, isNew]);

  const fetchLocation = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('id', locationId)
        .single();

      if (error) throw error;
      setLocation(data);
    } catch (error: any) {
      console.error('Error fetching location:', error);
      toast.error('Failed to load location');
      navigate('/settings');
    } finally {
      setLoading(false);
    }
  };

  const fetchLocationSettings = async () => {
    if (!locationId) return;
    try {
      const { data, error } = await supabase
        .from("location_settings")
        .select("*")
        .eq("location_id", locationId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setTimezone(data.timezone || "America/Los_Angeles");
        setBlackoutDates(
          data.blackout_dates ? data.blackout_dates.map((d: string) => new Date(d)) : []
        );
      }
    } catch (error) {
      console.error("Error fetching location settings:", error);
    }
  };

  const fetchBusinessHours = async () => {
    if (!locationId) return;
    try {
      const { data, error } = await supabase
        .from("location_hours")
        .select("*")
        .eq("location_id", locationId)
        .order("day_of_week");

      if (error) throw error;

      if (data && data.length > 0) {
        setBusinessHours(
          DAYS_OF_WEEK.map(day => {
            const existing = data.find(d => d.day_of_week === day.value);
            return existing
              ? {
                  day_of_week: existing.day_of_week,
                  open_time: existing.open_time || "11:00",
                  close_time: existing.close_time || "22:00",
                  is_closed: existing.is_closed,
                }
              : {
                  day_of_week: day.value,
                  open_time: "11:00",
                  close_time: "22:00",
                  is_closed: false,
                };
          })
        );
      }
    } catch (error) {
      console.error("Error fetching business hours:", error);
    }
  };

  const updateDayHours = (dayOfWeek: number, field: keyof DayHours, value: string | boolean) => {
    setBusinessHours(prev =>
      prev.map(day =>
        day.day_of_week === dayOfWeek ? { ...day, [field]: value } : day
      )
    );
  };

  // Geocode address to get coordinates
  const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
    if (!address.trim()) return null;
    
    try {
      let response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=us`,
        { headers: { 'User-Agent': 'CrooHQ/1.0' } }
      );
      let data = await response.json();
      
      if (!data || data.length === 0) {
        const simplified = address.replace(/\s*(suite|ste|unit|apt|#)\s*\d+\w*/gi, '').trim();
        response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(simplified)}&limit=1&countrycodes=us`,
          { headers: { 'User-Agent': 'CrooHQ/1.0' } }
        );
        data = await response.json();
      }
      
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
        };
      }
      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  };

  const handleSave = async () => {
    if (!location || !location.name.trim()) {
      toast.error('Please enter a location name');
      return;
    }

    try {
      setSaving(true);
      
      // Geocode address if provided and coordinates not set
      let coordinates = { lat: location.latitude, lng: location.longitude };
      if (location.address?.trim() && (!location.latitude || !location.longitude)) {
        toast.info('Looking up address coordinates...');
        const geocoded = await geocodeAddress(location.address);
        if (geocoded) {
          coordinates = { lat: geocoded.lat, lng: geocoded.lng };
        }
      }
      
      if (isNew) {
        // Create new location
        const { data: newLocation, error: createError } = await supabase
          .from('locations')
          .insert({
            name: location.name.trim(),
            address: location.address?.trim() || null,
            latitude: coordinates.lat || null,
            longitude: coordinates.lng || null,
            location_type: location.location_type || 'standard',
            organization_id: orgId || null,
            created_by: user?.id,
            store_number: location.store_number?.trim() || null,
          })
          .select()
          .single();

        if (createError) throw createError;

        // Assign current user to the new location
        if (user?.id && newLocation) {
          await supabase.from('user_locations').insert({
            user_id: user.id,
            location_id: newLocation.id,
          });

          // Create default location settings
          await supabase.from('location_settings').insert({
            location_id: newLocation.id,
            timezone: 'America/Los_Angeles',
          });
        }

        toast.success('Location created successfully');
        navigate(`/location/${newLocation.id}`);
      } else {
        // 1. Save location info
        const { error } = await supabase
          .from('locations')
          .update({
            name: location.name.trim(),
            address: location.address?.trim() || null,
            latitude: coordinates.lat ? parseFloat(String(coordinates.lat)) : null,
            longitude: coordinates.lng ? parseFloat(String(coordinates.lng)) : null,
            store_number: location.store_number?.trim() || null,
          })
          .eq('id', location.id);

        if (error) throw error;

        // 2. Save location settings (timezone, blackout dates)
        const settingsData = {
          timezone,
          blackout_dates: blackoutDates.map(d => format(d, "yyyy-MM-dd")),
        };

        if (settingsId) {
          const { error: settingsError } = await supabase
            .from("location_settings")
            .update({ ...settingsData, updated_at: new Date().toISOString() })
            .eq("location_id", locationId);
          if (settingsError) throw settingsError;
        } else {
          const { data: newSettings, error: settingsError } = await supabase
            .from("location_settings")
            .insert({ location_id: locationId, ...settingsData })
            .select()
            .single();
          if (settingsError) throw settingsError;
          if (newSettings) setSettingsId(newSettings.id);
        }

        // 3. Save business hours
        for (const dayHours of businessHours) {
          const { error: hoursError } = await supabase
            .from("location_hours")
            .upsert({
              location_id: locationId,
              day_of_week: dayHours.day_of_week,
              open_time: dayHours.is_closed ? null : dayHours.open_time,
              close_time: dayHours.is_closed ? null : dayHours.close_time,
              is_closed: dayHours.is_closed,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'location_id,day_of_week',
            });
          if (hoursError) throw hoursError;
        }

        toast.success('Location settings saved');
        fetchLocation();
      }
    } catch (error: any) {
      console.error('Error saving location:', error);
      toast.error(error.message || 'Failed to save location');
    } finally {
      setSaving(false);
    }
  };


  const addBlackoutDate = (date: Date | undefined) => {
    if (!date) return;
    const exists = blackoutDates.some(
      d => format(d, "yyyy-MM-dd") === format(date, "yyyy-MM-dd")
    );
    if (!exists) {
      setBlackoutDates([...blackoutDates, date]);
    }
  };

  const removeBlackoutDate = (dateToRemove: Date) => {
    setBlackoutDates(
      blackoutDates.filter(
        d => format(d, "yyyy-MM-dd") !== format(dateToRemove, "yyyy-MM-dd")
      )
    );
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading location...</p>
        </div>
      </Layout>
    );
  }

  if (!location && !isNew) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Location not found</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6 max-w-3xl mx-auto overflow-x-hidden">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => orgId ? navigate(`/organization/${orgId}`) : navigate('/settings')} 
            className="mt-1 flex-shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <MapPin className="h-6 w-6 sm:h-8 sm:w-8 text-primary flex-shrink-0" />
              <span className="truncate">{isNew ? 'New Location' : location?.name}</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              {isNew ? 'Create a new location' : 'Manage location settings'}
            </p>
          </div>
        </div>

        {/* Map */}
        {!isNew && location?.latitude && location?.longitude && (
          <div className="w-full h-40 sm:h-48 rounded-lg overflow-hidden border shadow-sm">
            <LocationMap 
              lat={parseFloat(location.latitude)} 
              lng={parseFloat(location.longitude)}
              locationName={location.name}
            />
          </div>
        )}

        <div className="grid gap-6">
          {/* Unified Location Settings Card */}
          <Card>
            <CardHeader>
              <CardTitle>Location Settings</CardTitle>
              <CardDescription>
                {isNew ? 'Enter details for the new location' : 'Configure location details, hours, and preferences'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Location Information */}
              <div className="space-y-4">
                <Label className="text-base font-semibold">General Information</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="location-name">Location Name</Label>
                    <Input
                      id="location-name"
                      value={location?.name || ''}
                      onChange={(e) => setLocation({...location, name: e.target.value})}
                      placeholder="e.g., Downtown Store"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="store-number">Store Number</Label>
                    <Input
                      id="store-number"
                      value={location?.store_number || ''}
                      onChange={(e) => setLocation({...location, store_number: e.target.value})}
                      placeholder="e.g., 1234"
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional franchise store number
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location-address">Address</Label>
                  <Textarea
                    id="location-address"
                    placeholder="123 Main St, City, State ZIP"
                    value={location?.address || ''}
                    onChange={(e) => setLocation({...location, address: e.target.value})}
                  />
                </div>
                
                {isNew && (
                  <div className="space-y-2">
                    <Label htmlFor="location-type">Location Type</Label>
                    <Select 
                      value={location?.location_type || 'standard'} 
                      onValueChange={(value) => setLocation({...location, location_type: value})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard (Full Features)</SelectItem>
                        <SelectItem value="checklist_only">Checklist Only</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Checklist Only locations have simplified navigation and features
                    </p>
                  </div>
                )}
              </div>

              {/* Timezone - only for existing locations */}
              {!isNew && (
                <>
                  <div className="border-t pt-6 space-y-3">
                    <Label className="text-base font-semibold">Timezone</Label>
                    <Select value={timezone} onValueChange={setTimezone}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>
                            {tz.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Business Hours */}
                  <div className="border-t pt-6 space-y-3">
                    <Label className="text-base font-semibold">Business Hours</Label>
                    <p className="text-sm text-muted-foreground">
                      Set opening and closing times for each day of the week
                    </p>
                    <div className="space-y-2">
                      {DAYS_OF_WEEK.map((day) => {
                        const dayHours = businessHours.find(d => d.day_of_week === day.value);
                        return (
                          <div key={day.value} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                            <span className="w-9 shrink-0 text-sm font-medium">{day.short}</span>
                            <Switch
                              checked={!dayHours?.is_closed}
                              onCheckedChange={(checked) => updateDayHours(day.value, 'is_closed', !checked)}
                            />
                            {dayHours?.is_closed ? (
                              <span className="text-xs text-muted-foreground">Closed</span>
                            ) : (
                              <div className="flex items-center gap-1 min-w-0 flex-1">
                                <Input
                                  type="time"
                                  value={dayHours?.open_time || "11:00"}
                                  onChange={(e) => updateDayHours(day.value, 'open_time', e.target.value)}
                                  className="flex-1 min-w-0 h-8 text-sm"
                                />
                                <span className="text-muted-foreground text-xs shrink-0">-</span>
                                <Input
                                  type="time"
                                  value={dayHours?.close_time || "22:00"}
                                  onChange={(e) => updateDayHours(day.value, 'close_time', e.target.value)}
                                  className="flex-1 min-w-0 h-8 text-sm"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Blackout Dates */}
                  <div className="border-t pt-6 space-y-3">
                    <Label className="text-base font-semibold">Blackout Dates</Label>
                    <p className="text-sm text-muted-foreground">
                      Days when employees should not request time off (holidays, busy periods, etc.)
                    </p>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          Add Blackout Date
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          onSelect={addBlackoutDate}
                        />
                      </PopoverContent>
                    </Popover>

                    {blackoutDates.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {blackoutDates
                          .sort((a, b) => a.getTime() - b.getTime())
                          .map((date, index) => (
                            <div
                              key={index}
                              className="flex items-center gap-1 bg-destructive/10 text-destructive px-3 py-1 rounded-md"
                            >
                              <span className="text-sm">{format(date, "MMM d, yyyy")}</span>
                              <button
                                onClick={() => removeBlackoutDate(date)}
                                className="hover:bg-destructive/20 rounded-sm p-0.5"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Super Admin Only: Location Type Toggle for existing locations */}
              {!isNew && isSuperAdmin && (
                <div className="border-t pt-6 space-y-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <Label className="text-sm font-medium">Full Features Mode</Label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm text-muted-foreground">
                        {location?.location_type === 'standard' 
                          ? 'This location has access to all features'
                          : 'This location is limited to checklists only'}
                      </p>
                    </div>
                    <Switch
                      checked={location?.location_type === 'standard'}
                      onCheckedChange={async (checked) => {
                        const newType = checked ? 'standard' : 'checklist_only';
                        try {
                          const { error } = await supabase
                            .from('locations')
                            .update({ location_type: newType })
                            .eq('id', locationId);
                          
                          if (error) throw error;
                          
                          setLocation({ ...location, location_type: newType });
                          toast.success(`Location ${checked ? 'upgraded to full features' : 'set to checklist only'}`);
                        } catch (error: any) {
                          console.error('Error updating location type:', error);
                          toast.error('Failed to update location type');
                        }
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Super admin only setting
                  </p>
                </div>
              )}
              

              {/* Unified Save Button */}
              <div className="border-t pt-6">
                <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? 'Saving...' : isNew ? 'Create Location' : 'Save All Settings'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Labor Rules - only for existing standard locations */}
          {!isNew && location?.location_type !== 'checklist_only' && (
            <LaborRulesSection locationId={locationId} />
          )}

          {/* Integrations - at bottom, for all existing locations */}
          {!isNew && (
            <IntegrationsSection locationId={locationId} />
          )}
        </div>
      </div>
    </Layout>
  );
}
