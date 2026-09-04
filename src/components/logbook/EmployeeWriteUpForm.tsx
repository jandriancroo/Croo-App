import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, Camera, Check, ChevronsUpDown, Loader2, Plus, Settings, User, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useAuth } from "@/lib/auth";
import { getDisplayName } from "@/utils/displayName";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { compressImage } from "@/utils/imageCompression";
import { useIsIOS } from "@/hooks/useIsIOS";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CorrectiveActionRecorder, type RecordingResult } from "@/components/logbook/CorrectiveActionRecorder";
import { CorrectiveActionTrails } from "@/components/logbook/CorrectiveActionTrails";

interface EmployeeWriteUpFormProps {
  onSave: (data: WriteUpData) => Promise<void>;
  isSaving: boolean;
}

export interface WriteUpData {
  employeeId: string;
  employeeName: string;
  reason: string;
  issueDescription: string;
  nextSteps: string;
  photoUrl?: string;
  isFinalWarning: boolean;
  familyId?: string | null;
  transcriptText?: string | null;
  notesBullets?: { speaker: string; text: string }[] | null;
  consentConfirmedAt?: string | null;
  recordingDurationSeconds?: number | null;
  sttModelUsed?: string | null;
}

const DEFAULT_REASONS = [
  "Customer Complaint",
  "Unprofessional Behavior",
  "Time & Attendance",
  "Food Theft",
  "Food Waste",
  "Health Violation",
  "Break Violation",
];

