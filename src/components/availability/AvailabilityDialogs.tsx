import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface AvailabilityDialogsProps {
  processing: boolean;
  // Deny
  denyDialogOpen: boolean;
  setDenyDialogOpen: (v: boolean) => void;
  denialReason: string;
  setDenialReason: (v: string) => void;
  handleDeny: () => void;
  // Edit
  editDialogOpen: boolean;
  setEditDialogOpen: (v: boolean) => void;
  editRequestType: string;
  setEditRequestType: (v: any) => void;
  editTimeScope: string;
  setEditTimeScope: (v: any) => void;
  editStartDate: string;
  setEditStartDate: (v: string) => void;
  editEndDate: string;
  setEditEndDate: (v: string) => void;
  editStartTime: string;
  setEditStartTime: (v: string) => void;
  editEndTime: string;
  setEditEndTime: (v: string) => void;
  editHours: string;
  setEditHours: (v: string) => void;
  editStatus: string;
  setEditStatus: (v: string) => void;
  editNotes: string;
  setEditNotes: (v: string) => void;
  handleEditRequest: () => void;
  // Delete
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (v: boolean) => void;
  handleDeleteRequest: () => void;
  // Employee edit
  employeeEditDialogOpen: boolean;
  setEmployeeEditDialogOpen: (v: boolean) => void;
  employeeEditNotes: string;
  setEmployeeEditNotes: (v: string) => void;
  handleEmployeeEditRequest: () => void;
}

export function AvailabilityDialogs({
  processing,
  denyDialogOpen, setDenyDialogOpen, denialReason, setDenialReason, handleDeny,
  editDialogOpen, setEditDialogOpen,
  editRequestType, setEditRequestType,
  editTimeScope, setEditTimeScope,
  editStartDate, setEditStartDate,
  editEndDate, setEditEndDate,
  editStartTime, setEditStartTime,
  editEndTime, setEditEndTime,
  editHours, setEditHours,
  editStatus, setEditStatus,
  editNotes, setEditNotes,
  handleEditRequest,
  deleteDialogOpen, setDeleteDialogOpen, handleDeleteRequest,
  employeeEditDialogOpen, setEmployeeEditDialogOpen,
  employeeEditNotes, setEmployeeEditNotes, handleEmployeeEditRequest,
}: AvailabilityDialogsProps) {
  return (
    <>
      {/* Denial Dialog */}
      <Dialog open={denyDialogOpen} onOpenChange={setDenyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason (Optional)</label>
              <Textarea
                placeholder="Provide a reason for denying this request..."
                value={denialReason}
                onChange={(e) => setDenialReason(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenyDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeny} disabled={processing}>
              {processing ? "Denying..." : "Deny Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Request Type</Label>
                <Select value={editRequestType} onValueChange={setEditRequestType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Time Period</Label>
                <Select value={editTimeScope} onValueChange={setEditTimeScope}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_day">Full Day</SelectItem>
                    <SelectItem value="partial_day">Partial Day</SelectItem>
                    <SelectItem value="multi_day">Multiple Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
              </div>
              {editTimeScope === "multi_day" && (
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} />
                </div>
              )}
              {editTimeScope === "partial_day" && (
                <>
                  <div className="space-y-2">
                    <Label>Start Time</Label>
                    <Input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    <Input type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} />
                  </div>
                </>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Hours Requested</Label>
                <Input type="number" step="0.5" min="0" value={editHours} onChange={(e) => setEditHours(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="denied">Denied</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea placeholder="Add notes..." value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditRequest} disabled={processing}>
              {processing ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Request</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this time-off request? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRequest}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {processing ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Employee Edit Dialog */}
      <Dialog open={employeeEditDialogOpen} onOpenChange={setEmployeeEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Editing your request will reset it to pending status and require manager approval again.
            </p>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea placeholder="Add notes..." value={employeeEditNotes} onChange={(e) => setEmployeeEditNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmployeeEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEmployeeEditRequest} disabled={processing}>
              {processing ? "Saving..." : "Update & Resubmit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
