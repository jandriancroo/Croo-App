import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { toast } from 'sonner';
import { Loader2, MapPin, Clock, CheckCircle2, Building2, Rocket, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';

const TIMEZONES = [
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Indiana/Indianapolis', label: 'Indiana (ET, no DST history)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
];

// Auto-detect timezone from US state abbreviation
const STATE_TIMEZONE_MAP: Record<string, string> = {
  // Pacific
  CA: 'America/Los_Angeles', WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  // Mountain
  CO: 'America/Denver', MT: 'America/Denver', WY: 'America/Denver', UT: 'America/Denver',
  NM: 'America/Denver', ID: 'America/Denver',
  // Central
  TX: 'America/Chicago', IL: 'America/Chicago', MN: 'America/Chicago', WI: 'America/Chicago',
  IA: 'America/Chicago', MO: 'America/Chicago', AR: 'America/Chicago', LA: 'America/Chicago',
  MS: 'America/Chicago', AL: 'America/Chicago', TN: 'America/Chicago', KS: 'America/Chicago',
  NE: 'America/Chicago', SD: 'America/Chicago', ND: 'America/Chicago', OK: 'America/Chicago',
  // Eastern
  NY: 'America/New_York', FL: 'America/New_York', PA: 'America/New_York', OH: 'America/New_York',
  GA: 'America/New_York', NC: 'America/New_York', SC: 'America/New_York', VA: 'America/New_York',
  NJ: 'America/New_York', MA: 'America/New_York', MD: 'America/New_York', CT: 'America/New_York',
  MI: 'America/New_York', ME: 'America/New_York', NH: 'America/New_York', RI: 'America/New_York',
  VT: 'America/New_York', DE: 'America/New_York', WV: 'America/New_York', DC: 'America/New_York',
  KY: 'America/New_York',
  // Indiana — special case
  IN: 'America/Indiana/Indianapolis',
  // Arizona — no DST
  AZ: 'America/Phoenix',
  // Alaska & Hawaii
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};

function detectTimezoneFromAddress(addr: string): string | null {
  const stateMatch = addr.match(/\b([A-Z]{2})\s*\.?\s*\d{5}/i)
    || addr.match(/,\s*([A-Z]{2})\s*$/i)
    || addr.match(/,\s*([A-Z]{2})\s+/i);
  if (stateMatch) {
    const code = stateMatch[1].toUpperCase();
    return STATE_TIMEZONE_MAP[code] || null;
  }
  return null;
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
];

interface DayHours {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

interface DeployLocationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const STEPS = [
  { id: 'basics', label: 'Basics', icon: MapPin },
  { id: 'hours', label: 'Hours', icon: Clock },
  { id: 'review', label: 'Deploy', icon: Rocket },
];

export function DeployLocationWizard({ open, onOpenChange, onSuccess }: DeployLocationWizardProps) {
  const { refetchLocations } = useLocation();
  const [step, setStep] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [deployComplete, setDeployComplete] = useState(false);

  // Step 1: Basics
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [storeNumber, setStoreNumber] = useState('');
  const [vendorTerritory, setVendorTerritory] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [orgId, setOrgId] = useState('');
  const [timezone, setTimezone] = useState('America/Los_Angeles');

  // Step 2: Hours
  const [hours, setHours] = useState<DayHours[]>(
    DAYS_OF_WEEK.map(d => ({
      day_of_week: d.value,
      open_time: '10:00',
      close_time: '22:00',
      is_closed: false,
    }))
  );

  // Fetch organizations
  const { data: organizations } = useQuery({
    queryKey: ['all-organizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch existing vendor territories for autocomplete
  const { data: existingTerritories } = useQuery({
    queryKey: ['vendor-territories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('vendor_territory')
        .not('vendor_territory', 'is', null);
      if (error) throw error;
      const unique = [...new Set(data.map(d => d.vendor_territory).filter(Boolean))] as string[];
      return unique.sort();
    },
    enabled: open,
  });

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(0);
      setDeploying(false);
      setDeployComplete(false);
      setName('');
      setAddress('');
      setStoreNumber('');
      setVendorTerritory('');
      setLat('');
      setLng('');
      setOrgId('');
      setTimezone('America/Los_Angeles');
      setHours(DAYS_OF_WEEK.map(d => ({
        day_of_week: d.value,
        open_time: '10:00',
        close_time: '22:00',
        is_closed: false,
      })));
    }
  }, [open]);

  const updateDayHours = (dayIndex: number, field: keyof DayHours, value: any) => {
    setHours(prev => prev.map((h, i) => i === dayIndex ? { ...h, [field]: value } : h));
  };

  const canProceed = () => {
    if (step === 0) return name.trim().length > 0 && orgId.length > 0 && address.trim().length > 0;
    return true;
  };

  // Auto-detect timezone when address changes
  useEffect(() => {
    if (address.trim().length > 5) {
      const detected = detectTimezoneFromAddress(address);
      if (detected) {
        setTimezone(detected);
      }
    }
  }, [address]);

  const handleDeploy = async () => {
    setDeploying(true);
    try {
      // 1. Create the location
      const { data: location, error: locError } = await supabase
        .from('locations')
        .insert({
          name: name.trim(),
          address: address.trim() || null,
          latitude: lat ? parseFloat(lat) : null,
          longitude: lng ? parseFloat(lng) : null,
          organization_id: orgId || null,
          store_number: storeNumber.trim() || null,
          vendor_territory: vendorTerritory.trim() || null,
        })
        .select('id')
        .single();

      if (locError) throw locError;
      const locationId = location.id;

      // 2. Create location settings (timezone)
      const { error: settingsError } = await supabase
        .from('location_settings')
        .insert({
          location_id: locationId,
          timezone,
          hours_open: hours.find(h => !h.is_closed)?.open_time || '10:00',
          hours_close: hours.find(h => !h.is_closed)?.close_time || '22:00',
        });

      if (settingsError) console.error('Settings error:', settingsError);

      // 3. Create business hours
      for (const dayHours of hours) {
        const { error: hoursError } = await supabase
          .from('location_hours')
          .upsert({
            location_id: locationId,
            day_of_week: dayHours.day_of_week,
            open_time: dayHours.open_time,
            close_time: dayHours.close_time,
            is_closed: dayHours.is_closed,
          });
        if (hoursError) console.error('Hours error:', hoursError);
      }

      // 4. Auto-deploy brand event categories
      try {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('brand_id')
          .eq('id', orgId)
          .single();

        if (orgData?.brand_id) {
          const { data: brandCategories } = await supabase
            .from('brand_event_categories')
            .select('name, color')
            .eq('brand_id', orgData.brand_id);

          if (brandCategories && brandCategories.length > 0) {
            const categoriesToInsert = brandCategories.map(bc => ({
              name: bc.name,
              color: bc.color,
              location_id: locationId,
            }));

            await supabase.from('event_categories').insert(categoriesToInsert);
          }
        }
      } catch (autoDeployError) {
        console.error('Auto-deploy event categories error:', autoDeployError);
      }

      // 5. Auto-apply labor rule preset based on state in address
      try {
        const stateMatch = address.match(/\b([A-Z]{2})\s*\.?\s*\d{5}/i) 
          || address.match(/,\s*([A-Z]{2})\s*$/i)
          || address.match(/,\s*([A-Z]{2})\s+/i);
        
        if (stateMatch) {
          const stateCode = stateMatch[1].toUpperCase();
          const { data: preset } = await supabase
            .from('labor_rule_presets')
            .select('*')
            .eq('state_code', stateCode)
            .limit(1)
            .maybeSingle();

          if (preset) {
            await supabase.from('labor_rules').insert({
              location_id: locationId,
              rule_name: preset.preset_name,
              state_code: preset.state_code,
              daily_overtime_threshold: preset.daily_overtime_threshold,
              daily_double_time_threshold: preset.daily_double_time_threshold,
              weekly_overtime_threshold: preset.weekly_overtime_threshold,
              overtime_multiplier: preset.overtime_multiplier,
              double_time_multiplier: preset.double_time_multiplier,
              meal_break_hours: preset.meal_break_hours,
              meal_break_duration: preset.meal_break_duration,
              rest_break_hours: preset.rest_break_hours,
              rest_break_duration: preset.rest_break_duration,
              reporting_time_enabled: preset.reporting_time_enabled,
              reporting_time_min_hours: preset.reporting_time_min_hours,
              reporting_time_max_hours: preset.reporting_time_max_hours,
            });
            console.log(`Auto-applied ${preset.preset_name} labor rules for ${stateCode}`);
          }
        }
      } catch (laborPresetError) {
        console.error('Auto-apply labor preset error:', laborPresetError);
        // Non-blocking
      }

      // 6. Auto-activate brand inventory items via edge function
      try {
        const { data: orgData2 } = await supabase
          .from('organizations')
          .select('brand_id')
          .eq('id', orgId)
          .single();

        if (orgData2?.brand_id) {
          const { data: invResult, error: invError } = await supabase.functions.invoke(
            'deploy-location-inventory',
            { body: { locationId, brandId: orgData2.brand_id } }
          );
          if (invError) {
            console.error('Inventory auto-deploy error:', invError);
          } else {
            console.log('Inventory auto-deploy result:', invResult);
          }
        }
      } catch (invDeployErr) {
        console.error('Inventory auto-deploy error:', invDeployErr);
        // Non-blocking — location is still created
      }

      // 7. Auto-seed default logbook categories (Waste Log)
      try {
        await supabase.from('logbook_categories').insert({
          name: 'Waste Log',
          location_id: locationId,
          display_order: 99,
          is_active: true,
          alert_enabled: true,
        });
      } catch (e) {
        console.error('Auto-seed Waste Log category error:', e);
      }

      refetchLocations();
      toast.success(`${name} deployed successfully!`);
    } catch (error: any) {
      console.error('Deploy error:', error);
      toast.error(error.message || 'Failed to deploy location');
    } finally {
      setDeploying(false);
    }
  };

  const handleClose = () => {
    if (deployComplete) onSuccess();
    onOpenChange(false);
  };

  const orgName = organizations?.find(o => o.id === orgId)?.name;
  const tzLabel = TIMEZONES.find(t => t.value === timezone)?.label;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            Deploy New Location
          </DialogTitle>
          <DialogDescription>
            Set up everything your new location needs to go live
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        {!deployComplete && (
          <div className="flex items-center gap-1 px-1">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isActive = i === step;
              const isDone = i < step;
              return (
                <div key={s.id} className="flex items-center flex-1">
                  <button
                    onClick={() => i < step && setStep(i)}
                    disabled={i > step}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all w-full justify-center',
                      isActive && 'bg-primary text-primary-foreground',
                      isDone && 'bg-primary/10 text-primary cursor-pointer',
                      !isActive && !isDone && 'bg-muted text-muted-foreground'
                    )}
                  >
                    {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className={cn('h-px w-4 mx-1', i < step ? 'bg-primary' : 'bg-border')} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <AnimatePresence mode="wait">
          {deployComplete ? (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 py-8"
            >
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold">{name} is live!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Switch to this location to start configuring checklists, inventory, and invite your team.
                </p>
              </div>
              <Button onClick={handleClose} className="mt-2">Done</Button>
            </motion.div>
          ) : (
            <motion.div
              key={`step-${step}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
            >
              {/* Step 1: Basics */}
              {step === 0 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Organization *</Label>
                    <Select value={orgId} onValueChange={setOrgId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select organization" />
                      </SelectTrigger>
                      <SelectContent>
                        {organizations?.map(org => (
                          <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Location Name *</Label>
                    <Input
                      placeholder="e.g., Downtown Store"
                      value={name}
                      onChange={e => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Store Number</Label>
                    <Input
                      placeholder="e.g., #1234"
                      value={storeNumber}
                      onChange={e => setStoreNumber(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Address *</Label>
                    <Textarea
                      placeholder="123 Main St, City, State ZIP"
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      rows={2}
                    />
                    <p className="text-[10px] text-muted-foreground">Required — used to auto-detect timezone and labor rules</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Timezone</Label>
                    <Select value={timezone} onValueChange={setTimezone}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map(tz => (
                          <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Vendor Territory</Label>
                    <Input
                      placeholder="e.g., PFG-SoCal"
                      value={vendorTerritory}
                      onChange={e => setVendorTerritory(e.target.value)}
                      list="vendor-territory-options"
                    />
                    <datalist id="vendor-territory-options">
                      {existingTerritories?.map(t => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                    <p className="text-[10px] text-muted-foreground">Vendor distribution region — autocompletes from existing locations</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Latitude</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        placeholder="33.7294"
                        value={lat}
                        onChange={e => setLat(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Longitude</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        placeholder="-116.9719"
                        value={lng}
                        onChange={e => setLng(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Business Hours */}
              {step === 1 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Set operating hours for each day. Toggle off for closed days.</p>
                  {hours.map((h, i) => (
                    <div key={h.day_of_week} className="flex items-center gap-2">
                      <div className="w-12 text-sm font-medium">{DAYS_OF_WEEK[i].short}</div>
                      <Switch
                        checked={!h.is_closed}
                        onCheckedChange={checked => updateDayHours(i, 'is_closed', !checked)}
                      />
                      {!h.is_closed ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <Input
                            type="time"
                            value={h.open_time}
                            onChange={e => updateDayHours(i, 'open_time', e.target.value)}
                            className="h-8 text-xs"
                          />
                          <span className="text-xs text-muted-foreground">to</span>
                          <Input
                            type="time"
                            value={h.close_time}
                            onChange={e => updateDayHours(i, 'close_time', e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground flex-1">Closed</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Step 3: Review & Deploy */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{orgName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <span className="text-sm font-medium">{name}</span>
                        {storeNumber && <span className="text-xs text-muted-foreground ml-1.5">({storeNumber})</span>}
                        {address && <p className="text-xs text-muted-foreground">{address}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{tzLabel}</span>
                    </div>
                    {vendorTerritory && (
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Territory: {vendorTerritory}</span>
                      </div>
                    )}
                    <div className="border-t pt-3">
                      <p className="text-xs font-medium mb-1.5">Business Hours</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                        {hours.map((h, i) => (
                          <div key={h.day_of_week} className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{DAYS_OF_WEEK[i].short}</span>
                            <span>{h.is_closed ? 'Closed' : `${h.open_time}–${h.close_time}`}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
                    <p className="text-xs text-muted-foreground">
                      <strong>What happens next:</strong> Brand event categories, state-specific labor rules, and all brand inventory items will be auto-deployed. Only your Super Admin account will be assigned. 
                      Switch to the new location to invite team members, set up checklists, organize storage locations, and connect integrations.
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        {!deployComplete && (
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button variant="outline" onClick={() => step === 0 ? handleClose() : setStep(s => s - 1)}>
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(s => s + 1)} disabled={!canProceed()}>
                Next
              </Button>
            ) : (
              <Button onClick={handleDeploy} disabled={deploying}>
                {deploying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Deploy Location
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
