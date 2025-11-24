import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { differenceInHours, parseISO, format } from "date-fns";

interface RequestAvailabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function RequestAvailabilityDialog({ open, onOpenChange, onSuccess }: RequestAvailabilityDialogProps) {
  const [requestType, setRequestType] = useState<"paid" | "unpaid">("unpaid");
  const [timeScope, setTimeScope] = useState<"multi_day" | "full_day" | "partial_day">("full_day");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const today = format(new Date(), "yyyy-MM-dd");
  
  // Get max date for paid (today) and min date for unpaid (today)
  const getDateConstraints = () => {
    if (requestType === "paid") {
      return { max: today }; // Paid can only be present or past
    } else {
      return { min: today }; // Unpaid can only be present or future
    }
  };

  const calculateHours = () => {
    if (timeScope === "partial_day") {
      if (!startTime || !endTime) return 0;
      const start = parseISO(`2000-01-01T${startTime}`);
      const end = parseISO(`2000-01-01T${endTime}`);
      return Math.max(0, differenceInHours(end, start));
    } else if (timeScope === "full_day") {
      return 8; // Standard work day
    } else if (timeScope === "multi_day") {
      if (!startDate || !endDate) return 0;
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      const days = Math.max(1, Math.ceil(differenceInHours(end, start) / 24) + 1);
      return days * 8; // 8 hours per day
    }
    return 0;
  };

  const handleSubmit = async () => {
    if (!startDate) {
      toast.error("Please select a start date");
      return;
    }

    if (timeScope === "multi_day" && !endDate) {
      toast.error("Please select an end date");
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const hours = calculateHours();

      const { error } = await supabase.from("availability_requests").insert({
        user_id: user.id,
        request_type: requestType,
        time_scope: timeScope,
        start_date: startDate,
        end_date: timeScope === "multi_day" ? endDate : null,
        start_time: timeScope === "partial_day" ? startTime : null,
        end_time: timeScope === "partial_day" ? endTime : null,
        hours_requested: hours,
        notes: notes || null,
      });

      if (error) throw error;

      toast.success("Availability request submitted");
      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (error: any) {
      console.error("Error submitting request:", error);
      toast.error("Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setRequestType("unpaid");
    setTimeScope("full_day");
    setStartDate("");
    setEndDate("");
    setStartTime("09:00");
    setEndTime("17:00");
    setNotes("");
  };

  // Reset date when changing request type
  const handleRequestTypeChange = (newType: "paid" | "unpaid") => {
    setRequestType(newType);
    setStartDate("");
    setEndDate("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Request Time Off</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="request-type">Request Type</Label>
            <Select value={requestType} onValueChange={handleRequestTypeChange}>
              <SelectTrigger id="request-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="paid">Paid Sick Leave (Past/Present)</SelectItem>
                <SelectItem value="unpaid">Unpaid Time Off (Present/Future)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="time-scope">Time Period</Label>
            <Select value={timeScope} onValueChange={(val) => setTimeScope(val as any)}>
              <SelectTrigger id="time-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_day">Full Work Day</SelectItem>
                <SelectItem value="partial_day">Partial Day (Specific Hours)</SelectItem>
                <SelectItem value="multi_day">Multiple Days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                {...getDateConstraints()}
              />
            </div>
            {timeScope === "multi_day" && (
              <div className="space-y-2">
                <Label htmlFor="end-date">End Date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  {...getDateConstraints()}
                />
              </div>
            )}
          </div>

          {timeScope === "partial_day" && (
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
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any additional information..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="p-3 bg-muted rounded-md">
            <p className="text-sm">
              <strong>Hours Requested:</strong> {calculateHours()} hours
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}