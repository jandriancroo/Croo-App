import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { useIsIOS } from '@/hooks/useIsIOS';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { CheckCircle2, Eye, Lock, ThumbsUp, ThumbsDown, Camera, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { formatTime12Hour } from '@/lib/utils';
import { compressImage, uploadWithRetry } from '@/utils/imageCompression';
import { useUserPosition } from '@/hooks/useUserPosition';
import { PrepListComplete } from '@/components/checklists/PrepListComplete';
import { PhotoPickerButton } from '@/components/PhotoPickerButton';
import { serverDebugLog } from '@/utils/serverDebugLog';
interface ChecklistItem {
  id: string;
  question: string;
  item_type: string;
  options: any;
  is_required: boolean;
  requires_temperature_validation?: boolean;
  reference_image_url?: string;
  reference_link?: string;
  reference_video_url?: string;
  reference_notes?: string;
  manager_shift?: string | null;
  position?: string | null;
  order_index?: number;
  link_refs?: any;
}
interface Checklist {
  id: string;
  title: string;
  description: string | null;
  location_id: string | null;
  frequency: string;
  enable_am_pm_division?: boolean;
  position_filtering_enabled?: boolean;
  lock_until_time?: string | null;
}
interface ResponseWithCompleter {
  responseId: string;
  value: any;
  isImage: boolean;
  extractedTemperature?: number | null;
  temperatureValid?: boolean | null;
  completedBy?: {
    userId: string;
    fullName: string;
    profilePhoto: string | null;
    completedAt: string;
  };
}
export default function CompleteChecklist() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  const isIOS = useIsIOS();

  // Parse YYYY-MM-DD as a LOCAL date (not UTC) to avoid off-by-one day issues
  const viewDate = useMemo(() => {
    if (!dateParam) return new Date();
    const [year, month, day] = dateParam.split('-').map(Number);
    if (!year || !month || !day) return new Date();
    return new Date(year, month - 1, day);
  }, [dateParam]);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [responsesWithCompleters, setResponsesWithCompleters] = useState<Record<string, ResponseWithCompleter>>({});
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [completionPercentage, setCompletionPercentage] = useState(0);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [manualTempOpen, setManualTempOpen] = useState<Record<string, boolean>>({});
  const [manualTempValue, setManualTempValue] = useState<Record<string, string>>({});
  const [uploadingItems, setUploadingItems] = useState<Record<string, boolean>>({});
  const notesTimeoutRef = useRef<NodeJS.Timeout>();
  const {
    user
  } = useAuth();
  const { isAdmin, isManager, isShiftManager } = useUserRole();
  const { currentLocation } = useLocation();
  const { timezone: locationTimezone } = useLocationTimezone();
  const { position: userPosition, loading: positionLoading } = useUserPosition(user?.id, currentLocation?.id);
  const [positionStartTimes, setPositionStartTimes] = useState<Record<string, string>>({});
  const [undoConfirmItemId, setUndoConfirmItemId] = useState<string | null>(null);
  
  // Position filter toggle - default to true (show only my position) when position filtering is enabled
  const posFilterKey = `positionFilter_${id}`;
  const [showOnlyMyPosition, setShowOnlyMyPosition] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(posFilterKey);
      return stored !== 'false'; // default true
    }
    return true;
  });
  
  // Hide completed items toggle - persists per checklist in localStorage
  const hideCompletedKey = `hideCompleted_${id}`;
  const [hideCompleted, setHideCompleted] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(hideCompletedKey) === 'true';
    }
    return false;
  });

  // Toggle hide completed and persist to localStorage
  const toggleHideCompleted = () => {
    const newValue = !hideCompleted;
    setHideCompleted(newValue);
    if (newValue) {
      localStorage.setItem(hideCompletedKey, 'true');
    } else {
      localStorage.removeItem(hideCompletedKey);
    }
  };

  // Fetch shift template start times for position labels
  useEffect(() => {
    if (!currentLocation?.id) return;
    const fetchPositionTimes = async () => {
      const { data } = await supabase
        .from('shift_templates')
        .select('position, start_time')
        .eq('location_id', currentLocation.id)
        .not('position', 'is', null);
      if (data) {
        const map: Record<string, string> = {};
        data.forEach((t: any) => {
          if (t.position && t.start_time && !map[t.position]) {
            map[t.position] = t.start_time;
          }
        });
        setPositionStartTimes(map);
      }
    };
    fetchPositionTimes();
  }, [currentLocation?.id]);

  const formatPositionLabel = useCallback((position: string | null | undefined) => {
    if (!position) return 'General';
    const startTime = positionStartTimes[position];
    if (!startTime) return position;
    const [hours, minutes] = startTime.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${position} · ${displayHour}:${minutes} ${ampm}`;
  }, [positionStartTimes]);

  // Clear localStorage when checklist reaches 100% completion
  useEffect(() => {
    if (completionPercentage === 100) {
      localStorage.removeItem(hideCompletedKey);
    }
  }, [completionPercentage, hideCompletedKey]);

  // Check if checklist is locked based on lock_until_time
  // Only applies to TODAY's checklist - historical views are never locked
  const isLocked = useMemo(() => {
    if (!checklist?.lock_until_time) return false;

    // Use the LOCATION'S timezone, not a hardcoded LA timezone.
    // lock_until_time (HH:MM) is stored as the location's local wall-clock time,
    // so the "now" comparison must be done in the same timezone — otherwise
    // stores outside PST (e.g. Tuscaloosa/CST) see the wrong lock window.
    const tz = locationTimezone || 'America/Los_Angeles';
    const now = new Date();
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const todayParts = dateFormatter.formatToParts(now);
    const todayYear = parseInt(todayParts.find(p => p.type === 'year')?.value || '0');
    const todayMonth = parseInt(todayParts.find(p => p.type === 'month')?.value || '0');
    const todayDay = parseInt(todayParts.find(p => p.type === 'day')?.value || '0');

    const viewYear = viewDate.getFullYear();
    const viewMonth = viewDate.getMonth() + 1;
    const viewDay = viewDate.getDate();

    const isHistorical =
      viewYear < todayYear ||
      (viewYear === todayYear && viewMonth < todayMonth) ||
      (viewYear === todayYear && viewMonth === todayMonth && viewDay < todayDay);

    if (isHistorical) return false;

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const currentTimeStr = timeFormatter.format(now);
    const [currentHour, currentMinute] = currentTimeStr.split(':').map(Number);
    const [lockHour, lockMinute] = checklist.lock_until_time.split(':').map(Number);

    const currentMinutes = currentHour * 60 + currentMinute;
    const lockMinutes = lockHour * 60 + lockMinute;

    return currentMinutes < lockMinutes;
  }, [checklist?.lock_until_time, viewDate, locationTimezone]);
  
  // Permission check: shift managers and above can undo
  const canUndoItems = isShiftManager;
  // currentLocation already declared above
  const navigate = useNavigate();
  const autoSaveTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    fetchChecklistData();
  }, [id, viewDate]);

  // Helper to check if a multi-photo item is complete
  const isMultiPhotoComplete = useCallback((item: ChecklistItem, response: any): boolean => {
    if (item.item_type !== 'image' && item.item_type !== 'PHOTO' && item.item_type !== 'temperature') return true;
    const minPhotos = item.options?.minPhotos || 1;
    if (minPhotos <= 1) return !!response;
    
    let photos: string[] = [];
    if (Array.isArray(response)) {
      photos = response;
    } else if (typeof response === 'string' && response.startsWith('[')) {
      try { photos = JSON.parse(response); } catch { photos = [response]; }
    } else if (response) {
      photos = [response];
    }
    return photos.length >= minPhotos;
  }, []);

  // Calculate completion percentage
  useEffect(() => {
    if (items.length === 0) return;
    const answerableItems = items.filter(item => item.item_type !== 'section_header');
    if (answerableItems.length === 0) {
      setCompletionPercentage(100);
      return;
    }
    const completedCount = answerableItems.filter(item => {
      const response = responses[item.id];
      if (item.item_type === 'confirmation' || item.item_type === 'CHECKMARK' || item.item_type === 'CHECKBOX') {
        return response === true;
      }
      if (item.item_type === 'image' || item.item_type === 'PHOTO' || item.item_type === 'temperature') {
        return isMultiPhotoComplete(item, response);
      }
      if (item.item_type === 'text' || item.item_type === 'number') {
        const savedResponse = responsesWithCompleters[item.id]?.value;
        return savedResponse !== undefined && savedResponse !== '' && savedResponse !== null;
      }
      return response !== undefined && response !== '' && response !== null;
    }).length;
    setCompletionPercentage(Math.round(completedCount / answerableItems.length * 100));
  }, [responses, responsesWithCompleters, items, isMultiPhotoComplete]);

  // Create or get shared submission (daily for daily/weekly, monthly for monthly checklists)
  useEffect(() => {
    // Get location_id from currentLocation or fall back to checklist's location_id
    const locationId = currentLocation?.id || checklist?.location_id;
    const isMonthly = checklist?.frequency === 'monthly';
    
    console.log('Submission effect triggered:', { id, userId: user?.id, locationId, checklistLocationId: checklist?.location_id, submissionId, frequency: checklist?.frequency });
    if (!id || !user?.id || !locationId || submissionId || !checklist) return;
    
    const createDraftSubmission = async () => {
      try {
        // For monthly checklists, use start of month; for daily/weekly use start of day
        let periodStart: Date;
        let periodEnd: Date;
        
        if (isMonthly) {
          // Start of current month
          periodStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1, 0, 0, 0, 0);
          // End of current month
          periodEnd = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0, 23, 59, 59, 999);
        } else {
          // Daily/weekly: use the specific day
          periodStart = new Date(viewDate);
          periodStart.setHours(0, 0, 0, 0);
          periodEnd = new Date(viewDate);
          periodEnd.setHours(23, 59, 59, 999);
        }

        console.log('Querying for existing submission:', { 
          checklistId: id, 
          locationId,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          isMonthly
        });

        // Check if there's already ANY submission for this period (shared by all users)
        // Get the submission with responses, or the most recent one if there are duplicates from race conditions
        const {
          data: submissions,
          error: submissionsError,
        } = await supabase
          .from('checklist_submissions')
          .select(`
            id,
            checklist_responses(count)
          `)
          .eq('checklist_id', id)
          .eq('location_id', locationId)
          .gte('submitted_at', periodStart.toISOString())
          .lte('submitted_at', periodEnd.toISOString())
          .order('submitted_at', { ascending: false });

        console.log('Submission query result:', { submissions, submissionsError });

        if (submissionsError) throw submissionsError;

        // Find the submission with the most responses (handles race condition duplicates)
        const existingSubmission = submissions?.reduce((best: any, current: any) => {
          const currentCount = current.checklist_responses?.[0]?.count || 0;
          const bestCount = best?.checklist_responses?.[0]?.count || 0;
          return currentCount > bestCount ? current : best;
        }, submissions[0]);
        
        if (existingSubmission) {
          // Use the existing shared submission for this day
          console.log('Using existing submission:', existingSubmission.id);
          setSubmissionId(existingSubmission.id);
        } else {
          // Create new shared daily submission
          console.log('Creating new submission...');
          const {
            data: newSubmission,
            error
          } = await supabase.from('checklist_submissions').insert({
            checklist_id: id,
            submitted_by: user.id,
            location_id: locationId,
            notes: ''
          }).select().single();
          console.log('New submission result:', { newSubmission, error });
          if (error) throw error;
          setSubmissionId(newSubmission.id);
        }
      } catch (error) {
        console.error('Error creating draft submission:', error);
      }
    };
    createDraftSubmission();
  }, [id, user, submissionId, viewDate, currentLocation?.id, checklist]);

  // Load existing responses (and completer info) whenever we have a submissionId
  useEffect(() => {
    const loadResponses = async () => {
      if (!submissionId) return;
      try {
        // First load all responses for this submission
        const { data: responsesData, error } = await supabase
          .from('checklist_responses')
          .select(`
            id,
            item_id,
            response_text,
            response_image_url,
            completed_by,
            created_at,
            extracted_temperature,
            temperature_valid
          `)
          .eq('submission_id', submissionId);

        if (error) throw error;

        // Load the submission notes
        const { data: submissionData } = await supabase
          .from('checklist_submissions')
          .select('notes')
          .eq('id', submissionId)
          .single();
        
        if (submissionData?.notes) {
          setNotes(submissionData.notes);
          setShowNotes(true); // Show notes section if notes exist
        }

        const loadedResponses: Record<string, any> = {};
        const loadedWithCompleters: Record<string, ResponseWithCompleter> = {};

        const completerIds = new Set<string>();

        (responsesData || []).forEach((resp: any) => {
          let value: any;
          let isImage = false;

          if (resp.response_image_url) {
            value = resp.response_image_url;
            isImage = true;
          } else if (resp.response_text !== null) {
            if (resp.response_text === 'true' || resp.response_text === 'false') {
              value = resp.response_text === 'true';
            } else if (resp.response_text.startsWith('[')) {
              // Multi-photo JSON array
              try {
                value = JSON.parse(resp.response_text);
                isImage = true;
              } catch {
                value = resp.response_text;
              }
            } else {
              value = resp.response_text;
            }
          }

          loadedResponses[resp.item_id] = value;

          // Always track the response so undo works even without completed_by
          loadedWithCompleters[resp.item_id] = {
            responseId: resp.id,
            value,
            isImage,
            extractedTemperature: resp.extracted_temperature,
            temperatureValid: resp.temperature_valid,
            completedBy: undefined,
          } as any;

          if (resp.completed_by) {
            completerIds.add(resp.completed_by);
          }
        });

        // Load profile details for all completers in one query
        let profilesMap: Record<string, { full_name: string | null; profile_photo_url: string | null }> = {};
        if (completerIds.size > 0) {
          const { data: profilesData, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name, profile_photo_url')
            .in('id', Array.from(completerIds));

          if (profilesError) throw profilesError;

          (profilesData || []).forEach((p: any) => {
            profilesMap[p.id] = {
              full_name: p.full_name,
              profile_photo_url: p.profile_photo_url,
            };
          });
        }

        // Attach completedBy info where we have it
        Object.entries(loadedWithCompleters).forEach(([itemId, data]) => {
          const response = responsesData?.find((r: any) => r.id === data.responseId);
          if (!response) return;
          const profile = response.completed_by ? profilesMap[response.completed_by] : undefined;
          (loadedWithCompleters as any)[itemId] = {
            ...data,
            completedBy: response.completed_by
              ? {
                  userId: response.completed_by,
                  fullName: profile?.full_name || 'Unknown',
                  profilePhoto: profile?.profile_photo_url || null,
                  completedAt: response.created_at,
                }
              : undefined,
          };
        });

        setResponses(loadedResponses);
        setResponsesWithCompleters(loadedWithCompleters);
      } catch (error) {
        console.error('Error loading existing responses:', error);
      }
    };

    loadResponses();
  }, [submissionId]);

  // Removed - no longer blocking users from continuing draft submissions

  const fetchChecklistData = async () => {
    try {
      const {
        data: checklistData,
        error: checklistError
      } = await supabase.from('checklists').select('*').eq('id', id).single();
      if (checklistError) throw checklistError;
      setChecklist(checklistData);
      const {
        data: itemsData,
        error: itemsError
      } = await supabase.from('checklist_items').select('*').eq('checklist_id', id).order('order_index');
      if (itemsError) throw itemsError;

      // For dynamic checklists, filter items for the viewing day
      if (checklistData.template_type === 'dynamic') {
        // Use timezone-aware day of week (Mon=0, Sun=6) - import from dateUtils
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: locationTimezone || 'America/Los_Angeles', weekday: 'short' });
        const dayName = formatter.format(viewDate);
        const dayMap: Record<string, number> = { 'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4, 'Sat': 5, 'Sun': 6 };
        const calendarDayIndex = dayMap[dayName] ?? 0;
        const dayItems = (itemsData || []).filter(item => item.days_of_week && item.days_of_week.includes(calendarDayIndex));
        if (dayItems.length === 0) {
          toast.error("No tasks assigned for this day in this checklist");
          navigate('/tasks');
          return;
        }
        setItems(dayItems);
      } else {
        setItems(itemsData || []);
      }
    } catch (error: any) {
      toast.error('Failed to load checklist');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  // Race-safe auto-save: single upsert on unique (submission_id, item_id).
  const autoSaveResponse = useCallback(async (itemId: string, value: any, isImage: boolean = false) => {
    if (!submissionId || !user?.id) return;
    try {
      const { data: upserted, error } = await supabase
        .from('checklist_responses')
        .upsert(
          {
            submission_id: submissionId,
            item_id: itemId,
            response_text: isImage ? null : typeof value === 'boolean' ? String(value) : value,
            response_image_url: isImage ? value : null,
            completed_by: user.id,
          },
          { onConflict: 'submission_id,item_id' }
        )
        .select('id')
        .single();

      if (error) throw error;
      const responseId = upserted?.id;

      console.log('[autosave]', { itemId, isImage, responseId, valuePreview: typeof value === 'string' ? value.slice(0, 40) : value });

      if (!responseId) {
        console.warn('No responseId available after save for item', itemId);
        return;
      }

      // Fetch updated completer info, but never block the saved/completed UI on profile data.
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, profile_photo_url')
        .eq('id', user.id)
        .maybeSingle();

      setResponsesWithCompleters(prev => ({
        ...prev,
        [itemId]: {
          responseId,
          value,
          isImage,
          completedBy: {
            userId: user.id,
            fullName: profile?.full_name || user.email || 'Unknown',
            profilePhoto: profile?.profile_photo_url || null,
            completedAt: new Date().toISOString()
          }
        }
      }));
    } catch (error: any) {
      console.error('[autosave] Error auto-saving response:', error, { itemId });
      serverDebugLog('autosave_error', {
        userId: user?.id,
        locationId: currentLocation?.id || checklist?.location_id || null,
        submissionId: submissionId || null,
        itemId,
        payload: {
          message: error?.message || String(error),
          code: error?.code || null,
          isImage,
        },
      });
      toast.error('Could not save your entry — check your connection and try again.');
    }
  }, [submissionId, user]);
  const handleResponseChange = (itemId: string, value: any, isImage: boolean = false) => {
    setResponses({
      ...responses,
      [itemId]: value
    });

    // Per-item debounce so typing in one field doesn't cancel another's pending save.
    const pending = autoSaveTimeoutsRef.current[itemId];
    if (pending) clearTimeout(pending);

    if (isImage || typeof value === 'boolean') {
      // Save immediately for images and checkboxes
      autoSaveResponse(itemId, value, isImage);
    } else {
      // Debounce text/number inputs per item
      autoSaveTimeoutsRef.current[itemId] = setTimeout(() => {
        autoSaveResponse(itemId, value, isImage);
        delete autoSaveTimeoutsRef.current[itemId];
      }, 1000);
    }
  };

  const handleNotesChange = (value: string) => {
    setNotes(value);

    // Debounce auto-save for notes
    if (notesTimeoutRef.current) {
      clearTimeout(notesTimeoutRef.current);
    }
    
    notesTimeoutRef.current = setTimeout(async () => {
      if (submissionId) {
        try {
          await supabase
            .from('checklist_submissions')
            .update({ notes: value })
            .eq('id', submissionId);
        } catch (error) {
          console.error('Error saving notes:', error);
        }
      }
    }, 1000);
  };
  const handleUndoCompletion = async (itemId: string) => {
    const responseData = responsesWithCompleters[itemId];
    if (!responseData?.responseId) return;
    try {
      const {
        error
      } = await supabase.from('checklist_responses').delete().eq('id', responseData.responseId);
      if (error) throw error;

      // Remove from state
      const newResponses = {
        ...responses
      };
      delete newResponses[itemId];
      setResponses(newResponses);
      const newCompleters = {
        ...responsesWithCompleters
      };
      delete newCompleters[itemId];
      setResponsesWithCompleters(newCompleters);
      toast.success('Item uncompleted');
      setUndoConfirmItemId(null);
    } catch (error) {
      console.error('Error undoing completion:', error);
      toast.error('Failed to undo completion');
    }
  };
  
  const handleUndoClick = (itemId: string) => {
    setUndoConfirmItemId(itemId);
  };
  // Helper to get minPhotos from item options
  const getMinPhotos = (item: ChecklistItem): number => {
    if (item.options && typeof item.options === 'object' && !Array.isArray(item.options)) {
      return item.options.minPhotos || 1;
    }
    return 1;
  };

  // Get current photos array for an item
  const getPhotosForItem = (itemId: string): string[] => {
    const response = responses[itemId];
    if (!response) return [];
    if (Array.isArray(response)) return response;
    if (typeof response === 'string' && response.startsWith('[')) {
      try {
        return JSON.parse(response);
      } catch {
        return [response];
      }
    }
    return response ? [response] : [];
  };

  const getTemperatureValidity = (tempF: number): boolean => {
    // Food safety guidelines: cold holding ≤ 41°F, hot holding ≥ 135°F
    return tempF <= 41 || tempF >= 135;
  };

  const saveManualTemperature = async (itemId: string, tempText: string) => {
    const trimmed = tempText?.trim();
    if (!trimmed || trimmed === '') {
      toast.error('Please enter a temperature');
      return;
    }
    const tempF = Number(trimmed);
    if (!Number.isFinite(tempF)) {
      toast.error('Enter a valid temperature');
      return;
    }
    if (!submissionId || !user?.id) return;

    const tempValid = getTemperatureValidity(tempF);

    try {
      const { data: existing, error: existingError } = await supabase
        .from('checklist_responses')
        .select('id')
        .eq('submission_id', submissionId)
        .eq('item_id', itemId)
        .maybeSingle();

      if (existingError) throw existingError;

      const responseData = {
        response_image_url: null,
        response_text: String(tempF),
        completed_by: user.id,
        extracted_temperature: tempF,
        temperature_valid: tempValid,
        temperature_validated_at: new Date().toISOString(),
      };

      let responseId: string | undefined;
      if (existing?.id) {
        const { error: updateError } = await supabase
          .from('checklist_responses')
          .update(responseData)
          .eq('id', existing.id);
        if (updateError) throw updateError;
        responseId = existing.id;
      } else {
        const { data: newResponse, error: insertError } = await supabase
          .from('checklist_responses')
          .insert({ submission_id: submissionId, item_id: itemId, ...responseData })
          .select('id')
          .single();
        if (insertError) throw insertError;
        responseId = newResponse?.id;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, profile_photo_url')
        .eq('id', user.id)
        .single();

      setResponses(prev => ({ ...prev, [itemId]: String(tempF) }));
      setResponsesWithCompleters(prev => ({
        ...prev,
        [itemId]: {
          responseId: responseId || '',
          value: String(tempF),
          isImage: false,
          extractedTemperature: tempF,
          temperatureValid: tempValid,
          completedBy: profile
            ? {
                userId: user.id,
                fullName: profile.full_name || 'Unknown',
                profilePhoto: profile.profile_photo_url,
                completedAt: new Date().toISOString(),
              }
            : undefined,
        },
      }));

      setManualTempOpen(prev => ({ ...prev, [itemId]: false }));
      toast.success('Temperature saved');
    } catch (error: any) {
      console.error('Error saving manual temperature:', error);
      toast.error('Failed to save temperature');
    }
  };

  const handleImageUpload = async (itemId: string, file: File, photoIndex?: number) => {
    // Guard: if an upload is already in flight for this item, ignore the second tap.
    // Prevents duplicate photos when users tap again thinking nothing happened.
    if (uploadingItems[itemId]) {
      toast.info('Upload in progress — please wait');
      return;
    }
    const item = items.find(i => i.id === itemId);
    const minPhotos = item ? getMinPhotos(item) : 1;
    const isMultiPhoto = minPhotos > 1;

    console.log('handleImageUpload called:', { itemId, submissionId, userId: user?.id });

    // ---------- OPTIMISTIC UPDATE ----------
    // Immediately show the photo as complete using a local blob URL so the
    // user sees instant feedback while the real upload finishes in the
    // background (compression + storage + AI temp validation can take 10s+).
    const blobUrl = URL.createObjectURL(file);
    const previousResponses = responses;
    const previousResponsesWithCompleters = responsesWithCompleters;

    let optimisticValue: string | string[];
    if (isMultiPhoto) {
      const currentPhotos = getPhotosForItem(itemId);
      if (photoIndex !== undefined && photoIndex < currentPhotos.length) {
        const next = [...currentPhotos];
        next[photoIndex] = blobUrl;
        optimisticValue = next;
      } else {
        optimisticValue = [...currentPhotos, blobUrl];
      }
    } else {
      optimisticValue = blobUrl;
    }

    setResponses(prev => ({ ...prev, [itemId]: optimisticValue }));
    setResponsesWithCompleters(prev => ({
      ...prev,
      [itemId]: {
        responseId: prev[itemId]?.responseId || '',
        value: optimisticValue,
        isImage: true,
        extractedTemperature: prev[itemId]?.extractedTemperature ?? null,
        temperatureValid: prev[itemId]?.temperatureValid ?? null,
        completedBy: prev[itemId]?.completedBy,
      },
    }));
    setUploadingItems(prev => ({ ...prev, [itemId]: true }));

    try {
      // Compress image to reduce memory usage on mobile devices
      const compressedFile = await compressImage(file, 1200, 1200, 0.8);
      
      const fileName = `${user?.id}/${Date.now()}.jpg`;
      
      // Use retry logic for flaky Android connections
      const { publicUrl } = await uploadWithRetry(supabase, 'checklist-images', fileName, compressedFile, 3);
      console.log('Image uploaded successfully:', publicUrl);
      
      const data = { publicUrl };
      
      // Only extract temperature for temperature-type items OR image items with requires_temperature_validation
      const item = items.find(i => i.id === itemId);
      let extractedTemp = null;
      let tempValid = null;

      const shouldValidateTemp = item?.item_type === 'temperature' || 
        (item?.item_type === 'image' && item?.requires_temperature_validation === true);

      if (shouldValidateTemp) {
        const { data: tempData, error: tempError } = await supabase.functions.invoke(
          'ai-extraction-service?action=extract-temperature',
          { body: { imageUrl: data.publicUrl } }
        );

        if (!tempError && tempData) {
          extractedTemp = tempData.temperature;
          tempValid = tempData.isValid;
          
          // Alert managers if temperature is out of safe zone
          const taskLocationId = currentLocation?.id || checklist?.location_id;
          if (tempValid === false && extractedTemp !== null && taskLocationId && user?.id) {
            const alertTitle = `🌡️ Unsafe Temp: ${item.question}`;
            const alertBody = `${extractedTemp}°F is out of safe zone. Verify and take corrective action.`;
            const dedupKey = `temp_alert_${taskLocationId}_${item.id}_${new Date().toISOString().split('T')[0]}_${Date.now()}`;

            // Resolve manager user IDs for this location
            const { data: managerUsers } = await supabase
              .from('user_locations')
              .select('user_id, user_roles!inner(role)')
              .eq('location_id', taskLocationId)
              .in('user_roles.role', ['super_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager', 'shift_manager_in_training']);

            const managerIds = managerUsers?.map((u: any) => u.user_id) || [];

            if (managerIds.length > 0) {
              // Queue alert for manager dashboard + push notification
              const { error: alertError } = await supabase
                .from('alert_queue')
                .insert({
                  alert_type: 'unsafe_temperature',
                  dedup_key: dedupKey,
                  location_id: taskLocationId,
                  payload: {
                    user_ids: managerIds,
                    title: alertTitle,
                    body: alertBody,
                    notification_type: 'unsafe_temperature',
                    data: {
                      type: 'unsafe_temperature',
                      location_id: taskLocationId,
                      checklist_item: item.question,
                      temperature: extractedTemp
                    }
                  }
                });

              if (!alertError) {
                toast.warning(`Temperature out of range — managers notified`, {
                  description: `${extractedTemp}°F on ${item.question}`
                });
              }
            }
          }
        }
      }

      // Swap the blob URL for the real public URL. IMPORTANT: use the
      // optimisticValue we just computed — NOT `responses[itemId]` from
      // the closure, which is stale (pre-handler) state and would drop
      // the newly-added photo when persisting the JSON array.
      const swapBlob = (arr: string[]) =>
        arr.map(u => (u === blobUrl ? data.publicUrl : u));

      let newValue: string | string[];
      if (isMultiPhoto) {
        const base = Array.isArray(optimisticValue) ? optimisticValue : [optimisticValue as string];
        newValue = swapBlob(base);
        console.log('[multi-photo save]', {
          itemId,
          blobUrl,
          publicUrl: data.publicUrl,
          optimisticCount: base.length,
          persistedCount: (newValue as string[]).length,
          persisted: newValue,
        });
        serverDebugLog('multi_photo_save', {
          userId: user?.id,
          locationId: currentLocation?.id || checklist?.location_id || null,
          submissionId: submissionId || null,
          itemId,
          payload: {
            publicUrl: data.publicUrl,
            optimisticCount: base.length,
            persistedCount: (newValue as string[]).length,
            urls: newValue,
            fileSizeKB: Math.round(file.size / 1024),
          },
        });
      } else {
        newValue = data.publicUrl;
      }

      // Persist to DB
      let responseId: string | undefined;
      if (submissionId && user?.id) {
        console.log('Saving response for submission:', submissionId);
        const { data: existing, error: existingError } = await supabase
          .from('checklist_responses')
          .select('id')
          .eq('submission_id', submissionId)
          .eq('item_id', itemId)
          .maybeSingle();

        console.log('Existing response check:', { existing, existingError });

        const responseData = {
          response_image_url: isMultiPhoto ? null : data.publicUrl,
          response_text: isMultiPhoto ? JSON.stringify(newValue) : null,
          completed_by: user.id,
          extracted_temperature: extractedTemp,
          temperature_valid: tempValid,
          temperature_validated_at: new Date().toISOString()
        };

        if (existing) {
          const { error: updateError } = await supabase
            .from('checklist_responses')
            .update(responseData)
            .eq('id', existing.id);
          console.log('Update response result:', { updateError });
          if (updateError) throw updateError;
          responseId = existing.id;
        } else {
          const { data: newResponse, error: insertError } = await supabase
            .from('checklist_responses')
            .insert({
              submission_id: submissionId,
              item_id: itemId,
              ...responseData
            })
            .select('id')
            .single();
          console.log('Insert response result:', { newResponse, insertError });
          if (insertError) throw insertError;
          responseId = newResponse?.id;
        }

        // Fetch user profile for completer info
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, profile_photo_url')
          .eq('id', user.id)
          .single();

        // Swap blob → real URL in state (preserves any other concurrent edits)
        setResponses(prev => {
          const current = prev[itemId];
          if (isMultiPhoto && Array.isArray(current)) {
            return { ...prev, [itemId]: swapBlob(current) };
          }
          return { ...prev, [itemId]: newValue };
        });
        setResponsesWithCompleters(prev => {
          const current = prev[itemId];
          const currentVal = current?.value;
          const swapped =
            isMultiPhoto && Array.isArray(currentVal) ? swapBlob(currentVal) : newValue;
          return {
            ...prev,
            [itemId]: {
              responseId: responseId || '',
              value: swapped,
              isImage: true,
              extractedTemperature: extractedTemp,
              temperatureValid: tempValid,
              completedBy: profile ? {
                userId: user.id,
                fullName: profile.full_name || 'Unknown',
                profilePhoto: profile.profile_photo_url,
                completedAt: new Date().toISOString()
              } : undefined
            }
          };
        });
      }

      // Silent success — the user already saw the photo appear optimistically.
    } catch (error: any) {
      // Revert the optimistic update so the user knows to retry.
      setResponses(previousResponses);
      setResponsesWithCompleters(previousResponsesWithCompleters);

      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('memory') || msg.includes('out of memory') || msg.includes('low memory')) {
        toast.error('Low memory: try choosing an existing photo instead');
      } else {
        toast.error('Photo upload failed — please retry');
      }
    } finally {
      // Release the blob URL after a beat so the <img> has time to swap sources.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      setUploadingItems(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }
  };

  if (loading) {
    return <Layout>
        <div className="text-center text-muted-foreground">Loading checklist...</div>
      </Layout>;
  }
  if (!checklist) {
    return null;
  }
  // Format lock time for display
  const formatLockTime = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 || 12;
    return `${displayHour}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  // If locked, show lock overlay
  if (isLocked && checklist?.lock_until_time) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h2 className="text-3xl font-bold">{checklist.title}</h2>
            {checklist.description && <p className="text-muted-foreground">{checklist.description}</p>}
          </div>
          
          <Card className="border-2 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Lock className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">Checklist Locked</h3>
              <p className="text-muted-foreground">
                This checklist will unlock at <span className="font-semibold">{formatLockTime(checklist.lock_until_time)}</span>
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{checklist.title}</h2>
            <Badge variant={completionPercentage === 100 ? "default" : "secondary"} className="text-xs px-2 py-0.5">
              {completionPercentage}%
            </Badge>
          </div>
          {checklist.description && <p className="text-xs text-muted-foreground">{checklist.description}</p>}
          
          {/* Toggles */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
            <div className="flex items-center gap-2">
              <Switch
                id="hide-completed"
                checked={hideCompleted}
                onCheckedChange={toggleHideCompleted}
              />
              <Label htmlFor="hide-completed" className="text-sm text-muted-foreground cursor-pointer">
                Hide completed
              </Label>
            </div>
            
            {/* Position filter toggle — only show when position filtering is enabled and user has a position */}
            {checklist?.position_filtering_enabled && userPosition && (
              <div className="flex items-center gap-2">
                <Switch
                  id="position-filter"
                  checked={showOnlyMyPosition}
                  onCheckedChange={(checked) => {
                    setShowOnlyMyPosition(checked);
                    if (checked) {
                      localStorage.setItem(posFilterKey, 'true');
                    } else {
                      localStorage.setItem(posFilterKey, 'false');
                    }
                  }}
                />
                <Label htmlFor="position-filter" className="text-sm text-muted-foreground cursor-pointer">
                  My tasks ({formatPositionLabel(userPosition)})
                </Label>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {(() => {
            // Filter items based on hideCompleted
            let filteredItems = items.filter(item => {
              if (!hideCompleted) return true;
              const isImageItem = item.item_type === 'image' || item.item_type === 'PHOTO' || item.item_type === 'temperature';
              const hasResponse = isImageItem 
                ? isMultiPhotoComplete(item, responses[item.id])
                : (item.item_type === 'text' || item.item_type === 'number')
                ? responsesWithCompleters[item.id]?.value !== undefined && responsesWithCompleters[item.id]?.value !== '' && responsesWithCompleters[item.id]?.value !== null
                : responses[item.id] !== undefined && responses[item.id] !== '' && responses[item.id] !== null;
              return !hasResponse;
            });

            // Position filtering: if enabled and user has position and toggle is on, filter
            const hasPositionFiltering = checklist?.position_filtering_enabled;
            if (hasPositionFiltering && userPosition && showOnlyMyPosition) {
              filteredItems = filteredItems.filter(item => 
                !item.position || item.position === userPosition
              );
            }

            // If position filtering is enabled, sort/group by position
            if (hasPositionFiltering) {
              filteredItems = [...filteredItems].sort((a, b) => {
                const aPos = a.position || '\uffff'; // unassigned last
                const bPos = b.position || '\uffff';
                if (aPos !== bPos) return aPos.localeCompare(bPos);
                return (a.order_index || 0) - (b.order_index || 0);
              });
            }

            // If AM/PM division is enabled, sort and group items
            // BUT: if the checklist uses section headers, respect the user's manual order
            // (headers already define the grouping — auto-sort would break it)
            const hasAmPmDivision = checklist?.enable_am_pm_division;
            const hasSectionHeaders = filteredItems.some(i => i.item_type === 'section_header');
            let sortedItems = filteredItems;
            
            if (hasAmPmDivision && !hasSectionHeaders) {
              sortedItems = [...filteredItems].sort((a, b) => {
                const shiftOrder = { 'am': 0, 'pm': 1, null: 2, undefined: 2 };
                const aOrder = shiftOrder[a.manager_shift as keyof typeof shiftOrder] ?? 2;
                const bOrder = shiftOrder[b.manager_shift as keyof typeof shiftOrder] ?? 2;
                if (aOrder !== bOrder) return aOrder - bOrder;
                return (a.order_index || 0) - (b.order_index || 0);
              });
            }

            // Track position headers for dividers
            let lastRenderedPosition: string | null | undefined = undefined;
            let renderedDivider = false;
            
            return sortedItems.map((item, idx) => {
              const showDivider = hasAmPmDivision && 
                !hasSectionHeaders &&
                !renderedDivider && 
                item.manager_shift === 'pm' && 
                sortedItems.some(i => i.manager_shift === 'am');
              
              if (showDivider) {
                renderedDivider = true;
              }

              // Position section headers
              const showPositionHeader = hasPositionFiltering && 
                item.position !== lastRenderedPosition;
              if (showPositionHeader) {
                lastRenderedPosition = item.position;
              }

          const completerInfo = responsesWithCompleters[item.id]?.completedBy;
          const isImageItem = item.item_type === 'image' || item.item_type === 'PHOTO' || item.item_type === 'temperature';
          const isTextEntryItem = item.item_type === 'text' || item.item_type === 'number';
          const hasResponse = isImageItem 
            ? isMultiPhotoComplete(item, responses[item.id])
            : isTextEntryItem
            ? responsesWithCompleters[item.id]?.value !== undefined && responsesWithCompleters[item.id]?.value !== '' && responsesWithCompleters[item.id]?.value !== null
            : responses[item.id] !== undefined && responses[item.id] !== '' && responses[item.id] !== null;
          const currentPhotos = isImageItem ? getPhotosForItem(item.id) : [];

          if (item.item_type === 'section_header') {
            return (
              <div key={item.id} className="pt-4 pb-1 first:pt-0">
                <h2 className="text-base font-semibold tracking-tight border-b border-border pb-1.5">
                  {item.question || 'Section'}
                </h2>
              </div>
            );
          }

          if (item.item_type === 'prep_list') {
            const businessDate = dateParam || (() => {
              const y = viewDate.getFullYear();
              const m = String(viewDate.getMonth() + 1).padStart(2, '0');
              const d = String(viewDate.getDate()).padStart(2, '0');
              return `${y}-${m}-${d}`;
            })();
            return (
              <div key={item.id} className="space-y-2">
                <div className="px-1">
                  <h3 className="text-sm font-medium">
                    {item.question}
                    {item.is_required && <span className="text-destructive ml-1">*</span>}
                  </h3>
                </div>
                <div className="border-t border-border" />
                <Card>
                  <CardContent className="p-2">
                    <PrepListComplete
                      itemId={item.id}
                      submissionId={submissionId}
                      locationId={currentLocation?.id || checklist?.location_id || null}
                      businessDate={businessDate}
                      userId={user?.id || null}
                      onAllFilledChange={(filled) => {
                        setResponses(prev => {
                          const cur = prev[item.id];
                          const next = filled ? 'prep_list_complete' : undefined;
                          if (cur === next) return prev;
                          const copy = { ...prev };
                          if (filled) copy[item.id] = 'prep_list_complete';
                          else delete copy[item.id];
                          return copy;
                        });
                      }}
                    />
                  </CardContent>
                </Card>
              </div>
            );
          }

          return (
            <div key={item.id}>
              {/* Position Section Header */}
              {showPositionHeader && (
                <div className="flex items-center gap-3 py-3 my-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                  <span className="text-sm font-semibold text-primary px-3 py-1 rounded-full bg-primary/10">
                    {formatPositionLabel(item.position)}
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                </div>
              )}
              {showDivider && (
                <div className="flex items-center gap-3 py-4 my-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
                  <span className="text-sm font-semibold text-blue-600 dark:text-blue-400 px-3 py-1 rounded-full bg-blue-100/50 dark:bg-blue-900/30">
                    PM Tasks
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
                </div>
              )}
              
              {/* Show AM label for first AM item */}
              {hasAmPmDivision && idx === 0 && item.manager_shift === 'am' && (
                <div className="flex items-center gap-3 pb-3 mb-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
                  <span className="text-sm font-semibold text-amber-600 dark:text-amber-400 px-3 py-1 rounded-full bg-amber-100/50 dark:bg-amber-900/30">
                    AM Tasks
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
                </div>
              )}
              
              <div className="space-y-2">
              {/* Title above divider - never blurred */}
              <div className="px-1 flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-medium">
                  {item.question}
                  {item.is_required && <span className="text-destructive ml-1">*</span>}
                </h3>
                {item.manager_shift === 'am' && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700">
                    ☀ AM
                  </span>
                )}
                {item.manager_shift === 'pm' && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-indigo-900 text-indigo-100 border-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
                    ☾ PM
                  </span>
                )}
              </div>

              {/* Deep-link chips: recipes, logs, teammates, roles tagged by the author */}
              <ChecklistLinkChips
                refs={parseLinkRefs((item as any).link_refs)}
                onOpen={(ref) => setActiveLink(ref)}
                className="px-1"
              />
              
              {/* Horizontal divider */}
              <div className="border-t border-border" />
              
              {/* Card with content */}
              <Card
                className="overflow-hidden relative"
                style={isImageItem ? { contentVisibility: 'auto', containIntrinsicSize: '1px 320px' } as React.CSSProperties : undefined}
              >
              {/* For completed image items — bottom bar with completion info (no blur overlay) */}
              {hasResponse && isImageItem && (
                <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-2 bg-background/90 border-t border-border px-3 py-2">
                  {canUndoItems ? (
                    <button
                      type="button"
                      onClick={() => handleUndoClick(item.id)}
                      aria-label={`Undo completion${completerInfo ? ` by ${completerInfo.fullName}` : ''}`}
                      className="inline-flex items-center gap-2 min-w-0 max-w-full rounded-full border border-green-600/40 bg-green-50 dark:bg-green-950/40 px-2 py-1 active:scale-95 transition-transform"
                    >
                      <div className="shrink-0">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      </div>
                      {completerInfo && (
                        <>
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage src={completerInfo.profilePhoto || undefined} />
                            <AvatarFallback className="text-[10px]">
                              {completerInfo.fullName.split(' ').map(n => n[0]).join('')}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium truncate">
                            {completerInfo.fullName.split(' ')[0]} {completerInfo.fullName.split(' ')[1]?.[0]}.
                          </span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-2 min-w-0 max-w-full rounded-full border border-green-600/40 bg-green-50 dark:bg-green-950/40 px-2 py-1">
                      <div className="shrink-0">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      </div>
                      {completerInfo && (
                        <>
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage src={completerInfo.profilePhoto || undefined} />
                            <AvatarFallback className="text-[10px]">
                              {completerInfo.fullName.split(' ').map(n => n[0]).join('')}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium truncate">
                            {completerInfo.fullName.split(' ')[0]} {completerInfo.fullName.split(' ')[1]?.[0]}.
                          </span>
                        </>
                      )}
                    </div>
                  )}
                  {completerInfo && (
                    <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                      {formatTime12Hour(new Date(completerInfo.completedAt).toTimeString().slice(0, 5))}
                    </span>
                  )}

                  {/* Temperature badge inline */}
                  {responsesWithCompleters[item.id]?.extractedTemperature !== null && 
                   responsesWithCompleters[item.id]?.extractedTemperature !== undefined && (
                    responsesWithCompleters[item.id]?.temperatureValid === false ? (
                      <Badge variant="destructive" className="ml-auto text-xs">
                        <ThumbsDown className="h-3 w-3 mr-1" /> {responsesWithCompleters[item.id]?.extractedTemperature?.toFixed(1)}°F
                      </Badge>
                    ) : (
                      <Badge className="ml-auto text-xs bg-green-600">
                        <ThumbsUp className="h-3 w-3 mr-1" /> {responsesWithCompleters[item.id]?.extractedTemperature?.toFixed(1)}°F
                      </Badge>
                    )
                  )}
                </div>
              )}
                
                {/* Option C: For non-image items with response — inline completion row replaces content */}
                {hasResponse && !isImageItem ? (
                  <CardContent className="py-2">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {canUndoItems ? (
                          <button
                            type="button"
                            onClick={() => handleUndoClick(item.id)}
                            aria-label={`Undo completion${completerInfo ? ` by ${completerInfo.fullName}` : ''}`}
                            className="inline-flex items-center gap-2 min-w-0 max-w-full rounded-full border border-green-600/40 bg-green-50 dark:bg-green-950/40 px-2 py-1 active:scale-95 transition-transform"
                          >
                            <div className="shrink-0">
                              <CheckCircle2 className="h-5 w-5 text-green-600" />
                            </div>
                            {completerInfo && (
                              <>
                                <Avatar className="h-7 w-7 shrink-0">
                                  <AvatarImage src={completerInfo.profilePhoto || undefined} />
                                  <AvatarFallback className="text-[10px]">
                                    {completerInfo.fullName.split(' ').map(n => n[0]).join('')}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm font-medium truncate">
                                  {completerInfo.fullName.split(' ')[0]} {completerInfo.fullName.split(' ')[1]?.[0]}.
                                </span>
                              </>
                            )}
                          </button>
                        ) : (
                          <div className="inline-flex items-center gap-2 min-w-0 max-w-full rounded-full border border-green-600/40 bg-green-50 dark:bg-green-950/40 px-2 py-1">
                            <div className="shrink-0">
                              <CheckCircle2 className="h-5 w-5 text-green-600" />
                            </div>
                            {completerInfo && (
                              <>
                                <Avatar className="h-7 w-7 shrink-0">
                                  <AvatarImage src={completerInfo.profilePhoto || undefined} />
                                  <AvatarFallback className="text-[10px]">
                                    {completerInfo.fullName.split(' ').map(n => n[0]).join('')}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm font-medium truncate">
                                  {completerInfo.fullName.split(' ')[0]} {completerInfo.fullName.split(' ')[1]?.[0]}.
                                </span>
                              </>
                            )}
                          </div>
                        )}
                        {completerInfo && (
                          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                            {formatTime12Hour(new Date(completerInfo.completedAt).toTimeString().slice(0, 5))}
                          </span>
                        )}
                      </div>

                      {isTextEntryItem && (
                        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap break-words">
                          {String(responsesWithCompleters[item.id]?.value ?? responses[item.id] ?? '')}
                        </div>
                      )}
                    </div>
                  </CardContent>
                ) : (
                  <>
                {/* Show non-image reference material in header (links, video, notes without ref image) */}
                {!(hasResponse && isImageItem) && !( isImageItem && item.reference_image_url) && (item.reference_notes || item.reference_image_url || item.reference_link || item.reference_video_url) && (
                <CardHeader className={`pb-3 ${hasResponse ? 'pointer-events-none sm:py-2' : ''}`}>
                  <div className="space-y-2 bg-muted/30 p-2 rounded text-xs">
                      {item.reference_notes && (
                        <p className="text-muted-foreground whitespace-pre-wrap">{item.reference_notes}</p>
                      )}
                      
                      {item.reference_image_url && <div className="space-y-1">
                          <Badge variant="secondary" className="text-[10px] h-4 gap-1">
                            <Eye className="h-2.5 w-2.5" />
                            Reference Standard
                          </Badge>
                          <div 
                            className="relative cursor-pointer group/ref" 
                            onClick={() => setPreviewImage(item.reference_image_url!)}
                          >
                            <img src={item.reference_image_url} alt="Reference standard" loading="lazy" decoding="async" className="rounded max-h-36 object-cover border border-primary/20 shadow-sm" />
                            <div className="absolute inset-0 bg-black/0 group-hover/ref:bg-black/10 transition-colors rounded flex items-center justify-center">
                              <Eye className="h-5 w-5 text-white opacity-0 group-hover/ref:opacity-80 transition-opacity drop-shadow" />
                            </div>
                          </div>
                        </div>}
                      
                      {item.reference_link && <div className="space-y-0.5">
                          <Badge variant="secondary" className="text-[10px] h-4">Link</Badge>
                          <a href={item.reference_link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline block break-all">
                            {item.reference_link}
                          </a>
                        </div>}
                      
                      {item.reference_video_url && <div className="space-y-0.5">
                          <Badge variant="secondary" className="text-[10px] h-4">Video</Badge>
                          <a href={item.reference_video_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline block break-all">
                            {item.reference_video_url}
                          </a>
                        </div>}
                    </div>
                </CardHeader>
                )}
                <CardContent className={`${hasResponse && isImageItem ? 'p-0 pb-10' : 'pt-0 pb-2'} ${hasResponse && !isImageItem ? 'pointer-events-none' : ''}`}>
                  {item.item_type === 'text' && (
                    <div className="space-y-2">
                      <Textarea
                        value={responses[item.id] ?? ''}
                        onChange={e => setResponses(prev => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder="Enter your response"
                        required={item.is_required}
                        className="min-h-[60px] text-sm"
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={!responses[item.id] || String(responses[item.id]).trim() === ''}
                        onClick={() => autoSaveResponse(item.id, String(responses[item.id] ?? '').trim(), false)}
                      >
                        Submit
                      </Button>
                    </div>
                  )}
                  {item.item_type === 'number' && (
                    <div className="space-y-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={responses[item.id] ?? ''}
                        onChange={e => setResponses(prev => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder="Enter a number"
                        required={item.is_required}
                        className="text-sm"
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={responses[item.id] === undefined || responses[item.id] === '' || responses[item.id] === null}
                        onClick={() => autoSaveResponse(item.id, String(responses[item.id] ?? ''), false)}
                      >
                        Submit
                      </Button>
                    </div>
                  )}
                  {item.item_type === 'multiple_choice' && item.options && <RadioGroup value={responses[item.id] || ''} onValueChange={value => handleResponseChange(item.id, value)} required={item.is_required} className="space-y-1.5">
                      {item.options.map(option => <div key={option} className="flex items-center space-x-2">
                          <RadioGroupItem value={option} id={`${item.id}-${option}`} className="h-4 w-4" />
                          <Label htmlFor={`${item.id}-${option}`} className="text-sm font-normal cursor-pointer">{option}</Label>
                        </div>)}
                    </RadioGroup>}
                  {(item.item_type === 'image' || item.item_type === 'PHOTO' || item.item_type === 'temperature') && (() => {
                    const minPhotos = getMinPhotos(item);
                    const isMultiPhoto = minPhotos > 1;
                    const showManualTemp = item.item_type === 'temperature';
                    const currentPhotos = getPhotosForItem(item.id).filter(p => typeof p === 'string' && (p.startsWith('http') || p.startsWith('blob:')));
                    const photosNeeded = Math.max(minPhotos - currentPhotos.length, 0);
                    const hasManualTemp = showManualTemp && responsesWithCompleters[item.id]?.extractedTemperature != null;
                    const isComplete = currentPhotos.length >= minPhotos || hasManualTemp;

                    const hasSplitView = !!item.reference_image_url && !isMultiPhoto;

                    const isUploading = !!uploadingItems[item.id];

                    return (
                      <div className="space-y-3">
                        {isMultiPhoto && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {currentPhotos.length} / {minPhotos} photos uploaded
                            </span>
                            {isComplete && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                            {isUploading && (
                              <span className="text-xs text-muted-foreground animate-pulse">Uploading…</span>
                            )}
                          </div>
                        )}

                        {/* Split View: Reference on left, Camera/Photo on right */}
                        {hasSplitView && !hasResponse ? (
                          <div className="grid grid-cols-2 gap-3">
                            {/* Left: Reference Standard */}
                            <div className="space-y-1.5">
                              <Badge variant="secondary" className="text-[10px] h-4 gap-1">
                                <Eye className="h-2.5 w-2.5" />
                                Standard
                              </Badge>
                              <div className="relative rounded-lg overflow-hidden border border-primary/20 bg-muted/20">
                                <img 
                                  src={item.reference_image_url} 
                                  alt="Reference standard" 
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full aspect-square object-cover" 
                                />
                                <button
                                  type="button"
                                  onClick={() => setPreviewImage(item.reference_image_url!)}
                                  className="absolute top-1.5 right-1.5 p-1.5 bg-background/80 rounded-full hover:bg-background transition-colors shadow-sm"
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                              </div>
                              {item.reference_notes && (
                                <p className="text-[10px] text-muted-foreground italic leading-tight line-clamp-2">📋 {item.reference_notes}</p>
                              )}
                            </div>

                            {/* Right: Camera / Uploaded Photo */}
                            <div className="space-y-1.5">
                              <Badge variant="outline" className="text-[10px] h-4 gap-1">
                                <Camera className="h-2.5 w-2.5" />
                                Your Photo
                              </Badge>
                              {currentPhotos.length > 0 ? (
                                <div className="relative rounded-lg overflow-hidden border">
                                  <img
                                    src={currentPhotos[0]}
                                    alt="Your photo"
                                    className="w-full aspect-square object-cover"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setPreviewImage(currentPhotos[0])}
                                    className="absolute top-1.5 right-1.5 p-1.5 bg-background/80 rounded-full hover:bg-background transition-colors shadow-sm"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </button>
                                </div>
                              ) : isUploading ? (
                                <div className="flex flex-col items-center justify-center aspect-square rounded-lg border-2 border-dashed border-primary/40 bg-primary/5">
                                  <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin mb-1" />
                                  <span className="text-[10px] text-primary">Uploading…</span>
                                </div>
                              ) : (
                                <PhotoPickerButton
                                  onFileSelected={(file) => handleImageUpload(item.id, file)}
                                  className="block w-full"
                                  disabled={isUploading}
                                >
                                  <div className="flex flex-col items-center justify-center aspect-square rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer">
                                    <Camera className="h-8 w-8 text-muted-foreground mb-1" />
                                    <span className="text-[10px] text-muted-foreground">Tap to snap</span>
                                  </div>
                                </PhotoPickerButton>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                        {/* Display existing photos (non-split view) */}
                        {currentPhotos.length > 0 && (
                          <div className={`grid gap-2 ${isMultiPhoto ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-1'}`}>
                            {currentPhotos.map((photoUrl, idx) => (
                              <div key={idx} className="relative group/photo cursor-pointer" onClick={() => setPreviewImage(photoUrl)}>
                              <img
                                  src={photoUrl}
                                  alt={`Checklist photo ${idx + 1}`}
                                  className={`object-cover w-full rounded ${isMultiPhoto ? 'border aspect-square' : 'h-32 sm:h-48 max-h-[240px]'}`}
                                  loading="lazy"
                                  decoding="async"
                                />
                                {isMultiPhoto && (
                                  <div className="absolute top-1 left-1 bg-background/80 text-xs px-1.5 py-0.5 rounded">
                                    {idx + 1}
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setPreviewImage(photoUrl);
                                  }}
                                  className="absolute top-2 right-2 p-1.5 bg-background/80 rounded-full hover:bg-background transition-colors shadow-sm"
                                >
                                  <Eye className="h-5 w-5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Upload buttons */}
                        {!isComplete && (
                          <div className={`grid gap-2 ${isMultiPhoto && photosNeeded > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            {Array.from({ length: isMultiPhoto ? photosNeeded : 1 }).map((_, idx) => {
                              return (
                                <div key={idx}>
                                  {isUploading && idx === 0 ? (
                                    <div className="flex items-center justify-center gap-2 min-h-[60px] rounded-lg border-2 border-dashed border-primary/40 bg-primary/5">
                                      <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                                      <span className="text-xs text-primary">Uploading…</span>
                                    </div>
                                  ) : (
                                    <PhotoPickerButton
                                      onFileSelected={(file) => handleImageUpload(item.id, file)}
                                      className="block w-full"
                                      disabled={isUploading}
                                    >
                                      <div className="flex items-center justify-center min-h-[60px] cursor-pointer">
                                        <Camera className="h-8 w-8 text-muted-foreground" />
                                      </div>
                                    </PhotoPickerButton>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                          </>
                        )}


                      </div>
                    );
                  })()}
                  {(item.item_type === 'confirmation' || item.item_type === 'CHECKMARK' || item.item_type === 'CHECKBOX') && (
                    <div 
                      className="flex items-center justify-center min-h-[72px] cursor-pointer group"
                      onClick={() => handleResponseChange(item.id, !responses[item.id])}
                    >
                      <div className={cn(
                        "flex items-center gap-3 px-6 py-3 rounded-xl transition-all duration-200",
                        responses[item.id] 
                          ? "bg-primary/10 text-primary" 
                          : "bg-muted/50 text-muted-foreground hover:bg-muted group-active:scale-95"
                      )}>
                        <div className={cn(
                          "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 shrink-0",
                          responses[item.id] 
                            ? "border-primary bg-primary" 
                            : "border-muted-foreground/40"
                        )}>
                          {responses[item.id] && <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />}
                        </div>
                        <span className="text-sm font-medium">
                          {responses[item.id] ? 'Completed' : 'Tap to Complete'}
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
                  </>
                )}
              </Card>
              </div>
            </div>
          );
            });
          })()}

          {showNotes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Additional Notes</CardTitle>
                <CardDescription className="text-xs">Add any additional comments</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Textarea 
                  value={notes} 
                  onChange={e => handleNotesChange(e.target.value)} 
                  placeholder="Enter any additional notes" 
                  rows={3} 
                  className="text-sm" 
                />
              </CardContent>
            </Card>
          )}

          {!showNotes && (
            <div className="flex justify-center pt-2">
              <Button type="button" onClick={() => setShowNotes(true)} variant="outline">
                Add Notes
              </Button>
            </div>
          )}
        </div>

        <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
          <DialogContent className="max-w-2xl">
            <img src={previewImage || ''} alt="Photo preview" className="w-full max-h-[70vh] object-contain rounded" />
          </DialogContent>
        </Dialog>

        {/* Undo Confirmation Dialog */}
        <AlertDialog open={!!undoConfirmItemId} onOpenChange={(open) => !open && setUndoConfirmItemId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Undo checklist item?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the completion for this item. The person who completed it and the response will be deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => undoConfirmItemId && handleUndoCompletion(undoConfirmItemId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Undo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>;
}