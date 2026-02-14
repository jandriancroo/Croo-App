import { useState, useEffect, useMemo } from "react";
import { Layout } from "@/components/Layout";
import { PageHeaderDivider } from "@/components/ui/page-header-divider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { PillGroup } from "@/components/ui/folder-tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Paperclip, Search, User, Settings, MoreVertical, Trash2, Pencil, Plus, ChevronLeft, DollarSign, ClipboardList, ClipboardCheck, AlertTriangle, Package, Truck, MessageSquare, ShieldCheck, ToggleLeft, Wrench, CalendarRange, PenLine } from "lucide-react";
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
import { BankDepositForm, BankDepositData } from "@/components/logbook/BankDepositForm";
import { BankDepositEntry, parseBankDepositData } from "@/components/logbook/BankDepositEntry";
import { EmployeeWriteUpForm, WriteUpData } from "@/components/logbook/EmployeeWriteUpForm";
import { EmployeeWriteUpEntry } from "@/components/logbook/EmployeeWriteUpEntry";
import { ReadAndSignForm } from "@/components/logbook/ReadAndSignForm";
import { ReadAndSignEntry } from "@/components/logbook/ReadAndSignEntry";
import { PerformanceReviewForm, PerformanceReviewData } from "@/components/logbook/PerformanceReviewForm";
import { PerformanceReviewEntry } from "@/components/logbook/PerformanceReviewEntry";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { startOfWeek, endOfWeek, getDay, subDays } from "date-fns";
import crooLogo from "@/assets/croo-logo.webp";
import { Building2 } from "lucide-react";

// Cache time constants for LogBook
const LOGBOOK_STALE_TIME = 5 * 60 * 1000; // 5 minutes for recent data
const LOGBOOK_STALE_TIME_PAST = 30 * 60 * 1000; // 30 minutes for past dates (they rarely change)
const LOGBOOK_GC_TIME = 60 * 60 * 1000; // 60 minutes - keep in cache

