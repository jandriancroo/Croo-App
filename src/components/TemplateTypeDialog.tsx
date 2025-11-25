import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Calendar } from "lucide-react";
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
          <Button
            variant="outline"
            className="h-auto p-4 text-left flex flex-col items-start gap-2"
            onClick={handleSelectStandard}
          >
            <div className="flex items-center gap-2 w-full">
              <FileText className="h-5 w-5 flex-shrink-0" />
              <span className="font-semibold">Standard Checklist</span>
            </div>
            <p className="text-xs text-muted-foreground pl-7">
              Create a regular checklist that can be completed daily, weekly, or monthly
            </p>
          </Button>
          
          <Button
            variant="outline"
            className="h-auto p-4 text-left flex flex-col items-start gap-2"
            onClick={handleSelectDynamic}
          >
            <div className="flex items-center gap-2 w-full">
              <Calendar className="h-5 w-5 flex-shrink-0" />
              <span className="font-semibold">Dynamic Weekly Template</span>
            </div>
            <p className="text-xs text-muted-foreground pl-7">
              Create a weekly template where different tasks are assigned to specific days
            </p>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
