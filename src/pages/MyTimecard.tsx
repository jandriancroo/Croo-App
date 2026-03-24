import { useState } from "react";
import { Layout } from "@/components/Layout";
import { PageHeaderDivider } from "@/components/ui/page-header-divider";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { formatInTimeZone } from "date-fns-tz";
import { Clock, DollarSign, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePersonalPayData } from "@/hooks/usePersonalPayData";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { parseDateStringInTimezone } from "@/utils/timezoneUtils";

export default function MyTimecard() {
  const [periodOffset, setPeriodOffset] = useState(0);
  const { hasPermission } = useRolePermissions();
  const { isShiftManager } = useUserRole();

  // Permission checks — shift managers+ always see everything
  const canViewTimecard = isShiftManager || hasPermission('view_own_timecard');
  const canViewEstimatedPay = isShiftManager || hasPermission('view_estimated_pay_week');

  const { data: payData, isLoading } = usePersonalPayData(periodOffset);
  const isCurrentPeriod = periodOffset === 0;

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading timecard...</p>
        </div>
      </Layout>
    );
  }

  const hoursWorked = payData?.hoursPayroll ?? 0;
  const estimatedGross = payData?.payPayroll ?? 0;
  const hourlyWage = payData?.hourlyWage ?? 15;
  const shifts = payData?.shifts ?? [];
  const regularHours = payData?.regularHours ?? 0;
  const overtimeHours = payData?.overtimeHours ?? 0;
  const doubleTimeHours = payData?.doubleTimeHours ?? 0;

  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold">My Timecard</h1>
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground">
              {payData && (
                <>Pay Period: {format(parseISO(payData.payPeriodStart), "MMM d")} - {format(parseISO(payData.payPeriodEnd), "MMM d, yyyy")}</>
              )}
            </p>
            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setPeriodOffset(prev => prev - 1)}
                className="h-8 w-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setPeriodOffset(0)}
                disabled={isCurrentPeriod}
                className="text-xs"
              >
                {isCurrentPeriod ? "Current" : "Today"}
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setPeriodOffset(prev => prev + 1)}
                disabled={isCurrentPeriod}
                className="h-8 w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <PageHeaderDivider />
        </div>

        {/* Hours & Earnings Summary */}
        <div className={`grid grid-cols-1 ${canViewEstimatedPay ? 'sm:grid-cols-2' : ''} gap-3`}>
          {canViewTimecard && (
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <Clock className="h-4 w-4" />
                Hours Worked this Pay Period
              </div>
              <p className="text-2xl font-bold">{hoursWorked.toFixed(1)}</p>
              {(overtimeHours > 0 || doubleTimeHours > 0) && (
                <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                  <p>Regular: {regularHours.toFixed(1)} hrs</p>
                  {overtimeHours > 0 && <p className="text-amber-600">OT (1.5x): {overtimeHours.toFixed(1)} hrs</p>}
                  {doubleTimeHours > 0 && <p className="text-orange-600">DT (2x): {doubleTimeHours.toFixed(1)} hrs</p>}
                </div>
              )}
            </Card>
          )}

          {canViewEstimatedPay && (
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <DollarSign className="h-4 w-4" />
                Estimated Gross Pay
              </div>
              <p className="text-2xl font-bold">${estimatedGross.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                @ ${hourlyWage.toFixed(0)}/hr base
              </p>
            </Card>
          )}
        </div>

        {/* Shifts Breakdown */}
        {canViewTimecard && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Shifts This Pay Period
              </CardTitle>
              <CardDescription>
                {shifts.length} shift{shifts.length !== 1 ? 's' : ''} worked
              </CardDescription>
            </CardHeader>
            <CardContent>
              {shifts.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">No shifts recorded yet</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(
                    shifts.reduce((acc, shift) => {
                      if (!acc[shift.date]) {
                        acc[shift.date] = [];
                      }
                      acc[shift.date].push(shift);
                      return acc;
                    }, {} as Record<string, typeof shifts>)
                  )
                    .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
                    .map(([date, dayShifts]) => {
                      const totalHours = dayShifts.reduce((sum, s) => sum + s.hours, 0);
                      const totalPay = dayShifts.reduce((sum, s) => sum + s.estimatedPay, 0);
                      
                      return (
                        <div key={date} className="p-3 border rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              <p className="font-medium">
                                {format(parseISO(date), "EEE, MMM d")}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold">{totalHours.toFixed(1)} hrs</p>
                              {canViewEstimatedPay && (
                                <p className="text-xs text-muted-foreground">${totalPay.toFixed(2)}</p>
                              )}
                            </div>
                          </div>
                          <div className="ml-7 space-y-1">
                            {dayShifts
                              .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime())
                              .map((shift, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm text-muted-foreground">
                                  <span>
                                    {format(shift.clockIn, "h:mm a")} - {shift.clockOut ? format(shift.clockOut, "h:mm a") : "In Progress"}
                                  </span>
                                  <span>{shift.hours.toFixed(1)} hrs</span>
                                </div>
                              ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!canViewTimecard && !canViewEstimatedPay && (
          <Card className="bg-muted/50">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground text-center">
                Your organization has not enabled timecard viewing for your role. Contact your manager for details.
              </p>
            </CardContent>
          </Card>
        )}

        {canViewEstimatedPay && (
          <Card className="bg-muted/50">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                <strong>Note:</strong> Estimated gross pay is calculated from your punch clock entries 
                and current hourly rate. Actual pay may differ based on overtime, deductions, and payroll adjustments.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
