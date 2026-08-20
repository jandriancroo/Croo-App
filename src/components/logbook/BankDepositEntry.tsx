import { useState } from "react";
import { format } from "date-fns";
import { Building2, Eye, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getBankVerificationUrl } from "./BankVerificationPhoto";

export interface BankDepositData {
  startDate: string;
  endDate: string;
  entries: Array<{
    entryId: string;
    entryDate: string;
    depositAmount: number;
    slipPath?: string;
    audit?: {
      countedAmount: number;
      variance: number;
      auditedAt: string;
      auditedByName?: string;
    };
  }>;

  totalDollars: number;
  totalChange: number;
  totalAmount: number;
  daysIncluded: number;
  notes?: string;
  receiptPath?: string;
  verificationRequired?: boolean;
}

function VerificationPhotoLink({ path, label }: { path: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const handleOpen = async (next: boolean) => {
    setOpen(next);
    if (next && !url) setUrl(await getBankVerificationUrl(path));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={label}>
          <ImageIcon className="h-3.5 w-3.5 text-teal-600" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        {url ? <img src={url} alt={label} className="w-full rounded-lg" /> : null}
      </DialogContent>
    </Dialog>
  );
}


export function parseBankDepositData(valueText: string): BankDepositData | null {
  try {
    const data = JSON.parse(valueText);
    // Check if this is bank deposit data by checking for required fields
    if (data.startDate && data.endDate && data.totalAmount !== undefined) {
      return data as BankDepositData;
    }
    return null;
  } catch {
    return null;
  }
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
};

interface BankDepositEntryProps {
  data: BankDepositData;
  createdAt: string;
}

export function BankDepositEntry({ data, createdAt }: BankDepositEntryProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 text-teal-500" />
            <span className="font-medium text-teal-600 dark:text-teal-400">
              {formatCurrency(data.totalAmount)}
            </span>
          </div>
          <Badge variant="secondary" className="text-xs">
            {data.daysIncluded} day{data.daysIncluded !== 1 ? 's' : ''}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {format(new Date(data.startDate + 'T12:00:00'), 'MMM d')} - {format(new Date(data.endDate + 'T12:00:00'), 'MMM d')}
          </span>
        </div>
        
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full sm:w-auto">
              <Eye className="h-4 w-4 mr-1" />
              Details
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-teal-500" />
                Bank Deposit Details
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Entered at {format(new Date(createdAt), 'h:mm a')} on {format(new Date(createdAt), 'MMM d, yyyy')}
              </div>
              
              {/* Date range */}
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="text-sm font-medium mb-1">Deposit Period</div>
                <div className="text-sm text-muted-foreground">
                  {format(new Date(data.startDate + 'T12:00:00'), 'EEEE, MMM d')} – {format(new Date(data.endDate + 'T12:00:00'), 'EEEE, MMM d, yyyy')}
                </div>
              </div>
              
              {/* Individual days breakdown */}
              <div className="space-y-2">
                <div className="font-medium text-sm">Daily Breakdown</div>
                <div className="space-y-1">
                  {data.entries.map((entry, idx) => (
                    <div key={entry.entryId || idx} className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground flex items-center gap-1">
                        {format(new Date(entry.entryDate + 'T12:00:00'), 'EEE, MMM d')}
                        {entry.slipPath && (
                          <VerificationPhotoLink
                            path={entry.slipPath}
                            label={`Deposit slip — ${format(new Date(entry.entryDate + 'T12:00:00'), 'MMM d')}`}
                          />
                        )}
                      </span>
                      <span className="font-medium">{formatCurrency(entry.depositAmount)}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Totals */}
              <div className="border-t pt-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Bills:</span>
                  <span className="font-medium">{formatCurrency(data.totalDollars)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Coins:</span>
                  <span className="font-medium">{formatCurrency(data.totalChange)}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="font-medium flex items-center gap-1">
                    Total Deposit:
                    {data.receiptPath && (
                      <VerificationPhotoLink path={data.receiptPath} label="Bank receipt" />
                    )}
                  </span>
                  <span className="font-bold text-teal-600 dark:text-teal-400 text-lg">
                    {formatCurrency(data.totalAmount)}
                  </span>
                </div>
              </div>

              
              {/* Notes */}
              {data.notes && (
                <div className="border-t pt-3">
                  <div className="font-medium text-sm mb-1">Notes</div>
                  <p className="text-sm text-muted-foreground italic">{data.notes}</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
