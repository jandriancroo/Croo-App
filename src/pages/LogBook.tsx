import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Paperclip, Search, User, Settings, MoreVertical, Trash2, Pencil, Plus, Upload, ChevronLeft, FileText, DollarSign, ClipboardList, AlertTriangle, Package, Truck, MessageSquare, ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { useUserRole } from "@/hooks/useUserRole";
import { ManageCategoriesDialog } from "@/components/logbook/ManageCategoriesDialog";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { compressImage } from "@/utils/imageCompression";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { DrawerCountForm, DrawerCountData } from "@/components/logbook/DrawerCountForm";
import { DrawerCountEntry, parseDrawerCountData } from "@/components/logbook/DrawerCountEntry";
import { SafeCountForm, SafeCountData } from "@/components/logbook/SafeCountForm";
import { SafeCountEntry, parseSafeCountData, checkBankRunCompleted, checkNeedsBankRun } from "@/components/logbook/SafeCountEntry";
import { WeeklySummaryEntry, parseWeeklySummaryData } from "@/components/logbook/WeeklySummaryEntry";
import { CateringOrdersSection } from "@/components/logbook/CateringOrdersSection";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { startOfWeek, endOfWeek, getDay, subDays } from "date-fns";
import crooLogo from "@/assets/croo-logo.png";

