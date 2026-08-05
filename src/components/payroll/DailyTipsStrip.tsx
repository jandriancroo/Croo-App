import { DateTime } from 'luxon';
import { Card, CardContent } from '@/components/ui/card';
import { Coins } from 'lucide-react';

interface DailyTip {
  date: string;
  ccTips: number;
  cashTips: number;
  totalTips: number;
}

interface DailyTipsStripProps {
  dailyTips: DailyTip[];
  totalTipPool: number;
  timezone?: string;
}

export function DailyTipsStrip({ dailyTips, totalTipPool, timezone = 'America/Los_Angeles' }: DailyTipsStripProps) {
  if (!dailyTips.length) return null;

  const formatDay = (dateStr: string) =>
    DateTime.fromFormat(dateStr, 'yyyy-MM-dd', { zone: timezone });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Daily Tip Pool</p>
            <span className="text-xs text-muted-foreground">({dailyTips.length} days)</span>
          </div>
          <p className="text-sm font-bold">${totalTipPool.toFixed(2)}</p>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {dailyTips.map((day) => {
            const dt = formatDay(day.date);
            return (
              <div
                key={day.date}
                className="flex-shrink-0 min-w-[74px] rounded-lg border bg-muted/40 px-2.5 py-2 text-center"
              >
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {dt.isValid ? dt.toFormat('ccc') : ''}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {dt.isValid ? dt.toFormat('M/d') : day.date}
                </p>
                <p
                  className={`mt-1 text-sm font-semibold tabular-nums ${
                    day.totalTips > 0 ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  ${day.totalTips.toFixed(2)}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
