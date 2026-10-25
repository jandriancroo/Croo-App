import { placeSectionHeaders } from '@/lib/checklistSectionGroups';
import { referencePhotoFields, getPrimaryReferencePhoto } from '@/lib/checklistReferencePhotos';
import { canUndoChecklistItem } from '@/lib/checklistUndo';
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
import { CheckCircle2, Eye, Lock, ThumbsUp, ThumbsDown, Camera, Check, Pencil, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { formatTime12Hour } from '@/lib/utils';
import { compressImage, uploadWithRetry } from '@/utils/imageCompression';
import { setChecklistLock } from '@/utils/deferrableReload';
import { checklistDraftKeys, saveChecklistDraftValue, clearChecklistDraftValue, loadChecklistDraft, pruneOldChecklistDrafts } from '@/utils/checklistDraft';
import { useUserShiftContext } from '@/hooks/useUserShiftContext';
import { useScheduleStations } from '@/hooks/useLocationStations';
import { sharedCopyWindow } from '@/lib/checklistSharedCopy';
import { checklistScorePeriodKind } from '@/lib/taskHistory/schedule';
import { useLocationPeople } from '@/components/tasks/TaskAssigneePicker';
import { ROLE_DISPLAY_NAMES, type AppRole } from '@/hooks/useUserRole';
import { PrepListComplete } from '@/components/checklists/PrepListComplete';
import { PhotoPickerButton } from '@/components/PhotoPickerButton';
import { serverDebugLog } from '@/utils/serverDebugLog';
import { ChecklistQuestionText } from '@/components/tasks/ChecklistQuestionText';
import { ManagerApprovalItem } from '@/components/tasks/ManagerApprovalItem';
import { ChecklistLinkDialog } from '@/components/tasks/ChecklistLinkDialog';
import { parseLinkRefs, type ChecklistLinkRef } from '@/lib/checklistLinks';
import { InlineVideoPlayer } from '@/components/ui/inline-video-player';
import { ChecklistRunView, type RunCtx, type RunSection } from '@/components/checklists/run/ChecklistRunView';

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
  station_id?: string | null;
  assigned_role?: string | null;
  assigned_user_id?: string | null;
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
const shortName = (full?: string | null) => {
  const parts = (full || '').trim().split(/\s+/);
  return parts[0] ? `${parts[0]}${parts[1] ? ` ${parts[1][0]}.` : ''}` : 'Unknown';
};

interface ResponseWithCompleter {
  responseId: string;
  value: any;
  isImage: boolean;
  extractedTemperature?: number | null;
  temperatureValid?: boolean | null;
  temperatureUnconfirmed?: boolean;
  /** Short name of whoever last typed over the reading ("Maya R."). */
  tempEditedBy?: string | null;
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
  // Training assignments scope a checklist to a single trainee (own submission + responses)
  const assignmentId = searchParams.get('assignment');
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
  const [previewImage, setPreviewImage] = useState<{ urls: string[]; index: number } | null>(null);
  const previewTouchX = useRef<number | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [manualTempOpen, setManualTempOpen] = useState<Record<string, boolean>>({});
  const [manualTempValue, setManualTempValue] = useState<Record<string, string>>({});
  const [uploadingItems, setUploadingItems] = useState<Record<string, boolean>>({});
  const notesTimeoutRef = useRef<NodeJS.Timeout>();
  const {
    user
  } = useAuth();
  const { role, isAdmin, isManager, isShiftManager } = useUserRole();
  const { currentLocation } = useLocation();

  // Checklist reload guard: app updates wait until she leaves this page.
  useEffect(() => {
    setChecklistLock(true);
    pruneOldChecklistDrafts();
    return () => setChecklistLock(false);
  }, []);

  const draftLocalDate = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(viewDate.getDate()).padStart(2, '0')}`;
  const draftKeys = useMemo(
    () => checklistDraftKeys({ userId: user?.id, submissionId, checklistId: id, assignmentId, localDate: draftLocalDate }),
    [user?.id, submissionId, id, assignmentId, draftLocalDate],
  );
  const draftKeysRef = useRef<string[]>(draftKeys);
  draftKeysRef.current = draftKeys;
  const { timezone: locationTimezone } = useLocationTimezone();
  const { position: userPosition, station: userStation, role: userRole } = useUserShiftContext(user?.id, currentLocation?.id);
  const { stations: locationStations, enabled: stationMode } = useScheduleStations(currentLocation?.id);
  const { data: locationPeople = [] } = useLocationPeople(currentLocation?.id);
  // What the person can match on: position (Position mode) or station (Station mode), role, themselves.
  const myGroupMatch = stationMode ? userStation : userPosition;
  // No position/station from a shift = no switch, everyone sees everything (as before).
  const hasMatchSource = !!myGroupMatch;
  const isTaggedItem = (it: ChecklistItem) => !!(it.position || it.station_id || it.assigned_role || it.assigned_user_id);
  const itemMatchesMe = (it: ChecklistItem) =>
    !isTaggedItem(it) ||
    (!stationMode && !!it.position && it.position === userPosition) ||
    (stationMode && !!it.station_id && it.station_id === userStation) ||
    (!!it.assigned_role && it.assigned_role === userRole) ||
    (!!it.assigned_user_id && it.assigned_user_id === user?.id);
  /** Header group for an item: tier 0 position/station, 1 role, 2 person, 3 General (last). */
  const itemGroup = (it: ChecklistItem): { key: string; tier: number; label: string; color?: string } => {
    if (it.assigned_user_id) {
      const name = locationPeople.find((p) => p.id === it.assigned_user_id)?.name ?? 'Team member';
      return { key: `user:${it.assigned_user_id}`, tier: 2, label: name };
    }
    if (it.assigned_role) return { key: `role:${it.assigned_role}`, tier: 1, label: ROLE_DISPLAY_NAMES[it.assigned_role as AppRole] ?? it.assigned_role };
    if (stationMode && it.station_id) {
      const st = locationStations.find((x) => x.id === it.station_id);
      if (st) return { key: `station:${st.id}`, tier: 0, label: st.name, color: st.color };
    }
    if (!stationMode && it.position) return { key: `pos:${it.position}`, tier: 0, label: formatPositionLabel(it.position) };
    if (it.position) return { key: `pos:${it.position}`, tier: 0, label: it.position };
    return { key: 'general', tier: 3, label: 'General' };
  };
  const [positionStartTimes, setPositionStartTimes] = useState<Record<string, string>>({});
  const [undoConfirmItemId, setUndoConfirmItemId] = useState<string | null>(null);
  // Tapped deep-link chip — opens over the checklist so the user never loses their place
  const [activeLink, setActiveLink] = useState<ChecklistLinkRef | null>(null);
  
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
      return localStorage.getItem(hideCompletedKey) !== 'false';
    }
    return true;
  });

  // Toggle hide completed and persist to localStorage
  const toggleHideCompleted = () => {
    const newValue = !hideCompleted;
    setHideCompleted(newValue);
    if (newValue) {
      localStorage.removeItem(hideCompletedKey);
    } else {
      localStorage.setItem(hideCompletedKey, 'false');
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
  
  // Permission check: the person who checked it, or Shift Manager in Training and above
  const canUndoItem = (itemId: string) =>
    canUndoChecklistItem(role, user?.id, responsesWithCompleters[itemId]?.completedBy?.userId);
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
    const answerableItems = items.filter(item => item.item_type !== 'section_header' && item.item_type !== 'manager_approval');
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
    
    console.log('Submission effect triggered:', { id, userId: user?.id, locationId, checklistLocationId: checklist?.location_id, submissionId, frequency: checklist?.frequency });
    if (!id || !user?.id || !locationId || submissionId || !checklist) return;
    
    const createDraftSubmission = async () => {
      try {
        // For monthly checklists, use start of month; for daily/weekly use start of day
        let periodStart: Date;
        let periodEnd: Date;
        
        // Lists scored over a whole week / month / quarter share one copy for
        // that period (same rule the Dash and scores use); others: one per day.
        const viewDateStr = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(viewDate.getDate()).padStart(2, '0')}`;
        const copyWin = sharedCopyWindow(checklist as any, viewDateStr);
        const [sy, sm, sd] = copyWin.start.split('-').map(Number);
        const [ey, em, ed] = copyWin.end.split('-').map(Number);
        periodStart = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
        periodEnd = new Date(ey, em - 1, ed, 23, 59, 59, 999);

        console.log('Querying for existing submission:', { 
          checklistId: id, 
          locationId,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          periodKind: checklistScorePeriodKind(checklist as any)
        });

        // Check if there's already ANY submission for this period (shared by all users)
        // Get the submission with responses, or the most recent one if there are duplicates from race conditions
        let submissionQuery = supabase
          .from('checklist_submissions')
          .select(`
            id,
            checklist_responses(count)
          `)
          .eq('checklist_id', id)
          .eq('location_id', locationId);

        // Training assignments get their own submission per trainee; standard
        // checklists share one submission per period (assignment_id IS NULL).
        submissionQuery = assignmentId
          ? submissionQuery.eq('assignment_id', assignmentId)
          : submissionQuery.is('assignment_id', null);

        const {
          data: submissions,
          error: submissionsError,
        } = await submissionQuery
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
            assignment_id: assignmentId,
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
  }, [id, user, submissionId, viewDate, currentLocation?.id, checklist, assignmentId]);

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
            temperature_valid,
            temperature_unconfirmed,
            temperature_edited_by
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
            temperatureUnconfirmed: !!resp.temperature_unconfirmed,
            completedBy: undefined,
          } as any;

          if (resp.completed_by) {
            completerIds.add(resp.completed_by);
          }
          if (resp.temperature_edited_by) completerIds.add(resp.temperature_edited_by);
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
            tempEditedBy: response.temperature_edited_by ? shortName(profilesMap[response.temperature_edited_by]?.full_name) : null,
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

        // Restore any local draft answers for items the server doesn't have yet.
        const draftValues = loadChecklistDraft(draftKeysRef.current, loadedResponses);
        if (Object.keys(draftValues).length > 0) {
          console.log('[checklist-draft] restored', Object.keys(draftValues).length, 'item(s)');
        }
        setResponses({ ...loadedResponses, ...draftValues });
        setResponsesWithCompleters(loadedWithCompleters);
      } catch (error) {
        console.error('Error loading existing responses:', error);
      }
    };

    loadResponses();
  }, [submissionId]);

  // Keep a local draft of answers the server hasn't confirmed yet, so a
  // reload mid-checklist doesn't lose them. Server-confirmed items are cleared.
  useEffect(() => {
    if (loading || !submissionId) return;
    const keys = draftKeysRef.current;
    if (keys.length === 0) return;
    for (const [itemId, value] of Object.entries(responses)) {
      let confirmed = false;
      try {
        const saved = responsesWithCompleters[itemId];
        confirmed = !!saved?.responseId && JSON.stringify(saved.value) === JSON.stringify(value);
      } catch {
        confirmed = false;
      }
      if (confirmed) clearChecklistDraftValue(keys, itemId);
      else saveChecklistDraftValue(keys, itemId, value);
    }
  }, [responses, responsesWithCompleters, loading, submissionId]);

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
      } = await supabase.from('checklist_items').select('*').eq('checklist_id', id).is('deleted_at', null).order('order_index');
      if (itemsError) throw itemsError;
      // Reference photo comes from the shared helper (list first, old column fallback).
      for (const it of (itemsData || []) as any[]) it.reference_image_url = getPrimaryReferencePhoto(it) ?? undefined;

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
            assignment_id: assignmentId,
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
  }, [submissionId, user, assignmentId]);
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
        data: deleted,
        error
      } = await supabase.from('checklist_responses').delete().eq('id', responseData.responseId).select('id');
      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        toast.error('Only the person who checked this or a shift manager can uncheck it.');
        setUndoConfirmItemId(null);
        return;
      }

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

  // Same manager alert for scans and hand-typed readings.
  const alertUnsafeTemperature = async (item: ChecklistItem, extractedTemp: number, tempUnconfirmed: boolean) => {
    const taskLocationId = currentLocation?.id || checklist?.location_id;
    if (!taskLocationId || !user?.id) return;
    const unconfirmedLabel = tempUnconfirmed ? ' (unconfirmed reading)' : '';
    const alertTitle = `🌡️ Unsafe Temp${tempUnconfirmed ? ' (unconfirmed)' : ''}: ${item.question}`;
    const alertBody = `${extractedTemp}°F${unconfirmedLabel} is out of safe zone. Verify and take corrective action.`;
    const dedupKey = `temp_alert_${taskLocationId}_${item.id}_${new Date().toISOString().split('T')[0]}_${Date.now()}`;
    const { data: managerUsers } = await supabase
      .from('user_locations')
      .select('user_id, user_roles!inner(role)')
      .eq('location_id', taskLocationId)
      .in('user_roles.role', ['super_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager', 'shift_manager_in_training']);
    const managerIds = managerUsers?.map((u: any) => u.user_id) || [];
    if (managerIds.length === 0) return;
    const { error: alertError } = await supabase.from('alert_queue').insert({
      alert_type: 'unsafe_temperature',
      dedup_key: dedupKey,
      location_id: taskLocationId,
      payload: {
        user_ids: managerIds,
        title: alertTitle,
        body: alertBody,
        notification_type: 'unsafe_temperature',
        data: { type: 'unsafe_temperature', location_id: taskLocationId, checklist_item: item.question, temperature: extractedTemp, unconfirmed: tempUnconfirmed },
      },
    });
    if (!alertError) {
      toast.warning('Temperature out of range — managers notified', { description: `${extractedTemp}°F${unconfirmedLabel} on ${item.question}` });
    }
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
    // Photo tasks keep their photo; typing only sets the reading (no completion change).
    const manualItem = items.find(i => i.id === itemId);
    const isPhotoTask = manualItem?.item_type !== 'temperature';

    try {
      const { data: existing, error: existingError } = await supabase
        .from('checklist_responses')
        .select('id')
        .eq('submission_id', submissionId)
        .eq('item_id', itemId)
        .maybeSingle();

      if (existingError) throw existingError;

      const tempFields = {
        extracted_temperature: tempF,
        temperature_valid: tempValid,
        temperature_unconfirmed: false,
        temperature_validated_at: new Date().toISOString(),
        temperature_edited_at: new Date().toISOString(), // server stamps who/when/replaced value
      };
      const responseData = isPhotoTask
        ? tempFields
        : { response_image_url: null, response_text: String(tempF), completed_by: user.id, ...tempFields };

      if (isPhotoTask && !existing?.id) {
        toast.error('Take the photo first, then type the temperature');
        return;
      }

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
          .insert({ submission_id: submissionId, assignment_id: assignmentId, item_id: itemId, ...responseData })
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

      if (isPhotoTask) {
        setResponsesWithCompleters(prev => ({
          ...prev,
          [itemId]: { ...prev[itemId], extractedTemperature: tempF, temperatureValid: tempValid, temperatureUnconfirmed: false, tempEditedBy: shortName(profile?.full_name) },
        }));
        setManualTempOpen(prev => ({ ...prev, [itemId]: false }));
        toast.success(`Saved ${tempF}°F`);
        if (!tempValid && manualItem) await alertUnsafeTemperature(manualItem, tempF, false);
        return;
      }

      setResponses(prev => ({ ...prev, [itemId]: String(tempF) }));
      setResponsesWithCompleters(prev => ({
        ...prev,
        [itemId]: {
          responseId: responseId || '',
          value: String(tempF),
          isImage: false,
          extractedTemperature: tempF,
          temperatureValid: tempValid,
          temperatureUnconfirmed: false,
          tempEditedBy: shortName(profile?.full_name),
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
      if (!tempValid && manualItem) await alertUnsafeTemperature(manualItem, tempF, false);
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
    // Compress first so we never load the full-size original into memory
    // (older iPhones run out of memory and reload the app).
    let precompressed: Awaited<ReturnType<typeof compressImage>> | null = null;
    try {
      precompressed = await compressImage(file, 1200, 1200, 0.8);
    } catch (e) {
      console.warn('[photo] early compression failed, will retry during upload', e);
    }
    // Block exact repeat photos: same photo used at this store in the last
    // 7 days on a different checklist submission. Fingerprint the COMPRESSED
    // file. If compression, hashing or the check fails, allow it.
    const repeatLocationId = currentLocation?.id || checklist?.location_id;
    if (precompressed && repeatLocationId && typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const digest = await crypto.subtle.digest('SHA-256', await precompressed.arrayBuffer());
        const photoHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        const { data: isNew, error: claimErr } = await supabase.rpc('claim_checklist_photo' as any, {
          _location_id: repeatLocationId,
          _photo_hash: photoHash,
          _submission_id: submissionId || null,
          _item_id: itemId,
        } as any);
        if (!claimErr && isNew === false) {
          toast.error('This photo was already used', {
            description: 'Please take a new photo for today.',
          });
          return;
        }
      } catch (e) {
        console.warn('[photo-repeat-check] skipped', e);
      }
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
    let blobRevoked = false;
    const revokeBlob = () => {
      if (blobRevoked) return;
      blobRevoked = true;
      try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ }
    };
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
      const compressedFile = precompressed ?? await compressImage(file, 1200, 1200, 0.8);
      
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
        ((item?.item_type === 'image' || item?.item_type === 'PHOTO') && item?.requires_temperature_validation === true);

      let tempUnconfirmed = false;
      let hasNewReading = false;
      if (shouldValidateTemp) {
        const { data: tempData, error: tempError } = await supabase.functions.invoke(
          'ai-extraction-service?action=extract-temperature',
          { body: { imageUrl: data.publicUrl } }
        );
        const taskLocationId = currentLocation?.id || checklist?.location_id;
        const reason: string | null = tempError || !tempData ? 'function_error' : (tempData.reason ?? null);
        if (!tempError && tempData && tempData.temperature != null) {
          extractedTemp = tempData.temperature;
          tempValid = tempData.isValid;
          tempUnconfirmed = !!tempData.unconfirmed;
          hasNewReading = true;
        }
        // Evidence for every photo that didn't get a clean reading.
        if (reason) {
          void supabase.from('temperature_read_issues').insert({
            reason,
            reads: tempData?.reads ?? null,
            saved_temperature: hasNewReading ? extractedTemp : null,
            image_url: data.publicUrl,
            item_id: itemId,
            submission_id: submissionId || null,
            location_id: taskLocationId || null,
            user_id: user?.id,
          } as any).then(({ error }) => { if (error) console.warn('[temp-read-issue] log failed', error.message); });
        }
        if (!hasNewReading) {
          toast.warning("Couldn't read the temperature", { description: 'Please type the temperature you see on the thermometer.' });
          setManualTempOpen(prev => ({ ...prev, [itemId]: true }));
        }

        // Alert managers if temperature is out of safe zone (unconfirmed still alerts).
        if (hasNewReading && tempValid === false && extractedTemp !== null && item) {
          await alertUnsafeTemperature(item, extractedTemp, tempUnconfirmed);
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

      // Keep the uploaded photo link in the local draft until the server has it.
      saveChecklistDraftValue(draftKeysRef.current, itemId, newValue);

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
          // A retake never erases a saved reading unless it produced a new one.
          ...(hasNewReading
            ? {
                extracted_temperature: extractedTemp,
                temperature_valid: tempValid,
                temperature_unconfirmed: tempUnconfirmed,
                temperature_validated_at: new Date().toISOString(),
              }
            : {}),
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
              assignment_id: assignmentId,
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
              extractedTemperature: hasNewReading ? extractedTemp : (prev[itemId]?.extractedTemperature ?? null),
              temperatureValid: hasNewReading ? tempValid : (prev[itemId]?.temperatureValid ?? null),
              temperatureUnconfirmed: hasNewReading ? tempUnconfirmed : !!prev[itemId]?.temperatureUnconfirmed,
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
      revokeBlob();
    } catch (error: any) {
      // Revert the optimistic update so the user knows to retry.
      setResponses(previousResponses);
      setResponsesWithCompleters(previousResponsesWithCompleters);
      revokeBlob();

      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('memory') || msg.includes('out of memory') || msg.includes('low memory')) {
        toast.error('Low memory: try choosing an existing photo instead');
      } else {
        toast.error('Photo upload failed — please retry');
      }
    } finally {
      // Release the blob URL after a beat so the <img> has time to swap sources.
      setTimeout(revokeBlob, 5000);
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

  // ---------- Phase E: list first, guided on tap ----------
  const isTempItem = (it: ChecklistItem) => it.item_type === 'temperature' || ((it.item_type === 'image' || it.item_type === 'PHOTO') && it.requires_temperature_validation === true);
  const isItemDone = (item: ChecklistItem): boolean => {
    if (item.item_type === 'section_header' || item.item_type === 'manager_approval') return false;
    const isImg = item.item_type === 'image' || item.item_type === 'PHOTO' || item.item_type === 'temperature';
    if (isImg) return isMultiPhotoComplete(item, responses[item.id]);
    if (item.item_type === 'text' || item.item_type === 'number') {
      const v = responsesWithCompleters[item.id]?.value;
      return v !== undefined && v !== '' && v !== null;
    }
    if (item.item_type === 'confirmation' || item.item_type === 'CHECKMARK' || item.item_type === 'CHECKBOX') return responses[item.id] === true;
    return responses[item.id] !== undefined && responses[item.id] !== '' && responses[item.id] !== null;
  };
  const photosFor = (it: ChecklistItem) => getPhotosForItem(it.id).filter((p) => typeof p === 'string' && (p.startsWith('http') || p.startsWith('blob:')));
  const answerable = items.filter((it) => it.item_type !== 'section_header' && it.item_type !== 'manager_approval');
  const doneCount = answerable.filter(isItemDone).length;

  const runSections: RunSection[] = (() => {
    let list = items;
    const hasPositionFiltering = !!checklist?.position_filtering_enabled;
    if (hasPositionFiltering && hasMatchSource && showOnlyMyPosition) list = list.filter(itemMatchesMe);
    // Groups on: a section header joins the group of the task below it and shows only if one of its tasks shows.
    const headerPlacement = hasPositionFiltering ? placeSectionHeaders(items) : null;
    const itemById = new Map(items.map((it) => [it.id, it]));
    const effGroup = (it: ChecklistItem) => {
      const anchorId = it.item_type === 'section_header' ? headerPlacement?.get(it.id)?.anchorId : null;
      const anchor = anchorId ? itemById.get(anchorId) : undefined;
      return itemGroup(anchor ?? it);
    };
    if (headerPlacement) {
      const shownIds = new Set(list.map((it) => it.id));
      list = list.filter((it) => {
        if (it.item_type !== 'section_header') return true;
        const pl = headerPlacement.get(it.id);
        if (!pl || !pl.anchorId) return false;
        return pl.taskIds.length === 0 ? shownIds.has(pl.anchorId) : pl.taskIds.some((tid) => shownIds.has(tid));
      });
    }
    const stationOrder = new Map(locationStations.map((station, index) => [`station:${station.id}`, index]));
    if (hasPositionFiltering) {
      list = [...list].sort((a, b) => {
        const ga = effGroup(a), gb = effGroup(b);
        if (ga.tier !== gb.tier) return ga.tier - gb.tier;
        if (ga.key !== gb.key) {
          const aStation = stationOrder.get(ga.key), bStation = stationOrder.get(gb.key);
          if (aStation !== undefined && bStation !== undefined && aStation !== bStation) return aStation - bStation;
          return ga.label.localeCompare(gb.label);
        }
        return (a.order_index || 0) - (b.order_index || 0);
      });
    }
    const hasAmPm = !!checklist?.enable_am_pm_division;
    const hasHeaders = list.some((i) => i.item_type === 'section_header');
    if (hasAmPm && !hasHeaders) {
      const order: Record<string, number> = { am: 0, pm: 1 };
      list = [...list].sort((a, b) => {
        const ao = order[a.manager_shift ?? ''] ?? 2, bo = order[b.manager_shift ?? ''] ?? 2;
        return ao !== bo ? ao - bo : (a.order_index || 0) - (b.order_index || 0);
      });
    }
    const out: RunSection[] = [];
    let cur: RunSection | null = null;
    let posKey: string | undefined;
    let shiftKey: string | undefined;
    let n = 0;
    const startNew = (label: string) => { cur = { key: `s${n++}`, label, items: [] }; out.push(cur); };
    for (const it of list) {
      let posLabel: string | null = null;
      if (hasPositionFiltering) {
        const g = effGroup(it);
        if (g.key !== posKey) { posKey = g.key; posLabel = g.label; }
      }
      if (it.item_type === 'section_header') {
        startNew(it.question || 'Section');
        continue;
      }
      if (hasAmPm && !hasHeaders) {
        const sk = it.manager_shift === 'am' ? 'AM tasks' : it.manager_shift === 'pm' ? 'PM tasks' : 'Any shift';
        if (sk !== shiftKey) { shiftKey = sk; startNew(posLabel ? `${posLabel} · ${sk}` : sk); posLabel = null; }
      }
      if (posLabel) startNew(posLabel);
      if (!cur) startNew('');
      cur!.items.push(it);
    }
    return out.filter((s) => s.items.length > 0);
  })();

  const businessDateStr = dateParam || `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(viewDate.getDate()).padStart(2, '0')}`;
  const prepEl = (item: ChecklistItem) => (
    <PrepListComplete
      itemId={item.id}
      submissionId={submissionId}
      locationId={currentLocation?.id || checklist?.location_id || null}
      businessDate={businessDateStr}
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
  );

  const runCtx: RunCtx = {
    title: checklist.title,
    description: checklist.description,
    doneCount,
    totalCount: answerable.length,
    hideDone: hideCompleted,
    setHideDone: (v) => { if (v !== hideCompleted) toggleHideCompleted(); },
    myTasks: checklist?.position_filtering_enabled && hasMatchSource ? {
      label: stationMode ? (locationStations.find((x) => x.id === myGroupMatch)?.name ?? 'my station') : formatPositionLabel(myGroupMatch),
      on: showOnlyMyPosition,
      set: (v) => { setShowOnlyMyPosition(v); localStorage.setItem(posFilterKey, v ? 'true' : 'false'); },
    } : null,
    sections: runSections,
    isDone: (it) => isItemDone(it as ChecklistItem),
    needsTemp: (it) => isTempItem(it as ChecklistItem) && photosFor(it as ChecklistItem).length > 0 && !uploadingItems[it.id] && responsesWithCompleters[it.id]?.extractedTemperature == null,
    photos: (it) => photosFor(it as ChecklistItem),
    minPhotos: (it) => getMinPhotos(it as ChecklistItem),
    uploading: (id) => !!uploadingItems[id],
    value: (id) => responses[id],
    savedValue: (id) => responsesWithCompleters[id]?.value,
    setValue: (id, v) => setResponses(prev => ({ ...prev, [id]: v })),
    check: (id) => { if (responses[id] !== true) handleResponseChange(id, true); },
    choose: (id, v) => { setResponses(prev => ({ ...prev, [id]: v })); autoSaveResponse(id, v, false); },
    submit: (id, v) => autoSaveResponse(id, v, false),
    upload: (id, file, index) => handleImageUpload(id, file, index),
    reading: (id) => ({ temp: responsesWithCompleters[id]?.extractedTemperature, valid: responsesWithCompleters[id]?.temperatureValid, editedBy: responsesWithCompleters[id]?.tempEditedBy, unconfirmed: !!(responsesWithCompleters[id] as any)?.temperatureUnconfirmed }),
    tempOpen: (id) => !!manualTempOpen[id],
    setTempOpen: (id, open) => setManualTempOpen(prev => ({ ...prev, [id]: open })),
    tempValue: (id) => manualTempValue[id] ?? '',
    setTempValue: (id, v) => setManualTempValue(prev => ({ ...prev, [id]: v })),
    saveTemp: (id) => saveManualTemperature(id, manualTempValue[id] ?? ''),
    completer: (id) => responsesWithCompleters[id]?.completedBy,
    canUndo: (id) => !!responsesWithCompleters[id]?.responseId && canUndoItem(id),
    undo: (id) => handleUndoClick(id),
    preview: (url) => setPreviewImage({ urls: [url], index: 0 }),
    previewMany: (urls, index) => setPreviewImage({ urls, index }),
    openLink: (ref) => setActiveLink(ref),
    renderPrep: (it) => prepEl(it as ChecklistItem),
    renderApproval: (it) => (
      <ManagerApprovalItem
        question={it.question}
        assignmentId={assignmentId}
        completionPercent={completionPercentage}
        currentUserId={user?.id}
        isApproverByRole={isAdmin || isManager || isShiftManager}
      />
    ),
    prepStatus: (it, skip) => (skip ? null : prepEl(it as ChecklistItem)),
    footer: (
      <div className="space-y-3 pt-2">
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
    ),
    onBack: () => navigate(-1),
  };

  return <Layout>
      <div className="-mx-1 md:-mx-3 lg:mx-auto max-w-[1200px]">
        <ChecklistRunView ctx={runCtx} />

        <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
          <DialogContent className="duo-popup max-w-2xl">
            <div
              className="relative"
              onTouchStart={(e) => { previewTouchX.current = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                if (previewTouchX.current == null || !previewImage || previewImage.urls.length < 2) return;
                const dx = e.changedTouches[0].clientX - previewTouchX.current;
                previewTouchX.current = null;
                if (Math.abs(dx) > 40) setPreviewImage((p) => p && { urls: p.urls, index: (p.index + (dx < 0 ? 1 : -1) + p.urls.length) % p.urls.length });
              }}
            >
              <img src={previewImage?.urls[previewImage.index] || ''} alt="Photo preview" className="w-full max-h-[70vh] object-contain rounded" />
              {previewImage && previewImage.urls.length > 1 && (
                <>
                  <button type="button" aria-label="Previous photo" className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 shadow"
                    onClick={() => setPreviewImage((p) => p && { urls: p.urls, index: (p.index - 1 + p.urls.length) % p.urls.length })}><ChevronLeft className="h-5 w-5" /></button>
                  <button type="button" aria-label="Next photo" className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 shadow"
                    onClick={() => setPreviewImage((p) => p && { urls: p.urls, index: (p.index + 1) % p.urls.length })}><ChevronRight className="h-5 w-5" /></button>
                  <span className="absolute bottom-2 right-2 rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium">{previewImage.index + 1} of {previewImage.urls.length}</span>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Undo Confirmation Dialog */}
        <AlertDialog open={!!undoConfirmItemId} onOpenChange={(open) => !open && setUndoConfirmItemId(null)}>
          <AlertDialogContent className="duo-popup">
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

        {/* Deep-linked recipe / log / person opened from a checklist chip */}
        <ChecklistLinkDialog
          linkRef={activeLink}
          onClose={() => setActiveLink(null)}
          locationId={currentLocation?.id || checklist?.location_id || null}
          timezone={locationTimezone}
        />
      </div>
    </Layout>;
}