export default function LogBook() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, isManager, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { getDateInTimezone } = useLocationTimezone();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<string>("search");
  const [showNewEntrySheet, setShowNewEntrySheet] = useState(false);
  const [wizardStep, setWizardStep] = useState<'category' | 'form'>('category');
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);
  const [showCateringUpload, setShowCateringUpload] = useState(false);
  const [preselectedShift, setPreselectedShift] = useState<'AM' | 'PM' | null>(null);
  const [isSavingSpecialForm, setIsSavingSpecialForm] = useState(false);
  const navigate = useNavigate();

  // Redirect team members away from logs page
  useEffect(() => {
    if (!roleLoading && !isAdmin && !isManager) {
      toast({ title: "Access denied", description: "You don't have permission to view logs", variant: "destructive" });
      navigate('/dashboard');
    }
  }, [roleLoading, isAdmin, isManager, navigate, toast]);

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['logbook-categories', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('logbook_categories')
        .select('*')
        .eq('is_active', true)
        .eq('location_id', currentLocation.id)
        .order('display_order');
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation,
  });

  // Fetch location settings for safe/drawer targets and notification settings
  const { data: locationSettings } = useQuery({
    queryKey: ['location-settings', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return null;
      const { data, error } = await supabase
        .from('location_settings')
        .select('safe_target, drawer_bank, drawer_count_notifications_enabled, safe_count_notifications_enabled')
        .eq('location_id', currentLocation.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation,
  });

  // Set initial category or handle URL parameter
  useEffect(() => {
    const categoryParam = searchParams.get('category');
    const shiftParam = searchParams.get('shift')?.toUpperCase() as 'AM' | 'PM' | undefined;
    
    if (categoryParam && categories.length > 0) {
      // Find category by name (case-insensitive)
      const matchedCategory = categories.find(
        (c: any) => c.name?.toLowerCase() === categoryParam.toLowerCase()
      );
      if (matchedCategory) {
        setSelectedCategory(matchedCategory.id);
        // Stay on 'search' tab so the Sheet can be displayed
        setActiveTab('search');
        // Auto-open the entry sheet and go directly to form step
        setShowNewEntrySheet(true);
        setWizardStep('form');
        // Set preselected shift if provided
        if (shiftParam === 'AM' || shiftParam === 'PM') {
          setPreselectedShift(shiftParam);
        }
        // Clear the URL params after setting
        setSearchParams({});
      }
    } else if (!selectedCategory && categories.length > 0) {
      setSelectedCategory(categories[0].id);
    }
  }, [categories, selectedCategory, searchParams, setSearchParams]);

  // Handle navigation from alert link
  useEffect(() => {
    const fromAlert = searchParams.get('fromAlert');
    if (fromAlert === 'true') {
      setActiveTab('search');
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  // Fetch fields for selected category
  const { data: fields = [] } = useQuery({
    queryKey: ['logbook-fields', selectedCategory],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('logbook_fields')
        .select('*')
        .eq('category_id', selectedCategory)
        .order('display_order');
      if (error) throw error;
      return data;
    },
    enabled: !!selectedCategory,
  });

  // Fetch entry for selected date and category
  const { data: entry } = useQuery({
    queryKey: ['logbook-entry', selectedCategory, getDateInTimezone(selectedDate)],
    queryFn: async () => {
      const dateStr = getDateInTimezone(selectedDate);
      const { data, error } = await supabase
        .from('logbook_entries')
        .select(`
          *,
          logbook_entry_values(*),
          profiles(full_name, profile_photo_url)
        `)
        .eq('category_id', selectedCategory)
        .eq('entry_date', dateStr)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!selectedCategory,
  });

  // Fetch all entries for search
  const { data: allEntries = [] } = useQuery({
    queryKey: ['logbook-all-entries', searchQuery, currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      let query = supabase
        .from('logbook_entries')
        .select(`
          *,
          logbook_entry_values(*),
          profiles(full_name, profile_photo_url),
          logbook_categories(name)
        `)
        .eq('location_id', currentLocation.id)
        .order('created_at', { ascending: false })
        .limit(50);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation,
  });

  // Find safe count category ID
  const safeCountCategoryId = categories.find((c: any) => c.name?.toLowerCase() === 'safe count')?.id;
  const drawerCountCategoryId = categories.find((c: any) => c.name?.toLowerCase() === 'drawer count')?.id;

  // Fetch safe count entries for selected date
  const { data: safeCountEntries = [] } = useQuery({
    queryKey: ['safe-count-entries', safeCountCategoryId, getDateInTimezone(selectedDate), currentLocation?.id],
    queryFn: async () => {
      if (!safeCountCategoryId || !currentLocation) return [];
      const dateStr = getDateInTimezone(selectedDate);
      const { data, error } = await supabase
        .from('logbook_entries')
        .select(`*, logbook_entry_values(*)`)
        .eq('category_id', safeCountCategoryId)
        .eq('entry_date', dateStr)
        .eq('location_id', currentLocation.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!safeCountCategoryId && !!currentLocation,
  });

  // Fetch drawer count entries for selected date
  const { data: drawerCountEntries = [] } = useQuery({
    queryKey: ['drawer-count-entries', drawerCountCategoryId, getDateInTimezone(selectedDate), currentLocation?.id],
    queryFn: async () => {
      if (!drawerCountCategoryId || !currentLocation) return [];
      const dateStr = getDateInTimezone(selectedDate);
      const { data, error } = await supabase
        .from('logbook_entries')
        .select(`*, logbook_entry_values(*)`)
        .eq('category_id', drawerCountCategoryId)
        .eq('entry_date', dateStr)
        .eq('location_id', currentLocation.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!drawerCountCategoryId && !!currentLocation,
  });

  // Get existing shifts from safe count entries
  const existingSafeCountShifts: ('AM' | 'PM')[] = safeCountEntries
    .map((entry: any) => {
      try {
        const data = JSON.parse(entry.logbook_entry_values?.[0]?.value_text || '{}');
        return data.shift as 'AM' | 'PM';
      } catch {
        return null;
      }
    })
    .filter((shift): shift is 'AM' | 'PM' => shift === 'AM' || shift === 'PM');

  const [formData, setFormData] = useState<Record<string, any>>({});

  // Handle file upload
  const handleFileUpload = async (fieldId: string, file: File) => {
    try {
      setUploadingFiles({ ...uploadingFiles, [fieldId]: true });
      
      // Compress images to reduce memory usage on mobile
      let fileToUpload: File | Blob = file;
      let fileName = `${user!.id}/${Date.now()}.${file.name.split('.').pop()}`;
      
      if (file.type.startsWith('image/')) {
        fileToUpload = await compressImage(file, 1200, 1200, 0.8);
        fileName = `${user!.id}/${Date.now()}.jpg`;
      }
      
      const { error: uploadError } = await supabase.storage
        .from('logbook-attachments')
        .upload(fileName, fileToUpload);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('logbook-attachments')
        .getPublicUrl(fileName);

      setFormData({ ...formData, [fieldId]: publicUrl });
      toast({ title: "File uploaded successfully" });
    } catch (error: any) {
      toast({
        title: "Error uploading file",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploadingFiles({ ...uploadingFiles, [fieldId]: false });
    }
  };

  // Save entry mutation
  const saveEntryMutation = useMutation({
    mutationFn: async () => {
      const dateStr = getDateInTimezone(selectedDate);
      
      // Create or update entry
      const { data: entryData, error: entryError } = await supabase
        .from('logbook_entries')
        .insert({
          category_id: selectedCategory,
          entry_date: dateStr,
          created_by: user!.id,
          location_id: currentLocation?.id,
        })
        .select()
        .single();

      if (entryError) throw entryError;

      // Delete existing values
      await supabase
        .from('logbook_entry_values')
        .delete()
        .eq('entry_id', entryData.id);

      // Insert new values
      const values = fields.map((field: any) => ({
        entry_id: entryData.id,
        field_id: field.id,
        value_text: field.field_type === 'text' || field.field_type === 'textarea' ? formData[field.id] : null,
        value_number: field.field_type === 'number' ? formData[field.id] : null,
        value_date: field.field_type === 'date' ? formData[field.id] : null,
        attachment_url: field.field_type === 'attachment' ? formData[field.id] : null,
      }));

      const { error: valuesError } = await supabase
        .from('logbook_entry_values')
        .insert(values);

      if (valuesError) throw valuesError;

      // Check if category has push notifications enabled and send notification
      const currentCategory = categories.find((c: any) => c.id === selectedCategory);
      if (currentCategory?.push_notification_enabled && currentLocation) {
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              notification_type: 'logbook_entry',
              title: `New Log Entry - ${currentLocation.name}`,
              body: `${currentCategory.name} entry submitted`,
              location_id: currentLocation.id,
              roles: ['admin', 'manager', 'general_manager', 'shift_manager'],
            }
          });
        } catch (notifError) {
          console.error('Failed to send push notification:', notifError);
        }
      }
    },
    onSuccess: () => {
      toast({ title: "Entry saved successfully" });
      queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-all-entries'] });
      setFormData({});
      // Navigate to search tab to show submission
      setActiveTab('search');
    },
    onError: (error: any) => {
      toast({
        title: "Error saving entry",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveEntryMutation.mutate();
  };

  // Delete entry mutation
  const deleteEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      // First delete the entry values
      const { error: valuesError } = await supabase
        .from('logbook_entry_values')
        .delete()
        .eq('entry_id', entryId);

      if (valuesError) throw valuesError;

      // Then delete the entry
      const { error: entryError } = await supabase
        .from('logbook_entries')
        .delete()
        .eq('id', entryId);

      if (entryError) throw entryError;
    },
    onSuccess: () => {
      toast({ title: "Entry deleted" });
      queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-all-entries'] });
      setDeleteEntryId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting entry",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Follow-up completion mutation
  const followupMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from('logbook_entries')
        .update({
          followup_completed_at: new Date().toISOString(),
          followup_completed_by: user?.id,
        })
        .eq('id', entryId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Follow-up completed" });
      queryClient.invalidateQueries({ queryKey: ['logbook-all-entries'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating follow-up",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const filteredEntries = allEntries.filter((entry: any) => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      entry.profiles?.full_name?.toLowerCase().includes(searchLower) ||
      entry.logbook_categories?.name?.toLowerCase().includes(searchLower) ||
      entry.logbook_entry_values?.some((val: any) => 
        val.value_text?.toLowerCase().includes(searchLower)
      )
    );
  });

  // Expand safe count entries so AM and PM appear as separate cards
  const expandedEntries = filteredEntries.flatMap((entry: any) => {
    const isSafeCount = entry.logbook_categories?.name?.toLowerCase() === 'safe count';
    
    if (isSafeCount && entry.logbook_entry_values?.length > 1) {
      // Create separate "virtual" entries for each safe count value (AM and PM)
      return entry.logbook_entry_values.map((val: any) => ({
        ...entry,
        logbook_entry_values: [val],
        _virtualId: `${entry.id}-${val.id}`, // Unique key for rendering
      }));
    }
    
    return [entry];
  });

  // Build a map of dates to their safe counts for bank run completion tracking
  // Key: date string, Value: array of safe count data for that day
  const safeCountsByDate: Record<string, SafeCountData[]> = {};
  expandedEntries.forEach((entry: any) => {
    if (entry.logbook_categories?.name?.toLowerCase() === 'safe count') {
      const dateKey = entry.entry_date;
      const safeData = entry.logbook_entry_values?.[0]?.value_text 
        ? parseSafeCountData(entry.logbook_entry_values[0].value_text) 
        : null;
      if (safeData) {
        if (!safeCountsByDate[dateKey]) {
          safeCountsByDate[dateKey] = [];
        }
        safeCountsByDate[dateKey].push(safeData);
      }
    }
  });

  // Helper to check if previous night's PM safe count needed a bank run (< $30 in $1 bills)
  const checkPreviousNightNeededBankRun = (entryDate: string): boolean => {
    const prevDate = format(subDays(new Date(entryDate + 'T12:00:00'), 1), 'yyyy-MM-dd');
    const prevDaySafeCounts = safeCountsByDate[prevDate] || [];
    // Check if ANY PM safe count from previous day needed a bank run
    return prevDaySafeCounts.some(sc => sc.shift === 'PM' && checkNeedsBankRun(sc));
  };

  // Group entries by day - use entry_date directly as it's already YYYY-MM-DD
  const entriesByDay = expandedEntries.reduce((acc: any, entry: any) => {
    const dateKey = entry.entry_date;
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(entry);
    return acc;
  }, {});

  const sortedDays = Object.keys(entriesByDay).sort((a, b) => b.localeCompare(a));

  // Render new entry content - extracted for reuse in sheet
  const renderNewEntryContent = () => {
    const currentCategoryName = categories.find((c: any) => c.id === selectedCategory)?.name?.toLowerCase();
    const isDrawerCount = currentCategoryName === 'drawer count';
    const isSafeCount = currentCategoryName === 'safe count';
    
    if (isDrawerCount) {
      return (
        <div className="space-y-4">
          <div className="flex flex-col justify-between items-start gap-3">
            <h2 className="text-lg font-semibold">Drawer Count</h2>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  <span className="text-xs sm:text-sm">{format(selectedDate, 'PPP')}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                />
              </PopoverContent>
            </Popover>
          </div>
          {entry && (
            <p className="text-xs text-muted-foreground">
              Last entry by {entry.profiles?.full_name} at {format(new Date(entry.created_at), 'PPp')}
            </p>
          )}
          <DrawerCountForm
            key={getDateInTimezone(selectedDate)}
            onSave={async (data: DrawerCountData) => {
              if (isSavingSpecialForm) return; // Prevent double-submit
              setIsSavingSpecialForm(true);
              try {
                const dateStr = getDateInTimezone(selectedDate);
                let fieldId = fields[0]?.id;
                
                if (!fieldId) {
                  const { data: newField, error: fieldError } = await supabase
                    .from('logbook_fields')
                    .insert({
                      category_id: selectedCategory,
                      field_name: 'drawer_data',
                      field_type: 'text',
                      display_order: 0,
                      is_required: false,
                    })
                    .select()
                    .single();
                  
                  if (fieldError) throw fieldError;
                  fieldId = newField.id;
                  queryClient.invalidateQueries({ queryKey: ['logbook-fields', selectedCategory] });
                }
                
                const { data: entryData, error: entryError } = await supabase
                  .from('logbook_entries')
                  .insert({
                    category_id: selectedCategory,
                    entry_date: dateStr,
                    created_by: user!.id,
                    location_id: currentLocation?.id,
                  })
                  .select()
                  .single();

                if (entryError) throw entryError;

                await supabase
                  .from('logbook_entry_values')
                  .delete()
                  .eq('entry_id', entryData.id);

                const { error: valuesError } = await supabase
                  .from('logbook_entry_values')
                  .insert({
                    entry_id: entryData.id,
                    field_id: fieldId,
                    value_text: JSON.stringify(data),
                  });

                if (valuesError) throw valuesError;

                toast({ title: "Drawer count saved successfully" });
                queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
                queryClient.invalidateQueries({ queryKey: ['logbook-all-entries'] });
                queryClient.invalidateQueries({ queryKey: ['drawer-count-entries'] });
                setShowNewEntrySheet(false);
                setActiveTab('search');

                if (locationSettings?.drawer_count_notifications_enabled !== false) {
                  try {
                    const overUnderText = data.variance > 0 
                      ? `OVER $${data.variance.toFixed(2)}` 
                      : data.variance < 0 
                        ? `SHORT $${Math.abs(data.variance).toFixed(2)}`
                        : 'BALANCED';
                    
                    await supabase.functions.invoke('send-push-notification', {
                      body: {
                        notification_type: 'drawer_count',
                        title: `Drawer Count - ${currentLocation?.name || 'Location'}`,
                        body: `Deposit: $${data.actualDeposit.toFixed(2)} | ${overUnderText}`,
                        location_id: currentLocation?.id,
                        roles: ['admin', 'general_manager', 'shift_manager', 'manager', 'super_admin'],
                      }
                    });
                  } catch (notifError) {
                    console.error('Error sending drawer count notification:', notifError);
                  }
                }

                // Trigger weekly summary generation if this is a Sunday deposit
                const dayOfWeek = getDay(selectedDate);
                if (dayOfWeek === 0 && currentLocation?.id) { // 0 = Sunday
                  try {
                    const weekStart = format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
                    const weekEnd = format(endOfWeek(selectedDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
                    
                    toast({ title: "Generating weekly summary...", description: "Please wait" });
                    
                    await supabase.functions.invoke('generate-weekly-summary', {
                      body: {
                        location_id: currentLocation.id,
                        week_start: weekStart,
                        week_end: weekEnd,
                        user_id: user!.id,
                      }
                    });
                    
                    toast({ title: "Weekly summary generated!" });
                    queryClient.invalidateQueries({ queryKey: ['logbook-all-entries'] });
                  } catch (summaryError) {
                    console.error('Error generating weekly summary:', summaryError);
                  }
                }

                // Trigger daily logbook summary email (checks if both PM Safe Count and Drawer Count are done)
                try {
                  await supabase.functions.invoke('send-daily-logbook-summary', {
                    body: {
                      location_id: currentLocation?.id,
                      entry_date: getDateInTimezone(selectedDate),
                    }
                  });
                } catch (emailError) {
                  console.error('Error triggering daily summary email:', emailError);
                }
              } catch (error: any) {
                toast({ title: "Error saving drawer count", description: error.message, variant: "destructive" });
              } finally {
                setIsSavingSpecialForm(false);
              }
            }}
            isSaving={isSavingSpecialForm}
            existingData={entry?.logbook_entry_values?.[0]?.value_text 
              ? JSON.parse(entry.logbook_entry_values[0].value_text) 
              : null}
            entryCount={drawerCountEntries.length}
            drawerBank={locationSettings?.drawer_bank ?? 200}
          />
        </div>
      );
    }

    if (isSafeCount) {
      return (
        <div className="space-y-4">
          <div className="flex flex-col justify-between items-start gap-3">
            <h2 className="text-lg font-semibold">Safe Count</h2>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  <span className="text-xs sm:text-sm">{format(selectedDate, 'PPP')}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                />
              </PopoverContent>
            </Popover>
          </div>
          {entry && (
            <p className="text-xs text-muted-foreground">
              Last entry by {entry.profiles?.full_name} at {format(new Date(entry.created_at), 'PPp')}
            </p>
          )}
          <SafeCountForm
            key={`${getDateInTimezone(selectedDate)}-${preselectedShift || ''}`}
            onSave={async (data: SafeCountData) => {
              if (isSavingSpecialForm) return; // Prevent double-submit
              setIsSavingSpecialForm(true);
              try {
                const dateStr = getDateInTimezone(selectedDate);
                let fieldId = fields[0]?.id;
                
                if (!fieldId) {
                  const { data: newField, error: fieldError } = await supabase
                    .from('logbook_fields')
                    .insert({
                      category_id: selectedCategory,
                      field_name: 'safe_data',
                      field_type: 'text',
                      display_order: 0,
                      is_required: false,
                    })
                    .select()
                    .single();
                  
                  if (fieldError) throw fieldError;
                  fieldId = newField.id;
                  queryClient.invalidateQueries({ queryKey: ['logbook-fields', selectedCategory] });
                }
                
                const { data: entryData, error: entryError } = await supabase
                  .from('logbook_entries')
                  .insert({
                    category_id: selectedCategory,
                    entry_date: dateStr,
                    created_by: user!.id,
                    location_id: currentLocation?.id,
                  })
                  .select()
                  .single();

                if (entryError) throw entryError;

                const { data: existingValues } = await supabase
                  .from('logbook_entry_values')
                  .select('id, value_text')
                  .eq('entry_id', entryData.id)
                  .eq('field_id', fieldId);
                
                if (existingValues && existingValues.length > 0) {
                  const valueIdsToDelete = existingValues
                    .filter(v => {
                      try {
                        const parsed = JSON.parse(v.value_text || '{}');
                        return parsed.shift === data.shift;
                      } catch {
                        return false;
                      }
                    })
                    .map(v => v.id);
                  
                  if (valueIdsToDelete.length > 0) {
                    await supabase
                      .from('logbook_entry_values')
                      .delete()
                      .in('id', valueIdsToDelete);
                  }
                }

                const { error: valuesError } = await supabase
                  .from('logbook_entry_values')
                  .insert({
                    entry_id: entryData.id,
                    field_id: fieldId,
                    value_text: JSON.stringify(data),
                  });

                if (valuesError) throw valuesError;

                toast({ title: "Safe count saved successfully" });
                queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
                queryClient.invalidateQueries({ queryKey: ['logbook-all-entries'] });
                queryClient.invalidateQueries({ queryKey: ['safe-count-entries'] });
                setShowNewEntrySheet(false);
                setActiveTab('search');
                // Clear preselected shift after saving
                setPreselectedShift(null);

                if (locationSettings?.safe_count_notifications_enabled !== false) {
                  try {
                    await supabase.functions.invoke('send-push-notification', {
                      body: {
                        notification_type: 'safe_count',
                        title: `Safe Count - ${currentLocation?.name || 'Location'}`,
                        body: `${data.shift} Safe Count Complete - $${data.totalSafe.toFixed(2)} balanced`,
                        location_id: currentLocation?.id,
                        roles: ['admin', 'general_manager', 'shift_manager', 'manager', 'super_admin'],
                      }
                    });
                  } catch (notifError) {
                    console.error('Error sending safe count notification:', notifError);
                  }
                }
              } catch (error: any) {
                toast({ title: "Error saving safe count", description: error.message, variant: "destructive" });
              } finally {
                setIsSavingSpecialForm(false);
              }
            }}
            isSaving={isSavingSpecialForm}
            existingShifts={existingSafeCountShifts}
            safeTarget={locationSettings?.safe_target ?? 300}
            defaultShift={preselectedShift || undefined}
          />
        </div>
      );
    }
    
    // Default generic form
    return (
      <div className="space-y-4">
        <div className="flex flex-col justify-between items-start gap-3">
          <h2 className="text-lg font-semibold">
            {categories.find((c: any) => c.id === selectedCategory)?.name}
          </h2>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="w-full">
                <CalendarIcon className="h-4 w-4 mr-2" />
                <span className="text-xs sm:text-sm">{format(selectedDate, 'PPP')}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
              />
            </PopoverContent>
          </Popover>
        </div>
        {entry && (
          <p className="text-xs text-muted-foreground">
            Entry by {entry.profiles?.full_name} at {format(new Date(entry.created_at), 'PPp')}
          </p>
        )}
        <form onSubmit={(e) => {
          e.preventDefault();
          saveEntryMutation.mutate();
          setShowNewEntrySheet(false);
        }} className="space-y-4">
          {fields.map((field: any) => (
            <div key={field.id} className="space-y-2">
              <Label>
                {field.field_name}
                {field.is_required && <span className="text-destructive ml-1">*</span>}
              </Label>
              {field.field_type === 'text' && (
                <Input
                  value={formData[field.id] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
                  required={field.is_required}
                />
              )}
              {field.field_type === 'textarea' && (
                <Textarea
                  value={formData[field.id] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
                  required={field.is_required}
                />
              )}
              {field.field_type === 'number' && (
                <Input
                  type="number"
                  value={formData[field.id] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
                  required={field.is_required}
                />
              )}
              {field.field_type === 'date' && (
                <Input
                  type="date"
                  value={formData[field.id] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
                  required={field.is_required}
                />
              )}
              {field.field_type === 'attachment' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      type="file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(field.id, file);
                      }}
                      disabled={uploadingFiles[field.id]}
                    />
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                  </div>
                  {uploadingFiles[field.id] && (
                    <p className="text-xs text-muted-foreground">Uploading...</p>
                  )}
                  {formData[field.id] && !uploadingFiles[field.id] && (
                    <a 
                      href={formData[field.id]} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      View uploaded file
                    </a>
                  )}
                </div>
              )}
              {field.field_type === 'radio' && field.options && (
                <div className="space-y-2">
                  {(field.options as string[]).map((option: string) => (
                    <label key={option} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={field.id}
                        value={option}
                        checked={formData[field.id] === option}
                        onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
                        required={field.is_required}
                        className="h-4 w-4"
                      />
                      <span className="text-sm">{option}</span>
                    </label>
                  ))}
                </div>
              )}
              {field.field_type === 'dropdown' && field.options && (
                <Select
                  value={formData[field.id] || ''}
                  onValueChange={(value) => setFormData({ ...formData, [field.id]: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.options as string[]).map((option: string) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}
          <Button type="submit" disabled={saveEntryMutation.isPending} className="w-full">
            {saveEntryMutation.isPending ? 'Saving...' : 'Add Entry'}
          </Button>
        </form>
      </div>
    );
  };

  // Don't render if role is still loading or user doesn't have access
  if (roleLoading || (!isAdmin && !isManager)) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <h1 className="text-3xl font-bold">Logs</h1>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setManageCategoriesOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Categories
            </Button>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="search">Recent Logs</TabsTrigger>
              <TabsTrigger value="catering">Catering Orders</TabsTrigger>
            </TabsList>
            
            {activeTab === 'search' && (
              <Sheet open={showNewEntrySheet} onOpenChange={(open) => {
                setShowNewEntrySheet(open);
                if (!open) setWizardStep('category'); // Reset to category step when closing
              }}>
                <SheetTrigger asChild>
                  <Button size="icon" variant="default">
                    <Plus className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
                  {wizardStep === 'category' ? (
                    <>
                      <SheetHeader>
                        <SheetTitle>Select Entry Type</SheetTitle>
                      </SheetHeader>
                      <div className="mt-6 grid grid-cols-2 gap-3">
                        {categories.map((category: any) => {
                          // Map category names to icons
                          const getCategoryIcon = (name: string) => {
                            const lower = name.toLowerCase();
                            if (lower.includes('drawer')) return <DollarSign className="h-6 w-6" />;
                            if (lower.includes('safe')) return <ShieldCheck className="h-6 w-6" />;
                            if (lower.includes('refund')) return <FileText className="h-6 w-6" />;
                            if (lower.includes('incident') || lower.includes('accident')) return <AlertTriangle className="h-6 w-6" />;
                            if (lower.includes('inventory') || lower.includes('waste')) return <Package className="h-6 w-6" />;
                            if (lower.includes('delivery') || lower.includes('catering')) return <Truck className="h-6 w-6" />;
                            if (lower.includes('note') || lower.includes('message')) return <MessageSquare className="h-6 w-6" />;
                            return <ClipboardList className="h-6 w-6" />;
                          };
                          
                          return (
                            <button
                              key={category.id}
                              onClick={() => {
                                setSelectedCategory(category.id);
                                setWizardStep('form');
                              }}
                              className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-border bg-card hover:border-primary hover:bg-accent transition-all text-center min-h-[100px]"
                            >
                              <div className="text-primary">
                                {getCategoryIcon(category.name)}
                              </div>
                              <span className="font-medium text-sm">{category.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <SheetHeader className="flex flex-row items-center gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => setWizardStep('category')}
                          className="h-8 w-8 -ml-2"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <SheetTitle className="!mt-0">
                          {categories.find((c: any) => c.id === selectedCategory)?.name || 'New Entry'}
                        </SheetTitle>
                      </SheetHeader>
                      <div className="mt-4 space-y-4">
                        {renderNewEntryContent()}
                      </div>
                    </>
                  )}
                </SheetContent>
              </Sheet>
            )}
            
            {activeTab === 'catering' && (
              <Button size="icon" variant="default" onClick={() => setShowCateringUpload(true)}>
                <Upload className="h-4 w-4" />
              </Button>
            )}
          </div>


          <TabsContent value="search" className="space-y-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search entries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>

            <div className="space-y-6">
              {sortedDays.map((dateKey) => (
                <div key={dateKey} className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground sticky top-0 bg-background py-2">
                    {format(new Date(dateKey + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
                  </h3>
                  <div className="space-y-2">
                    {entriesByDay[dateKey].map((entry: any) => {
                      const isWeeklySummary = entry.logbook_categories?.name === 'Weekly Summary';
                      return (
                      <Card key={entry._virtualId || entry.id} className={isWeeklySummary ? "border-primary/30 bg-gradient-to-br from-primary/5 to-transparent" : ""}>
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            {isWeeklySummary ? (
                              <Avatar className="border-2 border-primary/30">
                                <AvatarImage src={crooLogo} />
                                <AvatarFallback className="bg-primary/10">AI</AvatarFallback>
                              </Avatar>
                            ) : (
                              <Avatar>
                                <AvatarImage src={entry.profiles?.profile_photo_url} />
                                <AvatarFallback>
                                  <User className="h-4 w-4" />
                                </AvatarFallback>
                              </Avatar>
                            )}
                            <div className="flex-1">
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="font-medium">
                                    {isWeeklySummary ? "Croo AI" : entry.profiles?.full_name}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {entry.logbook_categories?.name}
                                  </div>
                                </div>
                              <div className="flex items-center gap-2">
                                <div className="text-xs text-muted-foreground whitespace-nowrap">
                                  {format(new Date(entry.created_at), 'h:mm a')}
                                </div>
                                {(isAdmin || isManager || entry.created_by === user?.id) && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-6 w-6">
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem 
                                        onClick={() => {
                                          // Set up for editing: select category and date, then open sheet
                                          setSelectedCategory(entry.category_id);
                                          // Parse date properly to avoid timezone issues - add T12:00:00 to ensure same day
                                          setSelectedDate(new Date(entry.entry_date + 'T12:00:00'));
                                          // Pre-fill form data from existing values (for regular entries)
                                          const existingData: Record<string, any> = {};
                                          entry.logbook_entry_values?.forEach((val: any) => {
                                            existingData[val.field_id] = val.value_text || val.value_number || val.value_date || val.attachment_url;
                                          });
                                          setFormData(existingData);
                                          // Open the sheet for editing and skip to form step
                                          setShowNewEntrySheet(true);
                                          setWizardStep('form');
                                          toast({ title: "Edit mode", description: "Update the entry and save" });
                                        }}
                                      >
                                        <Pencil className="h-4 w-4 mr-2" />
                                        Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        onClick={() => setDeleteEntryId(entry.id)}
                                        className="text-destructive focus:text-destructive"
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                              </div>
                              <div className="mt-2 space-y-1">
                                {entry.logbook_entry_values?.map((val: any) => {
                                  // Check if this is drawer count data
                                  const drawerData = val.value_text ? parseDrawerCountData(val.value_text) : null;
                                  if (drawerData && drawerData.actualDeposit !== undefined) {
                                    return (
                                      <DrawerCountEntry 
                                        key={val.id} 
                                        data={drawerData} 
                                        createdAt={entry.created_at} 
                                      />
                                    );
                                  }
                                  
                                  // Check if this is safe count data
                                  const safeData = val.value_text ? parseSafeCountData(val.value_text) : null;
                                  if (safeData) {
                                    // Bank run completed shows on AM only when: previous night PM needed bank run AND current AM has > $100 in $1s
                                    const bankRunCompleted = safeData.shift === 'AM' && checkPreviousNightNeededBankRun(entry.entry_date) && checkBankRunCompleted(safeData);
                                    return (
                                      <SafeCountEntry 
                                        key={val.id} 
                                        data={safeData} 
                                        createdAt={entry.created_at}
                                        bankRunCompleted={bankRunCompleted}
                                      />
                                    );
                                  }

                                  // Check if this is weekly summary data
                                  const summaryData = val.value_text ? parseWeeklySummaryData(val.value_text) : null;
                                  if (summaryData) {
                                    return (
                                      <WeeklySummaryEntry 
                                        key={val.id} 
                                        data={summaryData} 
                                        createdAt={entry.created_at} 
                                      />
                                    );
                                  }
                                  
                                  return (
                                    <div key={val.id} className="text-sm">
                                      {val.value_text || val.value_number || val.value_date || 
                                        (val.attachment_url && (
                                          <a 
                                            href={val.attachment_url} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline inline-flex items-center gap-1"
                                          >
                                            <Paperclip className="h-3 w-3" />
                                            View attachment
                                          </a>
                                        ))
                                      }
                                    </div>
                                  );
                                })}
                              </div>
                              
                              {/* Follow-up action buttons for Guest Re-Makes and Online Refunds */}
                              {entry.logbook_categories?.name === 'Guest Remakes' && (
                                <div className="mt-3 pt-3 border-t border-border">
                                  {entry.followup_completed_at ? (
                                    <div className="flex items-center gap-2">
                                      <Button 
                                        size="sm" 
                                        variant="outline"
                                        className="bg-green-500/20 text-green-600 border-green-500/30 hover:bg-green-500/30 cursor-default"
                                        disabled
                                      >
                                        ✓ Re-Make Completed
                                      </Button>
                                      <span className="text-xs text-muted-foreground">
                                        {format(new Date(entry.followup_completed_at), 'MMM d, h:mm a')}
                                      </span>
                                    </div>
                                  ) : (
                                    <Button 
                                      size="sm" 
                                      variant="outline"
                                      className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                                      onClick={() => followupMutation.mutate(entry.id)}
                                      disabled={followupMutation.isPending}
                                    >
                                      Pending Remake
                                    </Button>
                                  )}
                                </div>
                              )}
                              
                              {entry.logbook_categories?.name === 'Online Refunds' && (
                                <div className="mt-3 pt-3 border-t border-border">
                                  {entry.followup_completed_at ? (
                                    <div className="flex items-center gap-2">
                                      <Button 
                                        size="sm" 
                                        variant="outline"
                                        className="bg-green-500/20 text-green-600 border-green-500/30 hover:bg-green-500/30 cursor-default"
                                        disabled
                                      >
                                        ✓ Refund Completed
                                      </Button>
                                      <span className="text-xs text-muted-foreground">
                                        {format(new Date(entry.followup_completed_at), 'MMM d, h:mm a')}
                                      </span>
                                    </div>
                                  ) : (
                                    <Button 
                                      size="sm" 
                                      variant="outline"
                                      className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                                      onClick={() => followupMutation.mutate(entry.id)}
                                      disabled={followupMutation.isPending}
                                    >
                                      Pending Refund
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      );
                    })}
                  </div>
                </div>
              ))}
              {sortedDays.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No entries found</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="catering">
            <CateringOrdersSection 
              showHeader={false} 
              externalUploadOpen={showCateringUpload}
              onExternalUploadChange={setShowCateringUpload}
            />
          </TabsContent>
        </Tabs>

        {isAdmin && (
          <ManageCategoriesDialog
            open={manageCategoriesOpen}
            onOpenChange={setManageCategoriesOpen}
          />
        )}

        <AlertDialog open={!!deleteEntryId} onOpenChange={(open) => !open && setDeleteEntryId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Entry</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this log entry? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteEntryId && deleteEntryMutation.mutate(deleteEntryId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
}
