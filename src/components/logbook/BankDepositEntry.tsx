import { format } from "date-fns";
import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface BankDepositData {
  startDate: string;
  endDate: string;
  entries: Array<{
    entryId: string;
    entryDate: string;
    depositAmount: number;
  }>;
  totalDollars: number;
  totalChange: number;
  totalAmount: number;
  daysIncluded: number;
  notes?: string;
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

interface BankDepositEntryProps {
  data: BankDepositData;
  createdAt: string;
}

export function BankDepositEntry({ data, createdAt }: BankDepositEntryProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Building2 className="h-4 w-4 text-teal-500" />
        <span className="font-medium text-teal-600 dark:text-teal-400">
          ${data.totalAmount?.toFixed(2)}
        </span>
        <Badge variant="secondary" className="text-xs">
          {data.daysIncluded} day{data.daysIncluded !== 1 ? 's' : ''}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground">
        {format(new Date(data.startDate + 'T12:00:00'), 'MMM d')} - {format(new Date(data.endDate + 'T12:00:00'), 'MMM d, yyyy')}
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Bills: ${data.totalDollars?.toFixed(2)}</span>
        <span>Coins: ${data.totalChange?.toFixed(2)}</span>
      </div>
      {data.notes && (
        <p className="text-xs text-muted-foreground italic">{data.notes}</p>
      )}
    </div>
  );
}
