import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { ConflictWarningDialog } from "./ConflictWarningDialog";
import { ArrowUp, Trash2, AlertTriangle } from "lucide-react";
import { ShiftOfferDialog } from "./ShiftOfferDialog";
import { parseDateStringInTimezone } from "@/utils/timezoneUtils";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface EditShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: any;
  profiles: any[];
  templates: any[];
  onUpdate: () => void;
  scheduleId: string;
  currentWeekStart: Date;
  currentUserId?: string;
  availabilityRequests?: any[];
  isAdmin?: boolean;
  isShiftPublished?: boolean;
}

export function EditShiftDialog({ 
  open, 
  onOpenChange, 
  shift, 
  profiles, 
  templates,
  onUpdate,
  scheduleId,
  currentWeekStart,
  currentUserId,
  availabilityRequests = [],
  isAdmin = false,
  isShiftPublished = true
}: EditShiftDialogProps) {
  const [startTime, setStartTime] = useState(shift.start_time);
  const [endTime, setEndTime] = useState(shift.end_time);
  const [selectedUserId, setSelectedUserId] = useState(shift.user_id || "unassigned");
  const [position, setPosition] = useState(shift.template_id || "");
  const [selectedDays, setSelectedDays] = useState<number[]>([shift.day_of_week]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showConflictWarning, setShowConflictWarning] = useState(false);
  const [conflictDetails, setConflictDetails] = useState<any[]>([]);
  const [offeredShifts, setOfferedShifts] = useState<any[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [showOfferDialog, setShowOfferDialog] = useState(false);

  const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  useEffect(() => {
    if (open) {
      fetchOfferedShifts();
    }
  }, [open]);

  const fetchOfferedShifts = async () => {
    try {
      const { data, error } = await supabase
        .from('shift_offers')
        .select(`
          id,
          shift_id,
          offered_by_user_id,
          status,
          scheduled_shifts!inner (
            id,
            start_time,
            end_time,
            shift_date,
            day_of_week,
            user_id,
            template_id,
            shift_templates (
              template_name,
              position
            )
          ),
          profiles!shift_offers_offered_by_user_id_fkey (
            full_name
          )
        `)
        .eq('status', 'available')
        .eq('scheduled_shifts.schedule_id', scheduleId);

      if (error) throw error;
      setOfferedShifts(data || []);
    } catch (error) {
      console.error('Error fetching offered shifts:', error);
    }
  };

  const checkForConflicts = (userId: string, dayIndices: number[]) => {
    if (userId === "unassigned" || !availabilityRequests) return [];

    const employee = profiles.find((p) => p.id === userId);
    if (!employee) return [];

    const conflicts: any[] = [];

    dayIndices.forEach((dayIndex) => {
      const shiftDate = format(addDays(currentWeekStart, dayIndex), "yyyy-MM-dd");
      
      const conflictingRequests = availabilityRequests.filter((request) => {
        if (request.user_id !== userId) return false;

        const reqDate = parseDateStringInTimezone(request.start_date, 'America/Los_Angeles');
        const cellDate = parseDateStringInTimezone(shiftDate, 'America/Los_Angeles');

        if (request.time_scope === "multi_day" && request.end_date) {
          const endDate = parseDateStringInTimezone(request.end_date, 'America/Los_Angeles');
          return cellDate >= reqDate && cellDate <= endDate;
        }
        return reqDate.toDateString() === cellDate.toDateString();
      });

      conflictingRequests.forEach((req) => {
        conflicts.push({
          employeeName: employee.full_name,
          date: shiftDate,
          requestType: req.request_type,
          timeScope: req.time_scope,
          status: req.status,
          startTime: req.start_time,
          endTime: req.end_time,
        });
      });
    });

    return conflicts;
  };

  const handleDayToggle = (dayIndex: number) => {
    setSelectedDays(prev => 
      prev.includes(dayIndex) 
        ? prev.filter(d => d !== dayIndex)
        : [...prev, dayIndex]
    );
  };


  const handleSave = async (skipConflictCheck = false) => {
    // Check for conflicts if not already confirmed
    if (!skipConflictCheck) {
      const detectedConflicts = checkForConflicts(
        selectedUserId === "unassigned" ? "unassigned" : selectedUserId,
        selectedDays
      );

      if (detectedConflicts.length > 0) {
        setConflictDetails(detectedConflicts);
        setShowConflictWarning(true);
        return;
      }
    }

    setSaving(true);
    try {
      // If an offered shift was selected, approve it
      if (selectedOfferId) {
        const { error: offerError } = await supabase
          .from('shift_offers')
          .update({ status: 'approved' })
          .eq('id', selectedOfferId);

        if (offerError) throw offerError;
      }

      // Update the current shift
      const { error: updateError } = await supabase
        .from("scheduled_shifts")
        .update({
          start_time: startTime,
          end_time: endTime,
          user_id: selectedUserId === "unassigned" ? null : selectedUserId,
          template_id: position || null,
        })
        .eq("id", shift.id);

      if (updateError) throw updateError;

      // If multiple days selected, create/update shifts for other days
      for (const dayIndex of selectedDays) {
        if (dayIndex === shift.day_of_week) continue; // Skip current day

        const shiftDate = format(addDays(currentWeekStart, dayIndex), "yyyy-MM-dd");
        
        // Check if shift already exists for this user/day
        const { data: existing } = await supabase
          .from("scheduled_shifts")
          .select("id")
          .eq("schedule_id", scheduleId)
          .eq("day_of_week", dayIndex)
          .eq("user_id", selectedUserId === "unassigned" ? null : selectedUserId)
          .maybeSingle();

        if (existing) {
          // Update existing shift
          await supabase
            .from("scheduled_shifts")
            .update({
              start_time: startTime,
              end_time: endTime,
              template_id: position || null,
            })
            .eq("id", existing.id);
        } else {
          // Create new shift
          await supabase
            .from("scheduled_shifts")
            .insert({
              schedule_id: scheduleId,
              day_of_week: dayIndex,
              shift_date: shiftDate,
              start_time: startTime,
              end_time: endTime,
              user_id: selectedUserId === "unassigned" ? null : selectedUserId,
              template_id: position || null,
              is_time_off: false,
            });
        }
      }

      toast.success("Shift updated");
      onUpdate();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error updating shift:", error);
      toast.error("Failed to update shift");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!shift.id) return;
    
    if (!confirm("Delete this shift?")) return;
    
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("scheduled_shifts")
        .delete()
        .eq("id", shift.id);

      if (error) throw error;
      toast.success("Shift deleted");
      onUpdate();
      onOpenChange(false);
    } catch (error) {
      console.error("Error deleting shift:", error);
      toast.error("Failed to delete shift");
    } finally {
      setDeleting(false);
    }
  };

  // Find overlapping time-off requests for the current shift
  const overlappingTimeOffRequests = availabilityRequests.filter(request => {
    if (request.user_id !== shift.user_id) return false;
    
    const shiftDate = shift.shift_date;
    const reqDate = request.start_date;
    
    // Check date overlap
    if (request.time_scope === "multi_day" && request.end_date) {
      if (shiftDate < reqDate || shiftDate > request.end_date) return false;
    } else {
      if (shiftDate !== reqDate) return false;
    }
    
    // For partial day, check time overlap
    if (request.time_scope === "partial_day" && request.start_time && request.end_time) {
      const shiftStart = shift.start_time;
      const shiftEnd = shift.end_time;
      return shiftStart < request.end_time && shiftEnd > request.start_time;
    }
    
    return true; // Full day request on same date
  });

  // Check weekly availability conflict for the employee
  const employee = profiles.find(p => p.id === shift.user_id);
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
  const shiftDayOfWeek = shift.day_of_week;
  const dayName = dayNames[shiftDayOfWeek];
  const weeklyAvailability = employee?.weekly_availability?.[dayName];
  
  const hasAvailabilityConflict = weeklyAvailability && (
    weeklyAvailability.available === false ||
    (weeklyAvailability.start && startTime < weeklyAvailability.start) ||
    (weeklyAvailability.end && endTime > weeklyAvailability.end)
  );

  const formatTime12h = (time: string) => {
    const parts = time.split(":");
    const hour = parseInt(parts[0]);
    const minutes = parts[1];
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getAvailabilityDescription = () => {
    if (!weeklyAvailability) return "";
    if (weeklyAvailability.available === false) return "Unavailable this day";
    if (weeklyAvailability.start && weeklyAvailability.end) {
      return `Available ${formatTime12h(weeklyAvailability.start)} - ${formatTime12h(weeklyAvailability.end)}`;
    }
    if (weeklyAvailability.start) {
      return `Available after ${formatTime12h(weeklyAvailability.start)}`;
    }
    if (weeklyAvailability.end) {
      return `Available until ${formatTime12h(weeklyAvailability.end)}`;
    }
    return "Limited availability";
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Shift</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-y-auto flex-1">
          {/* Time-off conflict alert */}
          {overlappingTimeOffRequests.length > 0 && (
            <Alert variant="destructive" className="bg-amber-500/10 border-amber-500/50 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium">Time-Off Request Conflict</div>
                {overlappingTimeOffRequests.map(req => (
                  <div key={req.id} className="text-sm mt-1">
                    {req.time_scope === "partial_day" && req.start_time && req.end_time
                      ? `${formatTime12h(req.start_time)} - ${formatTime12h(req.end_time)}`
                      : "Full Day"
                    }
                    {" "}• {req.status === "pending" ? "Pending" : "Approved"}
                    {req.notes && <span className="opacity-75"> — {req.notes}</span>}
                  </div>
                ))}
              </AlertDescription>
            </Alert>
          )}
          
          {/* Weekly availability conflict alert */}
          {hasAvailabilityConflict && (
            <Alert variant="destructive" className="bg-amber-500/10 border-amber-500/50 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium">Availability Conflict</div>
                <div className="text-sm mt-1">{getAvailabilityDescription()}</div>
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-time">Start Time</Label>
              <Input
                id="start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-time">End Time</Label>
              <Input
                id="end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="employee">Employee</Label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger id="employee">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="position">Quick Fill</Label>
            <Select 
              value={position || "none"} 
              onValueChange={(val) => {
                if (val.startsWith('offer-')) {
                  // Handle offered shift selection
                  const offerId = val.replace('offer-', '');
                  const offer = offeredShifts.find(o => o.id === offerId);
                  if (offer && offer.scheduled_shifts) {
                    setSelectedOfferId(offerId);
                    setStartTime(offer.scheduled_shifts.start_time);
                    setEndTime(offer.scheduled_shifts.end_time);
                    if (offer.scheduled_shifts.template_id) {
                      setPosition(offer.scheduled_shifts.template_id);
                    } else {
                      setPosition(`offer-${offerId}`);
                    }
                  }
                } else if (val !== "none") {
                  setSelectedOfferId(null);
                  setPosition(val);
                  const template = templates.find(t => t.id === val);
                  if (template) {
                    setStartTime(template.start_time);
                    setEndTime(template.end_time);
                  }
                } else {
                  setSelectedOfferId(null);
                  setPosition("");
                }
              }}
            >
            <SelectTrigger id="position">
              <SelectValue placeholder="Select quick fill option" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="none">None</SelectItem>
                
                {/* Offered Shifts Section */}
                {offeredShifts.length > 0 && offeredShifts.map((offer) => {
                  const shiftData = offer.scheduled_shifts;
                  const offeredBy = offer.profiles?.full_name || 'Unknown';
                  const templateName = shiftData?.shift_templates?.template_name || shiftData?.shift_templates?.position || 'Shift';
                  const formatTime = (time: string) => {
                    const [hours, minutes] = time.split(':');
                    const hour = parseInt(hours);
                    const ampm = hour >= 12 ? 'PM' : 'AM';
                    const displayHour = hour % 12 || 12;
                    return `${displayHour}:${minutes} ${ampm}`;
                  };
                  
                  return (
                    <SelectItem 
                      key={offer.id} 
                      value={`offer-${offer.id}`}
                      className="font-semibold text-primary bg-primary/10 border-l-4 border-primary"
                    >
                      <div className="flex items-center gap-2">
                        <ArrowUp className="h-4 w-4 animate-pulse" />
                        <span className="italic">
                          {templateName} ({formatTime(shiftData.start_time)} - {formatTime(shiftData.end_time)}) - Offered by {offeredBy}
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
                
                {/* Regular Templates */}
                {templates.map((template) => {
                  const formatTime = (time: string) => {
                    const [hours, minutes] = time.split(':');
                    const hour = parseInt(hours);
                    const ampm = hour >= 12 ? 'PM' : 'AM';
                    const displayHour = hour % 12 || 12;
                    return `${displayHour}:${minutes} ${ampm}`;
                  };
                  
                  return (
                    <SelectItem key={template.id} value={template.id}>
                      {template.position || template.template_name} ({formatTime(template.start_time)} - {formatTime(template.end_time)})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Apply to Days</Label>
            <div className="space-y-2">
              {weekDays.map((day, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <Checkbox
                    id={`day-${index}`}
                    checked={selectedDays.includes(index)}
                    onCheckedChange={() => handleDayToggle(index)}
                  />
                  <label
                    htmlFor={`day-${index}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {day}
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <div className="flex justify-between w-full gap-2">
            <Button 
              variant="destructive" 
              onClick={handleDelete} 
              disabled={deleting || saving}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleting ? "Deleting..." : "Delete"}
            </Button>
            <div className="flex gap-2">
              {isShiftPublished && currentUserId && (isAdmin || shift.user_id === currentUserId) && (
                <Button variant="outline" onClick={() => setShowOfferDialog(true)}>
                  <ArrowUp className="h-4 w-4 mr-2" />
                  Offer Up
                </Button>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => handleSave()} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ConflictWarningDialog
      open={showConflictWarning}
      onOpenChange={setShowConflictWarning}
      onConfirm={() => {
        setShowConflictWarning(false);
        handleSave(true);
      }}
      conflicts={conflictDetails}
    />

    <ShiftOfferDialog
      open={showOfferDialog}
      onOpenChange={setShowOfferDialog}
      shift={shift}
      onOfferCreated={() => {
        onUpdate();
        onOpenChange(false);
      }}
    />
    </>
  );
}
