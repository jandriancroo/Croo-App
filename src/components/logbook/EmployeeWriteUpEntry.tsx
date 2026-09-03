import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertTriangle, Check, Clock, Eye, User } from "lucide-react";
import { format } from "date-fns";

interface WriteUpData {
  id: string;
  employee_name?: string;
  reason: string;
  issue_description: string;
  next_steps: string;
  photo_url?: string;
  signature_url?: string;
  signed_at?: string;
  viewed_at?: string;
  created_at: string;
  is_final_warning?: boolean;
  employee?: { full_name: string; profile_photo_url?: string };
  created_by_profile?: { full_name: string };
}

interface EmployeeWriteUpEntryProps {
  writeUp: WriteUpData;
}

export function EmployeeWriteUpEntry({ writeUp }: EmployeeWriteUpEntryProps) {
  const [showDetails, setShowDetails] = useState(false);
  const isSigned = !!writeUp.signature_url;
  const employeeName = writeUp.employee?.full_name || writeUp.employee_name || 'Unknown';

  return (
    <>
      {/* Compact Single-Line View - name already shown in card header */}
      <div className="flex items-center justify-between gap-2 -my-1">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge variant="outline" className="text-xs shrink-0 h-5 px-1.5">{writeUp.reason}</Badge>
          {writeUp.is_final_warning && (
            <Badge variant="outline" className="border-destructive text-destructive text-xs shrink-0 h-5 px-1.5">
              Final
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isSigned ? (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <Check className="h-3.5 w-3.5" />
              Signed
            </span>
          ) : (
            <span className="text-xs text-amber-600 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Pending
            </span>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowDetails(true)}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Details Sheet */}
      <Sheet open={showDetails} onOpenChange={setShowDetails}>
        <SheetContent side="bottom" className="h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Corrective Action Details
            </SheetTitle>
          </SheetHeader>
          
          <div className="space-y-4 mt-4">
            {/* Employee Info */}
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={writeUp.employee?.profile_photo_url} />
                <AvatarFallback><User className="h-5 w-5" /></AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{employeeName}</p>
                <p className="text-sm text-muted-foreground">
                  Written by {writeUp.created_by_profile?.full_name} • {format(new Date(writeUp.created_at), 'MMM d, yyyy')}
                </p>
              </div>
            </div>

            {/* Badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="destructive">{writeUp.reason}</Badge>
              {writeUp.is_final_warning && (
                <Badge variant="outline" className="border-destructive text-destructive bg-destructive/10">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Final Warning
                </Badge>
              )}
              <Badge variant={isSigned ? "default" : "outline"} className={isSigned ? "bg-green-600" : "text-amber-600 border-amber-600"}>
                {isSigned ? (
                  <>
                    <Check className="h-3 w-3 mr-1" />
                    Signed
                  </>
                ) : (
                  <>
                    <Clock className="h-3 w-3 mr-1" />
                    Pending Signature
                  </>
                )}
              </Badge>
            </div>

            {/* Issue Description */}
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Issue Description</p>
              <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-lg">{writeUp.issue_description}</p>
            </div>

            {/* Next Steps */}
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Next Steps</p>
              <p className="text-sm whitespace-pre-wrap bg-primary/5 p-3 rounded-lg border border-primary/20">{writeUp.next_steps}</p>
            </div>

            {/* Photo Evidence */}
            {writeUp.photo_url && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Photo Evidence</p>
                <img 
                  src={writeUp.photo_url} 
                  alt="Evidence" 
                  className="w-full h-48 object-cover rounded-lg border"
                />
              </div>
            )}

            {/* Signature */}
            {isSigned && writeUp.signature_url && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Employee Signature</p>
                <div className="bg-white dark:bg-slate-900 rounded-lg border p-3">
                  <img 
                    src={writeUp.signature_url} 
                    alt="Signature" 
                    className="h-20 object-contain mx-auto"
                  />
                </div>
                {writeUp.signed_at && (
                  <p className="text-xs text-muted-foreground text-center">
                    Signed on {format(new Date(writeUp.signed_at), 'MMM d, yyyy h:mm a')}
                  </p>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// Helper to parse writeup data from log entry
export function parseWriteUpData(entryValueText: string): WriteUpData | null {
  try {
    return JSON.parse(entryValueText);
  } catch {
    return null;
  }
}
