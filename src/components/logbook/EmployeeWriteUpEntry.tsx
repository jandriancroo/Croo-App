import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AlertTriangle, Check, Clock, FileText, User } from "lucide-react";
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
  const isSigned = !!writeUp.signature_url;
  const isPending = !isSigned;

  return (
    <div className="space-y-3">
      {/* Header with employee and status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src={writeUp.employee?.profile_photo_url} />
            <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-sm">{writeUp.employee?.full_name || writeUp.employee_name}</p>
            <p className="text-xs text-muted-foreground">
              Written by {writeUp.created_by_profile?.full_name}
            </p>
          </div>
        </div>
        <Badge variant={isSigned ? "default" : "outline"} className={isSigned ? "bg-green-600" : "text-amber-600 border-amber-600"}>
          {isSigned ? (
            <>
              <Check className="h-3 w-3 mr-1" />
              Signed
            </>
          ) : (
            <>
              <Clock className="h-3 w-3 mr-1" />
              Pending
            </>
          )}
        </Badge>
      </div>

      {/* Reason and Final Warning */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="destructive">{writeUp.reason}</Badge>
        {writeUp.is_final_warning && (
          <Badge variant="outline" className="border-destructive text-destructive bg-destructive/10">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Final Warning
          </Badge>
        )}
      </div>

      {/* Issue Description */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Issue</p>
        <p className="text-sm whitespace-pre-wrap">{writeUp.issue_description}</p>
      </div>

      {/* Next Steps */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Next Steps</p>
        <p className="text-sm whitespace-pre-wrap">{writeUp.next_steps}</p>
      </div>

      {/* Photo */}
      {writeUp.photo_url && (
        <img 
          src={writeUp.photo_url} 
          alt="Evidence" 
          className="w-full h-32 object-cover rounded-lg border"
        />
      )}

      {/* Signature */}
      {isSigned && writeUp.signature_url && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Employee Signature</p>
          <div className="bg-white dark:bg-slate-900 rounded-lg border p-2">
            <img 
              src={writeUp.signature_url} 
              alt="Signature" 
              className="h-16 object-contain mx-auto"
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