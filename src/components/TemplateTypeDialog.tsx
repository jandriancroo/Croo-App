import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Calendar, GraduationCap } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface TemplateTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TemplateTypeDialog({ open, onOpenChange }: TemplateTypeDialogProps) {
  const navigate = useNavigate();

  const handleSelectStandard = () => {
    onOpenChange(false);
    navigate('/create-checklist');
  };

  const handleSelectTraining = () => {
    onOpenChange(false);
    navigate('/create-checklist?type=training');
  };

  const handleSelectDynamic = () => {
    onOpenChange(false);
    navigate('/dynamic-checklist/new');
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose Template Type</DialogTitle>
          <DialogDescription>
            Select the type of checklist you want to create
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <button
            onClick={handleSelectStandard}
            className="text-left p-4 border rounded-lg hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-3 mb-2">
              <FileText className="h-5 w-5 flex-shrink-0" />
              <span className="font-semibold">Standard Checklist</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Create a regular checklist that can be completed daily, weekly, or monthly
            </p>
          </button>
          
          <button
            onClick={handleSelectDynamic}
            className="text-left p-4 border rounded-lg hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-3 mb-2">
              <Calendar className="h-5 w-5 flex-shrink-0" />
              <span className="font-semibold">Dynamic Weekly Template</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Create a weekly template where different tasks are assigned to specific days
            </p>
          </button>

          <button
            onClick={handleSelectTraining}
            className="text-left p-4 border rounded-lg hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-3 mb-2">
              <GraduationCap className="h-5 w-5 flex-shrink-0" />
              <span className="font-semibold">Training Checklist</span>
            </div>
            <p className="text-sm text-muted-foreground">
              A reusable training list you assign to team members for a specific date, with optional manager approval
            </p>
          </button>

        </div>
      </DialogContent>
    </Dialog>
  );
}
