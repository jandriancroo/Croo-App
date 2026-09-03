import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { format, subDays } from "date-fns";
import { compressImage } from "@/utils/imageCompression";
import { parseSafeCountData, checkNeedsBankRun } from "@/components/logbook/SafeCountEntry";
import type { SafeCountData } from "@/components/logbook/SafeCountForm";
import { logbookNotificationType, LOGBOOK_NOTIFICATION_ROLES } from "@/lib/logbookNotificationTypes";

// Cache time constants
const LOGBOOK_STALE_TIME = 5 * 60 * 1000;
const LOGBOOK_STALE_TIME_PAST = 30 * 60 * 1000;
const LOGBOOK_GC_TIME = 60 * 60 * 1000;
const RECENT_WINDOW_DAYS = 30;


export function useLogBookData() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, isManager, isShiftManager, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { getDateInTimezone, getBusinessDateInTimezone, closeTime } = useLocationTimezone();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // UI state
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
  const [searchDateFilter, setSearchDateFilter] = useState<Date | undefined>(undefined);
  const [searchCategoryName, setSearchCategoryName] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [generatingWeeklySummary, setGeneratingWeeklySummary] = useState(false);
  const [recentPage, setRecentPage] = useState(1);


  // Redirect team members
  useEffect(() => {
    if (!roleLoading && !isAdmin && !isManager && !isShiftManager) {
      toast({ title: "Access denied", description: "You don't have permission to view logs", variant: "destructive" });
      navigate('/dashboard');
    }
  }, [roleLoading, isAdmin, isManager, isShiftManager, navigate, toast]);

  // ─── Queries ─────────────────────────────────────────────────

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

  // URL param handling for category and shift
  useEffect(() => {
    const categoryParam = searchParams.get('category');
    const shiftParam = searchParams.get('shift')?.toUpperCase() as 'AM' | 'PM' | undefined;

    if (categoryParam && categories.length > 0) {
      const matchedCategory = categories.find(
        (c: any) => c.name?.toLowerCase() === categoryParam.toLowerCase()
      );
      if (matchedCategory) {
        setSelectedCategory(matchedCategory.id);
        setActiveTab('search');
        setShowNewEntrySheet(true);
        setWizardStep('form');
        if (shiftParam === 'AM' || shiftParam === 'PM') {
          setPreselectedShift(shiftParam);
        }
        setSearchParams({});
      }
    } else if (!selectedCategory && categories.length > 0) {
      setSelectedCategory(categories[0].id);
    }
  }, [categories, selectedCategory, searchParams, setSearchParams]);

  useEffect(() => {
    const fromAlert = searchParams.get('fromAlert');
    if (fromAlert === 'true') {
      setActiveTab('search');
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const handleBankDeposit = () => {
      setSelectedCategory('bank-deposit');
      setShowNewEntrySheet(true);
      setWizardStep('form');
    };
    window.addEventListener('open-bank-deposit', handleBankDeposit);
    return () => window.removeEventListener('open-bank-deposit', handleBankDeposit);
  }, []);

  // Reset pagination when switching locations
  useEffect(() => {
    setRecentPage(1);
  }, [currentLocation?.id]);


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

  const isPastDate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(selectedDate);
    selected.setHours(0, 0, 0, 0);
    return selected < today;
  }, [selectedDate]);

  const { data: entry } = useQuery({
    queryKey: ['logbook-entry', selectedCategory, getDateInTimezone(selectedDate)],
    queryFn: async () => {
      const dateStr = getDateInTimezone(selectedDate);
      const { data, error } = await supabase
        .from('logbook_entries')
        .select(`*, logbook_entry_values(*), profiles(full_name, profile_photo_url)`)
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

  const recentCutoffISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - RECENT_WINDOW_DAYS * recentPage);
    return d.toISOString();
  }, [recentPage]);

  const { data: recentEntries = [], isFetching: isFetchingRecentEntries } = useQuery({
    queryKey: ['logbook-recent-entries', currentLocation?.id, recentPage],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('logbook_entries')
        .select(`*, logbook_entry_values(*), profiles(full_name, profile_photo_url), logbook_categories(name)`)
        .eq('location_id', currentLocation.id)
        .gte('created_at', recentCutoffISO)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation,
    staleTime: LOGBOOK_STALE_TIME,
    gcTime: LOGBOOK_GC_TIME,
    placeholderData: keepPreviousData,
  });

  // Probe: is there anything older than current window?
  const { data: hasOlderEntries = false } = useQuery({
    queryKey: ['logbook-recent-has-older', currentLocation?.id, recentCutoffISO],
    queryFn: async () => {
      if (!currentLocation) return false;
      const { data, error } = await supabase
        .from('logbook_entries')
        .select('id')
        .eq('location_id', currentLocation.id)
        .lt('created_at', recentCutoffISO)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    enabled: !!currentLocation,
    staleTime: LOGBOOK_STALE_TIME,
  });


  const { data: employeeWriteUps = [] } = useQuery({
    queryKey: ['employee-writeups', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('employee_writeups')
        .select(`id, location_id, employee_id, created_by, reason, issue_description, next_steps, photo_url, is_final_warning, signature_url, signed_at, viewed_at, task_id, created_at, updated_at, family_id, notes_bullets, consent_confirmed_at, recording_duration_seconds, stt_model_used, employee:profiles!employee_writeups_employee_id_fkey(full_name, profile_photo_url), created_by_profile:profiles!employee_writeups_created_by_fkey(full_name, profile_photo_url)`)
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

  const { data: readAndSignDocs = [] } = useQuery({
    queryKey: ['read-and-sign-docs', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('read_and_sign_documents')
        .select(`*, created_by_profile:profiles!read_and_sign_documents_created_by_fkey(full_name, profile_photo_url)`)
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

  const { data: performanceReviews = [] } = useQuery({
    queryKey: ['performance-reviews', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('performance_reviews')
        .select(`*, employee:profiles!performance_reviews_employee_id_fkey(full_name, profile_photo_url), created_by_profile:profiles!performance_reviews_created_by_fkey(full_name, profile_photo_url)`)
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

  const { data: employees = [] } = useQuery({
    queryKey: ['location-employees', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data: locationUsers, error: locError } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', currentLocation.id);
      if (locError) throw locError;
      if (!locationUsers || locationUsers.length === 0) return [];
      const userIds = locationUsers.map(ul => ul.user_id);
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url, is_active')
        .in('id', userIds)
        .eq('is_active', true)
        .order('full_name');
      if (profileError) throw profileError;
      return (profiles || []).map(p => ({ id: p.id, full_name: p.full_name, profile_photo_url: p.profile_photo_url }));
    },
    enabled: !!currentLocation,
    staleTime: 5 * 60 * 1000,
  });

  // ─── Search ──────────────────────────────────────────────────

  const debouncedSearch = useMemo(() => searchQuery.trim(), [searchQuery]);
  const searchTerms = useMemo(() =>
    debouncedSearch.toLowerCase().split(/\s+/).filter(term => term.length >= 2),
    [debouncedSearch]
  );

  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ['logbook-search', currentLocation?.id, debouncedSearch],
    queryFn: async () => {
      if (!currentLocation || searchTerms.length === 0) return [];
      const { data, error } = await supabase
        .from('logbook_entries')
        .select(`*, logbook_entry_values(*), profiles(full_name, profile_photo_url), logbook_categories(name)`)
        .eq('location_id', currentLocation.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []).filter((entry: any) => {
        const searchableText = [
          entry.profiles?.full_name || '',
          entry.logbook_categories?.name || '',
          ...(entry.logbook_entry_values?.map((val: any) => val.value_text || '') || [])
        ].join(' ').toLowerCase();
        return searchTerms.every(term => searchableText.includes(term));
      });
    },
    enabled: !!currentLocation && searchTerms.length > 0,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const filteredWriteUps = useMemo(() => {
    if (searchTerms.length === 0) return employeeWriteUps;
    return employeeWriteUps.filter((wu: any) => {
      const searchableText = [
        wu.employee?.full_name || '', wu.created_by_profile?.full_name || '',
        wu.reason || '', wu.issue_description || '', 'corrective action', 'write up', 'writeup', 'write-up'
      ].join(' ').toLowerCase();
      return searchTerms.every(term => searchableText.includes(term));
    });
  }, [employeeWriteUps, searchTerms]);

  // ─── Combined entries ────────────────────────────────────────

  const writeUpEntries = useMemo(() => (searchTerms.length > 0 ? filteredWriteUps : employeeWriteUps).map((wu: any) => ({
    id: wu.id, entry_date: format(new Date(wu.created_at), 'yyyy-MM-dd'), created_at: wu.created_at,
    created_by: wu.created_by, profiles: wu.created_by_profile, logbook_categories: { name: 'Corrective Action' },
    _isWriteUp: true, _writeUpData: wu, _virtualId: `writeup-${wu.id}`,
  })), [searchTerms, filteredWriteUps, employeeWriteUps]);

  const readAndSignEntries = useMemo(() => readAndSignDocs.map((doc: any) => ({
    id: doc.id, entry_date: format(new Date(doc.created_at), 'yyyy-MM-dd'), created_at: doc.created_at,
    created_by: doc.created_by, profiles: doc.created_by_profile, logbook_categories: { name: 'Read & Sign' },
    _isReadAndSign: true, _readAndSignData: doc, _virtualId: `readandsign-${doc.id}`,
  })), [readAndSignDocs]);

  const performanceReviewEntries = useMemo(() => performanceReviews.map((review: any) => ({
    id: review.id, entry_date: format(new Date(review.created_at), 'yyyy-MM-dd'), created_at: review.created_at,
    created_by: review.created_by, profiles: review.created_by_profile, logbook_categories: { name: 'Performance Review' },
    _isPerformanceReview: true, _performanceReviewData: review, _virtualId: `review-${review.id}`,
  })), [performanceReviews]);

  const allEntries = useMemo(() => {
    const combined = searchTerms.length > 0
      ? [...searchResults, ...writeUpEntries, ...readAndSignEntries, ...performanceReviewEntries]
      : [...recentEntries, ...writeUpEntries, ...readAndSignEntries, ...performanceReviewEntries];
    const sorted = combined.sort((a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return sorted;
  }, [searchTerms, searchResults, recentEntries, writeUpEntries, readAndSignEntries, performanceReviewEntries]);

  const hasMoreRecentEntries = useMemo(() =>
    searchTerms.length === 0 && hasOlderEntries,
  [searchTerms.length, hasOlderEntries]);

  const loadMoreRecentEntries = useCallback(() => {
    setRecentPage(prev => prev + 1);
  }, []);


  // Category IDs
  const bankDepositCategoryId = useMemo(() => categories.find((c: any) => c.name?.toLowerCase() === 'bank deposit')?.id, [categories]);
  const safeCountCategoryId = useMemo(() => categories.find((c: any) => c.name?.toLowerCase() === 'safe count')?.id, [categories]);
  const drawerCountCategoryId = useMemo(() => categories.find((c: any) => c.name?.toLowerCase() === 'drawer count')?.id, [categories]);

  // Safe/drawer count entries for selected date
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

  const { data: drawerCountEntries = [] } = useQuery({
    queryKey: ['drawer-count-entries', drawerCountCategoryId, getBusinessDateInTimezone(), currentLocation?.id],
    queryFn: async () => {
      if (!drawerCountCategoryId || !currentLocation) return [];
      const dateStr = getBusinessDateInTimezone();
      const { data, error } = await supabase
        .from('logbook_entries')
        .select(`*, logbook_entry_values(*), profiles:created_by(full_name)`)
        .eq('category_id', drawerCountCategoryId)
        .eq('entry_date', dateStr)
        .eq('location_id', currentLocation.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!drawerCountCategoryId && !!currentLocation,
    staleTime: isPastDate ? LOGBOOK_STALE_TIME_PAST : LOGBOOK_STALE_TIME,
    gcTime: LOGBOOK_GC_TIME,
  });

  const existingSafeCountShifts: ('AM' | 'PM')[] = useMemo(() => safeCountEntries
    .map((entry: any) => {
      try {
        const data = JSON.parse(entry.logbook_entry_values?.[0]?.value_text || '{}');
        return data.shift as 'AM' | 'PM';
      } catch { return null; }
    })
    .filter((shift): shift is 'AM' | 'PM' => shift === 'AM' || shift === 'PM'), [safeCountEntries]);

  // ─── Expanded entries for display ────────────────────────────

  const expandedEntries = useMemo(() => allEntries.flatMap((entry: any) => {
    const isSafeCount = entry.logbook_categories?.name?.toLowerCase() === 'safe count';
    if (isSafeCount && entry.logbook_entry_values?.length > 1) {
      return entry.logbook_entry_values.map((val: any) => ({
        ...entry, logbook_entry_values: [val], _virtualId: `${entry.id}-${val.id}`,
      }));
    }
    return [entry];
  }), [allEntries]);

  // Bank run tracking
  const safeCountsByDate = useMemo(() => {
    const result: Record<string, SafeCountData[]> = {};
    expandedEntries.forEach((entry: any) => {
      if (entry.logbook_categories?.name?.toLowerCase() === 'safe count') {
        const dateKey = entry.entry_date;
        const safeData = entry.logbook_entry_values?.[0]?.value_text
          ? parseSafeCountData(entry.logbook_entry_values[0].value_text)
          : null;
        if (safeData) {
          if (!result[dateKey]) result[dateKey] = [];
          result[dateKey].push(safeData);
        }
      }
    });
    return result;
  }, [expandedEntries]);

  const checkPreviousNightNeededBankRun = (entryDate: string): boolean => {
    const prevDate = format(subDays(new Date(entryDate + 'T12:00:00'), 1), 'yyyy-MM-dd');
    const prevDaySafeCounts = safeCountsByDate[prevDate] || [];
    return prevDaySafeCounts.some(sc => sc.shift === 'PM' && checkNeedsBankRun(sc));
  };

  const categoryFilteredEntries = useMemo(() => {
    if (!searchCategoryName) return expandedEntries;
    const target = searchCategoryName.toLowerCase();
    return expandedEntries.filter((entry: any) =>
      (entry.logbook_categories?.name || '').toLowerCase() === target
    );
  }, [expandedEntries, searchCategoryName]);

  const dateFilteredEntries = useMemo(() => searchDateFilter
    ? categoryFilteredEntries.filter((entry: any) => entry.entry_date === format(searchDateFilter, 'yyyy-MM-dd'))
    : categoryFilteredEntries, [searchDateFilter, categoryFilteredEntries]);

  const entriesByDay = useMemo(() => dateFilteredEntries.reduce((acc: any, entry: any) => {
    const dateKey = entry.entry_date;
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(entry);
    return acc;
  }, {}), [dateFilteredEntries]);

  const sortedDays = useMemo(() => Object.keys(entriesByDay).sort((a, b) => b.localeCompare(a)), [entriesByDay]);

  // ─── Mutations ───────────────────────────────────────────────

  const handleFileUpload = async (fieldId: string, file: File) => {
    try {
      setUploadingFiles(prev => ({ ...prev, [fieldId]: true }));
      let fileToUpload: File | Blob = file;
      let fileName = `${user!.id}/${Date.now()}.${file.name.split('.').pop()}`;
      if (file.type.startsWith('image/')) {
        fileToUpload = await compressImage(file, 1200, 1200, 0.8);
        fileName = `${user!.id}/${Date.now()}.jpg`;
      }
      const { error: uploadError } = await supabase.storage.from('logbook-attachments').upload(fileName, fileToUpload);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('logbook-attachments').getPublicUrl(fileName);
      setFormData(prev => ({ ...prev, [fieldId]: publicUrl }));
      toast({ title: "File uploaded successfully" });
    } catch (error: any) {
      toast({ title: "Error uploading file", description: error.message, variant: "destructive" });
    } finally {
      setUploadingFiles(prev => ({ ...prev, [fieldId]: false }));
    }
  };

  const saveEntryMutation = useMutation({
    mutationFn: async () => {
      const dateStr = getDateInTimezone(selectedDate);
      const { data: entryData, error: entryError } = await supabase
        .from('logbook_entries')
        .insert({ category_id: selectedCategory, entry_date: dateStr, created_by: user!.id, location_id: currentLocation?.id })
        .select().single();
      if (entryError) throw entryError;
      await supabase.from('logbook_entry_values').delete().eq('entry_id', entryData.id);
      const values = fields.map((field: any) => ({
        entry_id: entryData.id, field_id: field.id,
        value_text: field.field_type === 'text' || field.field_type === 'textarea' ? formData[field.id] : null,
        value_number: field.field_type === 'number' ? formData[field.id] : null,
        value_date: field.field_type === 'date' ? formData[field.id] : null,
        attachment_url: field.field_type === 'attachment' ? formData[field.id] : null,
      }));
      const { error: valuesError } = await supabase.from('logbook_entry_values').insert(values);
      if (valuesError) throw valuesError;

      // Read the category's push flag FRESH: a cached copy from before an admin
      // turned notifications on would silently swallow the push.
      const { data: freshCategory } = await supabase
        .from('logbook_categories')
        .select('id, name, push_notification_enabled')
        .eq('id', selectedCategory)
        .maybeSingle();
      const currentCategory: any =
        freshCategory || categories.find((c: any) => c.id === selectedCategory);
      if (currentCategory?.push_notification_enabled && currentLocation) {
        try {
          // Per-role opt-in for this LogBook category (Settings → Role notifications)
          const { data: settings } = await supabase
            .from('role_notification_settings')
            .select('role, enabled')
            .eq('notification_type', logbookNotificationType(currentCategory.name));

          const known = (settings || []).filter((s: any) =>
            (LOGBOOK_NOTIFICATION_ROLES as readonly string[]).includes(s.role)
          );

          // No rows seeded yet for this category → fall back to manager and up
          // instead of silently sending nothing.
          const roles = known.length
            ? known.filter((s: any) => s.enabled).map((s: any) => s.role)
            : LOGBOOK_NOTIFICATION_ROLES.filter(
                (r) => r !== 'shift_manager' && r !== 'shift_manager_in_training'
              );

          if (roles.length > 0) {
            await supabase.functions.invoke('send-push-notification', {
              body: { notification_type: 'logbook_entry', title: `New Log Entry - ${currentLocation.name}`, body: `${currentCategory.name} entry submitted`, location_id: currentLocation.id, roles }
            });
          }
        } catch (notifError) { console.error('Failed to send push notification:', notifError); }
      }
    },
    onSuccess: () => {
      toast({ title: "Entry saved successfully" });
      queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
      setFormData({});
      setActiveTab('search');
    },
    onError: (error: any) => { toast({ title: "Error saving entry", description: error.message, variant: "destructive" }); },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { error: valuesError } = await supabase.from('logbook_entry_values').delete().eq('entry_id', entryId);
      if (valuesError) throw valuesError;
      const { error: entryError } = await supabase.from('logbook_entries').delete().eq('id', entryId);
      if (entryError) throw entryError;
    },
    onSuccess: () => {
      toast({ title: "Entry deleted" });
      queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
      setDeleteEntryId(null);
    },
    onError: (error: any) => { toast({ title: "Error deleting entry", description: error.message, variant: "destructive" }); },
  });

  const followupMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase.from('logbook_entries').update({ followup_completed_at: new Date().toISOString(), followup_completed_by: user?.id }).eq('id', entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Follow-up completed" });
      queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
    },
    onError: (error: any) => { toast({ title: "Error updating follow-up", description: error.message, variant: "destructive" }); },
  });

  return {
    // Auth/role
    user, isAdmin, isManager, isShiftManager, roleLoading,
    currentLocation, isMobile,
    // Timezone
    getDateInTimezone, getBusinessDateInTimezone, closeTime,
    // UI state
    selectedDate, setSelectedDate,
    searchQuery, setSearchQuery,
    selectedCategory, setSelectedCategory,
    manageCategoriesOpen, setManageCategoriesOpen,
    uploadingFiles, setUploadingFiles,
    activeTab, setActiveTab,
    showNewEntrySheet, setShowNewEntrySheet,
    wizardStep, setWizardStep,
    deleteEntryId, setDeleteEntryId,
    showCateringUpload, setShowCateringUpload,
    preselectedShift, setPreselectedShift,
    isSavingSpecialForm, setIsSavingSpecialForm,
    cateringSearchQuery, setCateringSearchQuery,
    searchDateFilter, setSearchDateFilter,
    searchCategoryName, setSearchCategoryName,
    formData, setFormData,
    generatingWeeklySummary, setGeneratingWeeklySummary,
    // Data
    categories, locationSettings, fields, entry,
    recentEntries, employeeWriteUps, readAndSignDocs, performanceReviews,
    employees, searchResults, isSearching,
    safeCountEntries, drawerCountEntries,
    existingSafeCountShifts,
    bankDepositCategoryId, safeCountCategoryId, drawerCountCategoryId,
    // Derived
    sortedDays, entriesByDay, checkPreviousNightNeededBankRun,
    // Pagination
    recentPage, hasMoreRecentEntries, loadMoreRecentEntries, isFetchingRecentEntries,
    // Mutations
    handleFileUpload, saveEntryMutation, deleteEntryMutation, followupMutation,
    // Helpers
    toast, queryClient,
  };
}