export default function LogBook() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, isManager, isShiftManager, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { getDateInTimezone, getBusinessDateInTimezone, closeTime } = useLocationTimezone();
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
  const [cateringSearchQuery, setCateringSearchQuery] = useState("");
  const navigate = useNavigate();

  // Redirect team members away from logs page
  useEffect(() => {
    if (!roleLoading && !isAdmin && !isManager && !isShiftManager) {
      toast({ title: "Access denied", description: "You don't have permission to view logs", variant: "destructive" });
      navigate('/dashboard');
    }
  }, [roleLoading, isAdmin, isManager, isShiftManager, navigate, toast]);

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
    staleTime: 5 * 60 * 1000,
  });

  // Fetch location settings for safe/drawer targets and notification settings
  const { data: locationSettings } = useQuery({
    queryKey: ['location-settings', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return null;
      const { data, error } = await supabase
        .from('location_settings')
        .select('safe_target, drawer_bank, drawer_count_notifications_enabled, safe_count_notifications_enabled, timezone')
        .eq('location_id', currentLocation.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation,
    staleTime: 5 * 60 * 1000,
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

  // Handle bank deposit event from dashboard
  useEffect(() => {
    const handleBankDeposit = () => {
      setSelectedCategory('bank-deposit');
      setShowNewEntrySheet(true);
      setWizardStep('form');
    };
    
    window.addEventListener('open-bank-deposit', handleBankDeposit);
    return () => window.removeEventListener('open-bank-deposit', handleBankDeposit);
  }, []);

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
    staleTime: 5 * 60 * 1000,
  });

  // Check if viewing a past date for cache optimization
  const isPastDate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(selectedDate);
    selected.setHours(0, 0, 0, 0);
    return selected < today;
  }, [selectedDate]);

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
    staleTime: isPastDate ? LOGBOOK_STALE_TIME_PAST : LOGBOOK_STALE_TIME,
    gcTime: LOGBOOK_GC_TIME,
  });

  // Fetch recent entries (last 50) for fast initial display
  const { data: recentEntries = [] } = useQuery({
    queryKey: ['logbook-recent-entries', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
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

      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation,
    staleTime: LOGBOOK_STALE_TIME,
    gcTime: LOGBOOK_GC_TIME,
  });

  // Fetch employee write-ups for the location
  const { data: employeeWriteUps = [] } = useQuery({
    queryKey: ['employee-writeups', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('employee_writeups')
        .select(`
          *,
          employee:profiles!employee_writeups_employee_id_fkey(full_name, profile_photo_url),
          created_by_profile:profiles!employee_writeups_created_by_fkey(full_name, profile_photo_url)
        `)
        .eq('location_id', currentLocation.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation,
    staleTime: LOGBOOK_STALE_TIME,
    gcTime: LOGBOOK_GC_TIME,
  });

  // Fetch Read & Sign documents for the location
  const { data: readAndSignDocs = [] } = useQuery({
    queryKey: ['read-and-sign-docs', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('read_and_sign_documents')
        .select(`
          *,
          created_by_profile:profiles!read_and_sign_documents_created_by_fkey(full_name, profile_photo_url)
        `)
        .eq('location_id', currentLocation.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation,
    staleTime: LOGBOOK_STALE_TIME,
    gcTime: LOGBOOK_GC_TIME,
  });

  // Fetch Performance Reviews for the location (manager+ only)
  const { data: performanceReviews = [] } = useQuery({
    queryKey: ['performance-reviews', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('performance_reviews')
        .select(`
          *,
          employee:profiles!performance_reviews_employee_id_fkey(full_name, profile_photo_url),
          created_by_profile:profiles!performance_reviews_created_by_fkey(full_name, profile_photo_url)
        `)
        .eq('location_id', currentLocation.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation && (isAdmin || isManager),
    staleTime: LOGBOOK_STALE_TIME,
    gcTime: LOGBOOK_GC_TIME,
  });

  // Fetch employees for Read & Sign and Performance Review forms
  const { data: employees = [] } = useQuery({
    queryKey: ['location-employees', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      // Get user_ids for this location first
      const { data: locationUsers, error: locError } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', currentLocation.id);

      if (locError) throw locError;
      if (!locationUsers || locationUsers.length === 0) return [];

      const userIds = locationUsers.map(ul => ul.user_id);

      // Then fetch profiles for those users
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url, is_active')
        .in('id', userIds)
        .eq('is_active', true)
        .order('full_name');

      if (profileError) throw profileError;
      return (profiles || []).map(p => ({
        id: p.id,
        full_name: p.full_name,
        profile_photo_url: p.profile_photo_url,
      }));
    },
    enabled: !!currentLocation,
    staleTime: 5 * 60 * 1000,
  });

  // Debounced search query - only fires when user is actively searching
  const debouncedSearch = useMemo(() => searchQuery.trim(), [searchQuery]);
  
  // Parse search terms - split by space for multi-term search (like Apple Mail)
  const searchTerms = useMemo(() => 
    debouncedSearch.toLowerCase().split(/\s+/).filter(term => term.length >= 2),
    [debouncedSearch]
  );
  
  // Server-side search for full history (only when searching)
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ['logbook-search', currentLocation?.id, debouncedSearch],
    queryFn: async () => {
      if (!currentLocation || searchTerms.length === 0) return [];
      
      // Search across all entries (no limit for search)
      const { data, error } = await supabase
        .from('logbook_entries')
        .select(`
          *,
          logbook_entry_values(*),
          profiles(full_name, profile_photo_url),
          logbook_categories(name)
        `)
        .eq('location_id', currentLocation.id)
        .order('created_at', { ascending: false })
        .limit(200); // Higher limit for search results

      if (error) throw error;
      
      // Filter results client-side - ALL search terms must match (AND logic)
      return (data || []).filter((entry: any) => {
        const searchableText = [
          entry.profiles?.full_name || '',
          entry.logbook_categories?.name || '',
          ...(entry.logbook_entry_values?.map((val: any) => val.value_text || '') || [])
        ].join(' ').toLowerCase();
        
        // Every search term must be found somewhere in the entry
        return searchTerms.every(term => searchableText.includes(term));
      });
    },
    enabled: !!currentLocation && searchTerms.length > 0,
    staleTime: 60 * 1000, // 1 minute for search results
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
  
  // Also filter write-ups when searching
  const filteredWriteUps = useMemo(() => {
    if (searchTerms.length === 0) return employeeWriteUps;
    
    return employeeWriteUps.filter((wu: any) => {
      const searchableText = [
        wu.employee?.full_name || '',
        wu.created_by_profile?.full_name || '',
        wu.reason || '',
        wu.issue_description || '',
        'write up', 'writeup', 'write-up' // Include these so "write up" search finds them
      ].join(' ').toLowerCase();
      
      return searchTerms.every(term => searchableText.includes(term));
    });
  }, [employeeWriteUps, searchTerms]);

  // Combine regular log entries with write-ups for unified display
  // Use filtered write-ups when searching
  const writeUpEntries = (searchTerms.length > 0 ? filteredWriteUps : employeeWriteUps).map((wu: any) => ({
    id: wu.id,
    entry_date: format(new Date(wu.created_at), 'yyyy-MM-dd'),
    created_at: wu.created_at,
    created_by: wu.created_by,
    profiles: wu.created_by_profile,
    logbook_categories: { name: 'Employee Write-Up' },
    _isWriteUp: true,
    _writeUpData: wu,
    _virtualId: `writeup-${wu.id}`, // Unique key for React
  }));

  // Convert Read & Sign documents to log entry format
  const readAndSignEntries = readAndSignDocs.map((doc: any) => ({
    id: doc.id,
    entry_date: format(new Date(doc.created_at), 'yyyy-MM-dd'),
    created_at: doc.created_at,
    created_by: doc.created_by,
    profiles: doc.created_by_profile,
    logbook_categories: { name: 'Read & Sign' },
    _isReadAndSign: true,
    _readAndSignData: doc,
    _virtualId: `readandsign-${doc.id}`,
  }));

  // Convert Performance Reviews to log entry format (manager+ only)
  const performanceReviewEntries = performanceReviews.map((review: any) => ({
    id: review.id,
    entry_date: format(new Date(review.created_at), 'yyyy-MM-dd'),
    created_at: review.created_at,
    created_by: review.created_by,
    profiles: review.created_by_profile,
    logbook_categories: { name: 'Performance Review' },
    _isPerformanceReview: true,
    _performanceReviewData: review,
    _virtualId: `review-${review.id}`,
  }));

  // Use search results when searching, otherwise combine recent entries with write-ups, read & sign docs, and performance reviews
  const allEntries = searchTerms.length > 0
    ? [...searchResults, ...writeUpEntries, ...readAndSignEntries, ...performanceReviewEntries].sort((a: any, b: any) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    : [...recentEntries, ...writeUpEntries, ...readAndSignEntries, ...performanceReviewEntries].sort((a: any, b: any) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ).slice(0, 100);

  // Find bank deposit category ID (create if doesn't exist)
  const bankDepositCategoryId = categories.find((c: any) => c.name?.toLowerCase() === 'bank deposit')?.id;

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
    staleTime: isPastDate ? LOGBOOK_STALE_TIME_PAST : LOGBOOK_STALE_TIME,
    gcTime: LOGBOOK_GC_TIME,
  });

  // Fetch drawer count entries for current business date
  // Uses business date to correctly handle late-night counts after midnight
  const { data: drawerCountEntries = [] } = useQuery({
    queryKey: ['drawer-count-entries', drawerCountCategoryId, getBusinessDateInTimezone(), currentLocation?.id],
    queryFn: async () => {
      if (!drawerCountCategoryId || !currentLocation) return [];
      // Use business date for drawer counts - handles late-night counts correctly
      const dateStr = getBusinessDateInTimezone();
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
    staleTime: isPastDate ? LOGBOOK_STALE_TIME_PAST : LOGBOOK_STALE_TIME,
    gcTime: LOGBOOK_GC_TIME,
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
              roles: ['admin', 'manager', 'shift_manager'],
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
      queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
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
      queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
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
      queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating follow-up",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // When searching, results are already filtered; when browsing, show all recent
  const filteredEntries = allEntries;

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
  const [generatingWeeklySummary, setGeneratingWeeklySummary] = useState(false);
  
  const renderNewEntryContent = () => {
    const currentCategoryName = categories.find((c: any) => c.id === selectedCategory)?.name?.toLowerCase();
    const isDrawerCount = currentCategoryName === 'drawer count';
    const isSafeCount = currentCategoryName === 'safe count';
    const isWeeklySummary = currentCategoryName === 'weekly summary';
    // Bank deposit can be triggered via virtual 'bank-deposit' string OR by selecting the actual category
    const isBankDeposit = selectedCategory === 'bank-deposit' || currentCategoryName === 'bank deposit';
    const isEmployeeWriteUp = currentCategoryName === 'employee write-up' || currentCategoryName === 'employee writeup' || currentCategoryName === 'employee write up' || currentCategoryName === 'write-up' || currentCategoryName === 'writeup' || currentCategoryName === 'write up';
    const isReadAndSign = currentCategoryName === 'read & sign' || currentCategoryName === 'read and sign' || currentCategoryName === 'read-and-sign';
    const isPerformanceReview = currentCategoryName === 'performance review' || currentCategoryName === 'performance-review';
    
    // Performance Review form - manager+ only
    if (isPerformanceReview) {
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Performance Review</h2>
          <PerformanceReviewForm
            onSave={async (data: PerformanceReviewData) => {
              if (isSavingSpecialForm) return;
              setIsSavingSpecialForm(true);
              try {
                // 1. Create the performance review
                const { data: review, error: reviewError } = await supabase
                  .from('performance_reviews')
                  .insert({
                    location_id: currentLocation!.id,
                    employee_id: data.employeeId,
                    created_by: user!.id,
                    follow_up_notes: data.followUpNotes || null,
                  })
                  .select()
                  .single();
                
                if (reviewError) throw reviewError;
                
                // 2. Insert all ratings
                if (data.ratings.length > 0) {
                  const ratingsToInsert = data.ratings.map(r => ({
                    review_id: review.id,
                    item_id: r.itemId,
                    rating: r.rating,
                    notes: r.notes || null,
                  }));
                  
                  const { error: ratingsError } = await supabase
                    .from('performance_review_ratings')
                    .insert(ratingsToInsert);
                  
                  if (ratingsError) throw ratingsError;
                }
                
                // 3. Create a temporary task assigned to the employee for signature
                const { data: task, error: taskError } = await supabase
                  .from('temporary_tasks')
                  .insert({
                    location_id: currentLocation!.id,
                    title: `Sign Performance Review`,
                    description: 'You have a performance review that requires your acknowledgment and signature.',
                    created_by: user!.id,
                    accent_color: '#3b82f6', // blue for reviews
                    task_style: 'quick',
                    is_active: true,
                    push_enabled: true,
                  })
                  .select()
                  .single();
                
                if (taskError) throw taskError;
                
                // 4. Create task assignment for the employee
                if (task) {
                  await supabase
                    .from('temporary_task_assignments')
                    .insert({
                      task_id: task.id,
                      user_id: data.employeeId,
                    });
                  
                  // Update review with task_id
                  await supabase
                    .from('performance_reviews')
                    .update({ task_id: task.id })
                    .eq('id', review.id);
                }

                toast({ title: "Performance review submitted", description: `${data.employeeName} will be notified to sign.` });
                queryClient.invalidateQueries({ queryKey: ['performance-reviews'] });
                queryClient.invalidateQueries({ queryKey: ['temporary-tasks'] });
                setShowNewEntrySheet(false);
                setActiveTab('search');
              } catch (error: any) {
                toast({ title: "Error saving review", description: error.message, variant: "destructive" });
              } finally {
                setIsSavingSpecialForm(false);
              }
            }}
            isSaving={isSavingSpecialForm}
          />
        </div>
      );
    }
    
    // Read & Sign form - no inner header, the outer wrapper handles it
    if (isReadAndSign) {
      return (
        <ReadAndSignForm
          locationId={currentLocation!.id}
          employees={employees}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['read-and-sign-docs'] });
            setShowNewEntrySheet(false);
            setActiveTab('search');
          }}
          onCancel={() => {
            setShowNewEntrySheet(false);
          }}
        />
      );
    }
    
    // Employee Write-Up form
    if (isEmployeeWriteUp) {
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Employee Write-Up</h2>
          <EmployeeWriteUpForm
            onSave={async (data: WriteUpData) => {
              if (isSavingSpecialForm) return;
              setIsSavingSpecialForm(true);
              try {
                const dateStr = getDateInTimezone(selectedDate);
                
                // 1. Create the write-up record in employee_writeups table
                const { data: writeUp, error: writeUpError } = await supabase
                  .from('employee_writeups')
                  .insert({
                    location_id: currentLocation!.id,
                    employee_id: data.employeeId,
                    created_by: user!.id,
                    reason: data.reason,
                    issue_description: data.issueDescription,
                    next_steps: data.nextSteps,
                    photo_url: data.photoUrl || null,
                    is_final_warning: data.isFinalWarning,
                  })
                  .select()
                  .single();
                
                if (writeUpError) throw writeUpError;
                
                // 2. Create a temporary task assigned ONLY to that employee for signature
                const { error: taskError } = await supabase
                  .from('temporary_tasks')
                  .insert({
                    location_id: currentLocation!.id,
                    title: `Sign Write-Up: ${data.reason}`,
                    description: 'You have a write-up that requires your acknowledgment and signature.',
                    created_by: user!.id,
                    accent_color: '#ef4444', // red for urgency
                    task_style: 'quick',
                    is_active: true,
                    write_up_id: writeUp.id,
                    push_enabled: true,
                  });
                
                if (taskError) throw taskError;
                
                // 3. Create task assignment for the employee
                const { data: taskData } = await supabase
                  .from('temporary_tasks')
                  .select('id')
                  .eq('write_up_id', writeUp.id)
                  .single();
                
                if (taskData) {
                  await supabase
                    .from('temporary_task_assignments')
                    .insert({
                      task_id: taskData.id,
                      user_id: data.employeeId,
                    });
                }

                toast({ title: "Write-up submitted", description: `${data.employeeName} will be notified to sign.` });
                queryClient.invalidateQueries({ queryKey: ['employee-writeups'] });
                queryClient.invalidateQueries({ queryKey: ['temporary-tasks'] });
                setShowNewEntrySheet(false);
                setActiveTab('search');
              } catch (error: any) {
                toast({ title: "Error saving write-up", description: error.message, variant: "destructive" });
              } finally {
                setIsSavingSpecialForm(false);
              }
            }}
            isSaving={isSavingSpecialForm}
          />
        </div>
      );
    }
    
    // Weekly Summary - special generate UI
    if (isWeeklySummary) {
      const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 }); // End on Sunday
      const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 }); // Start on Monday
      
      return (
        <div className="space-y-4">
          <div className="flex flex-col justify-between items-start gap-3">
            <h2 className="text-lg font-semibold">Generate Weekly Summary</h2>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  <span className="text-xs sm:text-sm">Week of {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}</span>
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
          
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">
                This will generate an AI-powered summary for the week of <strong>{format(weekStart, 'MMM d')}</strong> to <strong>{format(weekEnd, 'MMM d, yyyy')}</strong>, including:
              </p>
              <ul className="mt-2 text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>Total sales & daily breakdown</li>
                <li>Cash over/short from drawer counts</li>
                <li>Task completion rate</li>
                <li>AI-generated insights</li>
              </ul>
            </CardContent>
          </Card>
          
          <Button 
            className="w-full" 
            disabled={generatingWeeklySummary}
            onClick={async () => {
              setGeneratingWeeklySummary(true);
              try {
                const weekStartStr = format(weekStart, 'yyyy-MM-dd');
                const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
                
                toast({ title: "Generating weekly summary...", description: "Please wait" });
                
                const { error } = await supabase.functions.invoke('maintenance-service?action=generate-weekly-summary', {
                  body: {
                    location_id: currentLocation?.id,
                    week_start: weekStartStr,
                    week_end: weekEndStr,
                    user_id: user!.id,
                  }
                });
                
                if (error) throw error;
                
                toast({ title: "Weekly summary generated!" });
                queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
                queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
                setShowNewEntrySheet(false);
                setActiveTab('search');
              } catch (error: any) {
                console.error('Error generating weekly summary:', error);
                toast({ 
                  title: "Error generating summary", 
                  description: error.message || "Please try again", 
                  variant: "destructive" 
                });
              } finally {
                setGeneratingWeeklySummary(false);
              }
            }}
          >
            {generatingWeeklySummary ? "Generating..." : "Generate Weekly Summary"}
          </Button>
        </div>
      );
    }
    
    // Bank Deposit form
    if (isBankDeposit) {
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Bank Deposit</h2>
          <BankDepositForm
            onSave={async (data: BankDepositData) => {
              if (isSavingSpecialForm) return;
              setIsSavingSpecialForm(true);
              try {
                // First, ensure we have a Bank Deposit category
                let categoryId = bankDepositCategoryId;
                
                if (!categoryId) {
                  // Create the Bank Deposit category
                  const { data: newCategory, error: categoryError } = await supabase
                    .from('logbook_categories')
                    .insert({
                      name: 'Bank Deposit',
                      location_id: currentLocation?.id,
                      display_order: 999, // Put it at the end
                      is_active: true,
                      alert_enabled: false,
                      push_notification_enabled: false,
                    })
                    .select()
                    .single();
                  
                  if (categoryError) throw categoryError;
                  categoryId = newCategory.id;
                  queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
                }

                // Create a field for the category if it doesn't exist
                const { data: existingFields } = await supabase
                  .from('logbook_fields')
                  .select('id')
                  .eq('category_id', categoryId)
                  .limit(1);
                
                let fieldId = existingFields?.[0]?.id;
                
                if (!fieldId) {
                  const { data: newField, error: fieldError } = await supabase
                    .from('logbook_fields')
                    .insert({
                      category_id: categoryId,
                      field_name: 'bank_deposit_data',
                      field_type: 'text',
                      display_order: 0,
                      is_required: false,
                    })
                    .select()
                    .single();
                  
                  if (fieldError) throw fieldError;
                  fieldId = newField.id;
                }

                // Create the logbook entry using the end date
                const { data: entryData, error: entryError } = await supabase
                  .from('logbook_entries')
                  .insert({
                    category_id: categoryId,
                    entry_date: data.endDate,
                    created_by: user!.id,
                    location_id: currentLocation?.id,
                  })
                  .select()
                  .single();

                if (entryError) throw entryError;

                // Save the bank deposit data as JSON in the entry value
                const { error: valuesError } = await supabase
                  .from('logbook_entry_values')
                  .insert({
                    entry_id: entryData.id,
                    field_id: fieldId,
                    value_text: JSON.stringify(data),
                  });

                if (valuesError) throw valuesError;

                toast({ title: "Bank deposit recorded successfully" });
                queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
                queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
                queryClient.invalidateQueries({ queryKey: ['deposited-drawer-entries'] });
                setShowNewEntrySheet(false);
                setActiveTab('search');
              } catch (error: any) {
                toast({ title: "Error saving bank deposit", description: error.message, variant: "destructive" });
              } finally {
                setIsSavingSpecialForm(false);
              }
            }}
            isSaving={isSavingSpecialForm}
            timezone={locationSettings?.timezone || "America/Los_Angeles"}
          />
        </div>
      );
    }
    
    if (isDrawerCount) {
      // For drawer counts, always use the business date (handles late-night counts after midnight)
      const businessDateStr = getBusinessDateInTimezone();
      const businessDateDisplay = new Date(businessDateStr + 'T12:00:00');
      
      return (
        <div className="space-y-4">
          <div className="flex flex-col justify-between items-start gap-3">
            <h2 className="text-lg font-semibold">Drawer Count</h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarIcon className="h-4 w-4" />
              <span>Business Day: {format(businessDateDisplay, 'EEEE, MMMM d, yyyy')}</span>
            </div>
          </div>
          {entry && (
            <p className="text-xs text-muted-foreground">
              Last entry by {entry.profiles?.full_name} at {format(new Date(entry.created_at), 'PPp')}
            </p>
          )}
          <DrawerCountForm
            key={getBusinessDateInTimezone()}
            businessDate={getBusinessDateInTimezone()}
            onSave={async (data: DrawerCountData) => {
              if (isSavingSpecialForm) return; // Prevent double-submit
              setIsSavingSpecialForm(true);
              try {
                // Use business date for drawer counts - this handles late-night counts after midnight
                // that should still be associated with the previous business day
                const dateStr = getBusinessDateInTimezone();
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
                queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
                queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
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
                        roles: ['admin', 'manager', 'shift_manager', 'super_admin'],
                      }
                    });
                  } catch (notifError) {
                    console.error('Error sending drawer count notification:', notifError);
                  }
                }

                // Trigger weekly summary generation if this is a Sunday deposit
                // Use business date to determine if it's Sunday (handles late-night deposits after midnight)
                const businessDateStr = getBusinessDateInTimezone();
                const businessDate = new Date(businessDateStr + 'T12:00:00');
                const dayOfWeek = getDay(businessDate);
                if (dayOfWeek === 0 && currentLocation?.id) { // 0 = Sunday
                  try {
                    const weekStart = format(startOfWeek(businessDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
                    const weekEnd = format(endOfWeek(businessDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
                    
                    toast({ title: "Generating weekly summary...", description: "Please wait" });
                    
                    await supabase.functions.invoke('maintenance-service?action=generate-weekly-summary', {
                      body: {
                        location_id: currentLocation.id,
                        week_start: weekStart,
                        week_end: weekEnd,
                        user_id: user!.id,
                      }
                    });
                    
                    toast({ title: "Weekly summary generated!" });
                    queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
                    queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
                  } catch (summaryError) {
                    console.error('Error generating weekly summary:', summaryError);
                  }
                }
                // Note: Daily logbook summary email is triggered by database trigger on logbook_entries insert
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
                queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
                queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
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
                        roles: ['admin', 'manager', 'shift_manager', 'super_admin'],
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
          {fields
            // Hide internal/technical fields that store JSON data for special forms
            .filter((field: any) => !['bank_deposit_data', 'drawer_data', 'safe_data', 'weekly_summary_data'].includes(field.field_name))
            .map((field: any) => (
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
  if (roleLoading || (!isAdmin && !isManager && !isShiftManager)) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </Layout>
    );
  }

  const folderTabs = [
    { id: "search", label: "Recent Logs" },
    { id: "catering", label: "Catering Orders" },
  ];

  return (
    <Layout>
      <div className="space-y-4">
        <div className="mb-4">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold">Logs</h1>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button 
                  size="icon" 
                  variant="outline" 
                  onClick={() => setManageCategoriesOpen(true)}
                  title="Manage Categories"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <PageHeaderDivider />
        </div>

        <PillGroup items={folderTabs} active={activeTab} onSelect={setActiveTab} />

        {/* Recent Logs Tab */}
        {activeTab === "search" && (
          <div className="space-y-4" style={{ marginTop: "1rem" }}>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search entries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              {(isShiftManager || isManager || isAdmin) && (
                <Sheet open={showNewEntrySheet} onOpenChange={(open) => {
                  setShowNewEntrySheet(open);
                  if (!open) {
                    setWizardStep('category');
                    setSelectedCategory('');
                    setPreselectedShift(null);
                  }
                }}>
                  <SheetTrigger asChild>
                    <Button size="icon" variant="default">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="bottom" className="h-[85vh] overflow-y-auto">
                    {wizardStep === 'category' ? (
                      <>
                        <SheetHeader>
                          <SheetTitle>New Log Entry</SheetTitle>
                        </SheetHeader>
                        <div className="mt-4 grid grid-cols-3 gap-3">
                          {[...categories]
                            .sort((a: any, b: any) => {
                              const cashHandlingNames = ['drawer count', 'safe count', 'bank deposit'];
                              const aIsCash = cashHandlingNames.some(name => a.name.toLowerCase().includes(name));
                              const bIsCash = cashHandlingNames.some(name => b.name.toLowerCase().includes(name));
                              if (aIsCash && !bIsCash) return 1;
                              if (!aIsCash && bIsCash) return -1;
                              return (a.display_order || 0) - (b.display_order || 0);
                            })
                            .map((category: any) => {
                              const getCategoryIcon = (name: string) => {
                                const lower = name.toLowerCase();
                                if (lower.includes('drawer')) return <DollarSign className="h-6 w-6" />;
                                if (lower.includes('safe')) return <ShieldCheck className="h-6 w-6" />;
                                if (lower.includes('bank') || lower.includes('deposit')) return <Building2 className="h-6 w-6" />;
                                if (lower.includes('write') || lower.includes('up')) return <AlertTriangle className="h-6 w-6" />;
                                if (lower.includes('86') || lower.includes('68')) return <ToggleLeft className="h-6 w-6" />;
                                if (lower.includes('maintenance')) return <Wrench className="h-6 w-6" />;
                                if (lower.includes('weekly') && lower.includes('summary')) return <CalendarRange className="h-6 w-6" />;
                                if (lower.includes('read') && lower.includes('sign')) return <PenLine className="h-6 w-6" />;
                                if (lower.includes('performance') && lower.includes('review')) return <ClipboardCheck className="h-6 w-6" />;
                                if (lower.includes('incident') || lower.includes('accident')) return <AlertTriangle className="h-6 w-6" />;
                                if (lower.includes('inventory') || lower.includes('waste')) return <Package className="h-6 w-6" />;
                                if (lower.includes('delivery') || lower.includes('catering')) return <Truck className="h-6 w-6" />;
                                if (lower.includes('note') || lower.includes('message')) return <MessageSquare className="h-6 w-6" />;
                                return <ClipboardList className="h-6 w-6" />;
                              };
                              
                              const isCashHandling = ['drawer', 'safe', 'bank', 'deposit'].some(term => 
                                category.name.toLowerCase().includes(term)
                              );
                              
                              return (
                                <button
                                  key={category.id}
                                  onClick={() => {
                                    setSelectedCategory(category.id);
                                    setWizardStep('form');
                                  }}
                                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 transition-all text-center min-h-[100px] group ${
                                    isCashHandling 
                                      ? "border-teal-500/50 bg-teal-500/10 hover:border-primary hover:bg-primary" 
                                      : "border-border bg-card hover:border-primary hover:bg-primary"
                                  }`}
                                >
                                  <div className={`${isCashHandling ? "text-teal-500" : "text-primary"} group-hover:text-primary-foreground transition-colors`}>
                                    {getCategoryIcon(category.name)}
                                  </div>
                                  <span className="font-medium text-sm group-hover:text-primary-foreground transition-colors">{category.name}</span>
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
                            {selectedCategory === 'bank-deposit' 
                              ? 'Bank Deposit' 
                              : categories.find((c: any) => c.id === selectedCategory)?.name || 'New Entry'}
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
            </div>

            <div className="space-y-6">
              {sortedDays.map((dateKey) => (
                <div key={dateKey} className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground sticky top-0 bg-card py-2 -mx-5 px-5 z-10">
                    {format(new Date(dateKey + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
                  </h3>
                  <div className="space-y-2">
                    {entriesByDay[dateKey].map((entry: any) => {
                      const isWeeklySummary = entry.logbook_categories?.name === 'Weekly Summary';
                      const isBankDeposit = entry.logbook_categories?.name?.toLowerCase() === 'bank deposit';
                      const isWriteUp = entry._isWriteUp || entry.logbook_categories?.name?.toLowerCase()?.includes('write');
                      const isFinalWarning = entry._writeUpData?.is_final_warning;
                      const isReadAndSign = entry._isReadAndSign;
                      const isPerformanceReview = entry._isPerformanceReview;
                      
                      // Special rendering for Performance Review entries (manager+ only)
                      if (isPerformanceReview) {
                        const reviewData = entry._performanceReviewData;
                        return (
                          <PerformanceReviewEntry
                            key={entry._virtualId}
                            reviewId={reviewData.id}
                            employeeName={reviewData.employee?.full_name || 'Unknown'}
                            employeePhoto={reviewData.employee?.profile_photo_url}
                            createdAt={reviewData.created_at}
                            createdByName={reviewData.created_by_profile?.full_name}
                            isSigned={!!reviewData.signed_at}
                            signedAt={reviewData.signed_at}
                          />
                        );
                      }
                      
                      // Special rendering for Read & Sign entries
                      if (isReadAndSign) {
                        return (
                          <ReadAndSignEntry
                            key={entry._virtualId}
                            documentId={entry._readAndSignData.id}
                            title={entry._readAndSignData.title}
                            createdAt={entry._readAndSignData.created_at}
                            createdByName={entry._readAndSignData.created_by_profile?.full_name}
                            revisionNumber={entry._readAndSignData.revision_number || 0}
                            revisedAt={entry._readAndSignData.revised_at}
                          />
                        );
                      }
                      
                      return (
                      <Card key={entry._virtualId || entry.id} className={
                        isWriteUp 
                          ? isFinalWarning 
                            ? "border-destructive/50 bg-gradient-to-br from-destructive/10 to-transparent" 
                            : "border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent"
                          : isWeeklySummary 
                            ? "border-primary/30 bg-gradient-to-br from-primary/5 to-transparent" 
                            : isBankDeposit 
                              ? "border-teal-500/30 bg-gradient-to-br from-teal-500/5 to-transparent" 
                              : ""
                      }>
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            {isWeeklySummary ? (
                              <Avatar className="border-2 border-primary/30">
                                <AvatarImage src={crooLogo} />
                                <AvatarFallback className="bg-primary/10">AI</AvatarFallback>
                              </Avatar>
                            ) : isWriteUp ? (
                              <div className="relative">
                                <Avatar>
                                  <AvatarImage src={entry._writeUpData?.employee?.profile_photo_url} />
                                  <AvatarFallback>
                                    <User className="h-4 w-4" />
                                  </AvatarFallback>
                                </Avatar>
                                <div className={`absolute -bottom-1 -right-1 rounded-full p-0.5 ${isFinalWarning ? 'bg-destructive' : 'bg-amber-500'}`}>
                                  <AlertTriangle className="h-3 w-3 text-white" />
                                </div>
                              </div>
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
                                    {isWeeklySummary ? "Croo AI" : isWriteUp ? (entry._writeUpData?.employee?.full_name || 'Unknown') : entry.profiles?.full_name}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {isWriteUp ? `Written up by ${entry.profiles?.full_name}` : entry.logbook_categories?.name}
                                  </div>
                                </div>
                              <div className="flex items-center gap-2">
                                <div className="text-xs text-muted-foreground whitespace-nowrap">
                                  {format(new Date(entry.created_at), 'h:mm a')}
                                </div>
                                {(isAdmin || isManager || entry.created_by === user?.id) && (() => {
                                  // Check if this is a special entry type that uses structured data (no editing via form)
                                  const categoryName = entry.logbook_categories?.name?.toLowerCase() || '';
                                  const isSpecialEntry = ['drawer count', 'safe count', 'bank deposit', 'weekly summary'].some(
                                    name => categoryName.includes(name)
                                  );
                                  
                                  // Write-ups have no edit and need special delete handling
                                  if (isWriteUp) {
                                    return (
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-6 w-6">
                                            <MoreVertical className="h-4 w-4" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem 
                                            onClick={async () => {
                                              if (!entry._writeUpData?.id) return;
                                              try {
                                                // Delete associated task if exists
                                                const { data: writeUp } = await supabase
                                                  .from('employee_writeups')
                                                  .select('task_id')
                                                  .eq('id', entry._writeUpData.id)
                                                  .single();
                                                
                                                if (writeUp?.task_id) {
                                                  await supabase.from('temporary_tasks').delete().eq('id', writeUp.task_id);
                                                }
                                                
                                                // Delete the write-up
                                                const { error } = await supabase
                                                  .from('employee_writeups')
                                                  .delete()
                                                  .eq('id', entry._writeUpData.id);
                                                  
                                                if (error) throw error;
                                                
                                                toast({ title: "Write-up deleted" });
                                                queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
                                                queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
                                              } catch (error: any) {
                                                toast({ title: "Error deleting write-up", description: error.message, variant: "destructive" });
                                              }
                                            }}
                                            className="text-destructive focus:text-destructive"
                                          >
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Delete
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    );
                                  }
                                  
                                  return (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-6 w-6">
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {/* Hide Edit for special entry types that use structured forms */}
                                      {!isSpecialEntry && (
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
                                      )}
                                      <DropdownMenuItem 
                                        onClick={() => setDeleteEntryId(entry.id)}
                                        className="text-destructive focus:text-destructive"
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                  );
                                })()}
                              </div>
                              </div>
                              <div className="mt-2 space-y-1">
                                {/* Handle write-up entries (from employee_writeups table) */}
                                {entry._isWriteUp && entry._writeUpData && (
                                  <EmployeeWriteUpEntry writeUp={entry._writeUpData} />
                                )}
                                
                                {/* Entry values - parse based on data type */}
                                {!entry._isWriteUp && entry.logbook_entry_values?.map((val: any) => {
                                  // Check if this is bank deposit data
                                  const bankDepositData = val.value_text ? parseBankDepositData(val.value_text) : null;
                                  if (bankDepositData) {
                                    return (
                                      <BankDepositEntry 
                                        key={val.id} 
                                        data={bankDepositData} 
                                        createdAt={entry.created_at} 
                                      />
                                    );
                                  }
                                  
                                  // Check if this is drawer count data
                                  const drawerData = val.value_text ? parseDrawerCountData(val.value_text) : null;
                                  if (drawerData && drawerData.actualDeposit !== undefined) {
                                    return (
                                      <DrawerCountEntry 
                                        key={val.id} 
                                        data={drawerData} 
                                        createdAt={entry.created_at}
                                        drawerBank={locationSettings?.drawer_bank || 200}
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
                                        safeTarget={locationSettings?.safe_target ?? 300}
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
          </div>
        )}

        {/* Catering Orders Tab */}
        {activeTab === "catering" && (
          <div className="space-y-4" style={{ marginTop: "1rem" }}>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search orders..."
                value={cateringSearchQuery}
                onChange={(e) => setCateringSearchQuery(e.target.value)}
                className="flex-1"
              />
              <Button size="icon" variant="default" onClick={() => setShowCateringUpload(true)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <CateringOrdersSection 
              showHeader={false} 
              externalUploadOpen={showCateringUpload}
              onExternalUploadChange={setShowCateringUpload}
              searchQuery={cateringSearchQuery}
            />
          </div>
        )}

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