export function EmployeeWriteUpForm({ onSave, isSaving }: EmployeeWriteUpFormProps) {
  const { currentLocation } = useAppLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isIOS = useIsIOS();
  
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isFinalWarning, setIsFinalWarning] = useState(false);
  const [showReasonDialog, setShowReasonDialog] = useState(false);
  const [newReasonName, setNewReasonName] = useState("");
  const [addingReason, setAddingReason] = useState(false);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [recording, setRecording] = useState<RecordingResult | null>(null);
  const [autofilled, setAutofilled] = useState<{ reason: boolean; nextSteps: boolean }>({ reason: false, nextSteps: false });
  const autofillDoneRef = useRef<string | null>(null);

  interface EmployeeOption {
    id: string;
    full_name: string;
    profile_photo_url: string | null;
  }

  interface ReasonOption {
    id: string;
    reason: string;
  }

  // Fetch employees for the location via user_locations join
  const { data: employees = [] } = useQuery({
    queryKey: ['location-employees-writeup', currentLocation?.id],
    queryFn: async (): Promise<EmployeeOption[]> => {
      if (!currentLocation) return [];
      // Get all user IDs assigned to this location
      const { data: userLocations, error: ulError } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', currentLocation.id);
      
      if (ulError) throw ulError;
      if (!userLocations || userLocations.length === 0) return [];
      
      const userIds = userLocations.map(ul => ul.user_id);
      
      // Fetch profiles for those users
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', userIds)
        .eq('is_active', true)
        .order('full_name');
      
      if (error) throw error;
      return (data as EmployeeOption[]) || [];
    },
    enabled: !!currentLocation,
  });

  // Fetch custom reasons for the location
  const { data: customReasons = [] } = useQuery({
    queryKey: ['writeup-reasons', currentLocation?.id],
    queryFn: async (): Promise<ReasonOption[]> => {
      if (!currentLocation) return [];
      const { data, error } = await (supabase as any)
        .from('employee_writeup_reasons')
        .select('id, reason')
        .eq('location_id', currentLocation.id)
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      return (data as ReasonOption[]) || [];
    },
    enabled: !!currentLocation,
  });

  // Combine default and custom reasons
  const allReasons = [
    ...DEFAULT_REASONS,
    ...customReasons.map((r: any) => r.reason).filter((r: string) => !DEFAULT_REASONS.includes(r))
  ];

  // Add new reason mutation
  const addReasonMutation = useMutation({
    mutationFn: async (reasonName: string) => {
      if (!currentLocation) throw new Error("No location");
      const { error } = await supabase
        .from('employee_writeup_reasons')
        .insert({
          location_id: currentLocation.id,
          reason: reasonName,
          display_order: customReasons.length + DEFAULT_REASONS.length,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reason added");
      queryClient.invalidateQueries({ queryKey: ['writeup-reasons'] });
      setShowReasonDialog(false);
      setNewReasonName("");
    },
    onError: (error: any) => {
      toast.error("Failed to add reason: " + error.message);
    },
  });

  const handlePhotoUpload = async (file: File) => {
    setUploading(true);
    try {
      const compressed = await compressImage(file, 1200, 1200, 0.8);
      const fileName = `writeups/${user!.id}/${Date.now()}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from('logbook-attachments')
        .upload(fileName, compressed);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('logbook-attachments')
        .getPublicUrl(fileName);

      setPhotoUrl(publicUrl);
      toast.success("Photo uploaded");
    } catch (error: any) {
      toast.error("Failed to upload photo: " + error.message);
    } finally {
      setUploading(false);
    }
  };

  // Get manager name
  const { data: managerProfile } = useQuery({
    queryKey: ['manager-profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();
      return data;
    },
    enabled: !!user?.id,
  });

  const handleSubmit = async () => {
    if (!selectedEmployee) {
      toast.error("Please select an employee");
      return;
    }
    if (!reason) {
      toast.error("Please select a reason");
      return;
    }
    const hasRecordedNotes = !!recording && recording.bullets.length > 0;
    if (!hasRecordedNotes && !issueDescription.trim()) {
      toast.error("Please describe the issue");
      return;
    }
    if (!nextSteps.trim()) {
      toast.error("Please provide next steps");
      return;
    }

    await onSave({
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.full_name,
      reason,
      issueDescription: issueDescription.trim(),
      nextSteps: nextSteps.trim(),
      photoUrl: photoUrl || undefined,
      isFinalWarning,
      familyId,
      transcriptText: recording?.transcript || null,
      notesBullets: recording?.bullets?.length ? recording.bullets : null,
      consentConfirmedAt: recording?.consentConfirmedAt || null,
      recordingDurationSeconds: recording?.durationSeconds || null,
      sttModelUsed: recording?.sttModel || null,
    });

    // Send email notification to the employee
    try {
      // Get employee email
      const { data: employeeData } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', selectedEmployee.id)
        .single();

      if (employeeData?.email) {
        await supabase.functions.invoke('send-notification-email', {
          body: {
            type: 'employee_writeup',
            to: employeeData.email,
            data: {
              reason,
              issue_description: issueDescription.trim(),
              next_steps: nextSteps.trim(),
              is_final_warning: isFinalWarning,
              manager_name: managerProfile?.full_name || 'Management',
              location_name: currentLocation?.name,
              date: new Date().toLocaleDateString(),
            },
          },
        });
        console.log('Corrective action email sent to employee');
      }
    } catch (emailError) {
      console.error('Failed to send corrective action email:', emailError);
      // Don't block the form submission if email fails
    }
  };

  return (
    <div className="space-y-4">
      {/* Employee Selector with Search */}
      <div className="space-y-2">
        <Label>Employee *</Label>
        <Popover open={employeeOpen} onOpenChange={setEmployeeOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={employeeOpen}
              className="w-full justify-between"
            >
              {selectedEmployee ? (
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={selectedEmployee.profile_photo_url} />
                    <AvatarFallback><User className="h-3 w-3" /></AvatarFallback>
                  </Avatar>
                  {getDisplayName(selectedEmployee.full_name, selectedEmployee.nickname)}
                </div>
              ) : (
                "Select employee..."
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0">
            <Command>
              <CommandInput placeholder="Search employees..." />
              <CommandList>
                <CommandEmpty>No employee found.</CommandEmpty>
                <CommandGroup>
                  {employees.map((employee: any) => (
                    <CommandItem
                      key={employee.id}
                      value={getDisplayName(employee.full_name, employee.nickname)}
                      onSelect={() => {
                        setSelectedEmployee(employee);
                        setEmployeeOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={employee.profile_photo_url} />
                          <AvatarFallback><User className="h-3 w-3" /></AvatarFallback>
                        </Avatar>
                        {getDisplayName(employee.full_name, employee.nickname)}
                      </div>
                      <Check
                        className={cn(
                          "ml-auto h-4 w-4",
                          selectedEmployee?.id === employee.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Reason Selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Reason *</Label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setShowReasonDialog(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Reason
          </Button>
        </div>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger>
            <SelectValue placeholder="Select reason..." />
          </SelectTrigger>
          <SelectContent>
            {allReasons.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Trails: attach to an existing issue or start a new one */}
      <CorrectiveActionTrails
        employeeId={selectedEmployee?.id ?? null}
        selectedFamilyId={familyId}
        onSelect={setFamilyId}
        currentReason={reason}
      />

      {/* Conversation recording (optional) */}
      <CorrectiveActionRecorder
        reasonOptions={allReasons}
        employeeId={selectedEmployee?.id ?? null}
        employeeName={selectedEmployee ? getDisplayName(selectedEmployee.full_name, selectedEmployee.nickname) : ""}
        managerName={managerProfile?.full_name || "Manager"}
        value={recording}
        onChange={setRecording}
      />

      {/* Issue Description */}
      <div className="space-y-2">
        <Label>Issue Description {recording?.bullets?.length ? "(optional — notes captured)" : "*"}</Label>
        <Textarea
          placeholder="Describe what happened..."
          value={issueDescription}
          onChange={(e) => setIssueDescription(e.target.value)}
          rows={4}
        />
      </div>

      {/* Next Steps */}
      <div className="space-y-2">
        <Label>Next Steps for Team Member *</Label>
        <Textarea
          placeholder="What should the team member do to improve..."
          value={nextSteps}
          onChange={(e) => setNextSteps(e.target.value)}
        rows={3}
        />
      </div>

      {/* Final Warning Checkbox */}
      <div className="flex items-center space-x-3 py-2 px-3 rounded-lg border border-destructive/30 bg-destructive/5">
        <Checkbox
          id="finalWarning"
          checked={isFinalWarning}
          onCheckedChange={(checked) => setIsFinalWarning(checked === true)}
        />
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <Label htmlFor="finalWarning" className="text-sm font-medium cursor-pointer">
            This is a final warning
          </Label>
        </div>
      </div>

      {/* Photo Upload */}
      <div className="space-y-2">
        <Label>Supporting Photo (Optional)</Label>
        {photoUrl ? (
          <div className="relative">
            <img src={photoUrl} alt="Evidence" className="w-full h-40 object-cover rounded-lg border" />
            <Button
              size="sm"
              variant="destructive"
              className="absolute top-2 right-2"
              onClick={() => setPhotoUrl(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50 transition-colors">
            <input
              type="file"
              accept="image/*"
              capture={isIOS ? "environment" : undefined}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePhotoUpload(file);
              }}
              disabled={uploading}
            />
            {uploading ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Camera className="h-8 w-8 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">Tap to add photo</span>
              </>
            )}
          </label>
        )}
      </div>

      {/* Submit Button */}
      <Button 
        onClick={handleSubmit} 
        disabled={
          isSaving || !selectedEmployee || !reason || !nextSteps.trim() ||
          (!(recording?.bullets?.length) && !issueDescription.trim())
        }
        className="w-full"
      >
        {isSaving ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Submitting...
          </>
        ) : (
          "Submit Corrective Action"
        )}
      </Button>

      {/* Add Reason Dialog */}
      <Dialog open={showReasonDialog} onOpenChange={setShowReasonDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add New Reason</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              placeholder="Reason name..."
              value={newReasonName}
              onChange={(e) => setNewReasonName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReasonDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => addReasonMutation.mutate(newReasonName.trim())}
              disabled={!newReasonName.trim() || addReasonMutation.isPending}
            >
              {addReasonMutation.isPending ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}