import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ChevronLeft, AlertTriangle, Trash2, Clock, CheckCircle2, Lock, AlertCircle, Coffee, Download, FileSpreadsheet, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Layout } from '@/components/Layout';
import { QuickPunchDialog } from '@/components/timeclock/QuickPunchDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DesktopTimeTrackingTable } from '@/components/timetracking/DesktopTimeTrackingTable';
import { DayByDayView } from '@/components/timetracking/DayByDayView';
import { MobileTimeTrackingCard } from '@/components/timetracking/MobileTimeTrackingCard';
import { MobileDayByDayCard } from '@/components/timetracking/MobileDayByDayCard';
import { EditShiftForm } from '@/components/timetracking/EditShiftForm';
import { Users, CalendarDays, Flag } from 'lucide-react';
import { usePayrollData } from '@/hooks/usePayrollData';
import { DailyTipsStrip } from '@/components/payroll/DailyTipsStrip';
import { PayPeriodSelector } from '@/components/timetracking/PayPeriodSelector';
import { ClosePeriodDialog, type UnapprovedShift } from '@/components/timetracking/ClosePeriodDialog';
import { useState } from 'react';

import {
  formatDateTimeInTimezone,
  parseDateStringInTimezone,
} from '@/utils/timezoneUtils';

export default function PayrollReview() {
  const {
    isAdmin,
    isManager,
    currentLocation,
    timezone,
    payPeriods,
    visiblePeriodCount,
    showMorePeriods,
    closingPeriod,
    periodSummaries,
    selectedPeriod,
    setSelectedPeriod,
    getPeriodStatus,
    isPeriodClosed,
    handleClosePeriod,
    handleReopenPeriod,
    timeCards,
    fetchTimeCards,
    editingShift,
    setEditingShift,
    showQuickEntry,
    setShowQuickEntry,
    deleteConfirmation,
    setDeleteConfirmation,
    handleDeleteAllDayPunches,
    includeApproved,
    setIncludeApproved,
    filterEmployee,
    setFilterEmployee,
    filterDay,
    setFilterDay,
    filterFlag,
    setFilterFlag,
    viewMode,
    setViewMode,
    periodDates,
    filteredCards,
    approvalWarning,
    setApprovalWarning,
    approvingPunchIds,
    handleApproveDay,
    handleUnapproveDay,
    handleApproveAll,
    approvePunches,
    totalPunchesAwaitingApproval,
    filteredPunchesAwaitingApproval,
    calculateDayHours,
    sortPunches,
    getDayFlags,
    hasDayIssues,
    groupPunchesByWeek,
    calculatePayrollSummary,
    exportToCSV,
    exportToPDF,
    tipsLoading,
    totalTipPool,
    dailyTips,
  } = usePayrollData();
  const [closeOpen, setCloseOpen] = useState(false);
  const reviewNames: Record<string, string> = {};
  (timeCards || []).forEach((c: any) => {
    if (c?.profile?.id) reviewNames[c.profile.id] = c.profile.full_name || c.profile.nickname || c.profile.email || 'Team member';
  });
  const unapprovedShifts: UnapprovedShift[] = [];
  (timeCards || []).forEach((c: any) => {
    Object.entries(c.punchesByDay || {}).forEach(([d, dayPunches]: [string, any]) => {
      const ids = dayPunches.filter((p: any) => !p.approved_at).map((p: any) => p.id);
      if (ids.length === 0 || getDayFlags(dayPunches).hasOpenShift) return;
      const f = getDayFlags(dayPunches);
      const hours = calculateDayHours(dayPunches);
      const sorted = sortPunches(dayPunches);
      const firstIn = sorted.find((p: any) => p.punch_type === 'clock_in');
      const lastOut = [...sorted].reverse().find((p: any) => p.punch_type === 'clock_out');
      const t = (p: any) => p ? formatDateTimeInTimezone(new Date(p.punch_time), timezone, { hour: 'numeric', minute: '2-digit' }) : '—';
      const issues: string[] = [];
      if (f.hasAutoClockOut) issues.push('Auto clock-out');
      if (f.hasBreakViolation) issues.push('No meal break');
      if (hours > 10) issues.push(`Long shift (${hours.toFixed(1)}h)`);
      if (dayPunches.some((p: any) => p.has_extended_break)) issues.push('Long break');
      if (dayPunches.some((p: any) => p.notes === 'Manual entry by manager')) issues.push('Manually edited');
      unapprovedShifts.push({
        key: `${c.profile?.id}_${d}`,
        name: reviewNames[c.profile?.id] || 'Team member',
        date: d,
        hours,
        punchIds: ids,
        timeRange: `${t(firstIn)} – ${t(lastOut)}`,
        issues,
      });
    });
  });
  unapprovedShifts.sort((a, b) => (b.issues.length > 0 ? 1 : 0) - (a.issues.length > 0 ? 1 : 0) || a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  if (!isAdmin && !isManager) {
    return (
      <Layout>
        <Card>
          <CardContent className="p-6 text-center">
            <p>You do not have permission to view payroll data.</p>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {!selectedPeriod ? (
          <>
          <PayPeriodSelector
            payPeriods={payPeriods.slice(0, visiblePeriodCount + 1)}
            visibleCount={visiblePeriodCount}
            periodSummaries={periodSummaries}
            getPeriodStatus={getPeriodStatus}
            timezone={timezone}
            onSelect={setSelectedPeriod}
          />
          {payPeriods.length > visiblePeriodCount && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={showMorePeriods}>Show 4 more</Button>
            </div>
          )}
          </>
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div className="space-y-4">
              <Button variant="ghost" onClick={() => setSelectedPeriod(null)} className="pl-0">
                <ChevronLeft className="mr-2 h-4 w-4" />
                Pay Periods
              </Button>
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold">Payroll Period</h1>
                  <p className="text-muted-foreground">{selectedPeriod.label}</p>
                </div>
                <div className="flex gap-2">
                  {isPeriodClosed ? (
                    <Button variant="outline" onClick={handleReopenPeriod}>
                      Re-Open Pay Period
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => setCloseOpen(true)}>
                      Close Pay Period
                    </Button>
                  )}
                  {!isPeriodClosed && (
                    <Button onClick={() => setShowQuickEntry(true)}>
                      <Calendar className="mr-2 h-4 w-4" />
                      Add punch
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {currentLocation?.id && selectedPeriod && (
              <ClosePeriodDialog
                open={closeOpen}
                onOpenChange={setCloseOpen}
                locationId={currentLocation.id}
                start={selectedPeriod.startDate}
                end={selectedPeriod.endDate}
                timezone={timezone}
                names={reviewNames}
                unapproved={unapprovedShifts}
                approvingIds={approvingPunchIds}
                onApprove={approvePunches}
                closing={closingPeriod}
                onClose={async () => { await handleClosePeriod(); setCloseOpen(false); }}
                onPunchesChanged={() => fetchTimeCards()}
              />
            )}

            {/* View Toggle + Filters */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 overflow-x-hidden">
              {/* View Mode Toggle */}
              <div className="flex rounded-lg border-2 border-border bg-muted/50 p-1 shrink-0 w-fit">
                <button
                  className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-md text-sm font-semibold transition-all ${
                    viewMode === 'employee' 
                      ? 'bg-primary text-primary-foreground shadow-md' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  onClick={() => setViewMode('employee')}
                >
                  <Users className="h-4 w-4" />
                  <span className="hidden sm:inline">By Employee</span>
                </button>
                <button
                  className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-md text-sm font-semibold transition-all ${
                    viewMode === 'day' 
                      ? 'bg-primary text-primary-foreground shadow-md' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  onClick={() => setViewMode('day')}
                >
                  <CalendarDays className="h-4 w-4" />
                  <span className="hidden sm:inline">By Day</span>
                </button>
              </div>

              {/* Filters */}
              <div className="flex-1 grid grid-cols-3 gap-2 max-w-md">
                <Select value={filterDay} onValueChange={setFilterDay}>
                  <SelectTrigger className="h-9 sm:h-10 font-medium">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 sm:hidden shrink-0" />
                      <span className="hidden sm:inline"><SelectValue placeholder="All days" /></span>
                      <span className="sm:hidden text-xs">{filterDay === 'all' ? 'Days' : filterDay.slice(5)}</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All days</SelectItem>
                    {periodDates.map(date => (
                      <SelectItem key={date.value} value={date.value}>
                        {date.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filterEmployee} onValueChange={setFilterEmployee}>
                  <SelectTrigger className="h-9 sm:h-10 font-medium">
                    <div className="flex items-center gap-1.5">
                      <Users className="h-4 w-4 sm:hidden shrink-0" />
                      <span className="hidden sm:inline"><SelectValue placeholder="All employees" /></span>
                      <span className="sm:hidden text-xs">{filterEmployee === 'all' ? 'Team' : '1 emp'}</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All employees</SelectItem>
                    {timeCards.map(card => (
                      <SelectItem key={card.profile.id} value={card.profile.id}>
                        {card.profile.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filterFlag} onValueChange={setFilterFlag}>
                  <SelectTrigger className="h-9 sm:h-10 font-medium">
                    <div className="flex items-center gap-1.5">
                      <Flag className="h-4 w-4 sm:hidden shrink-0" />
                      <span className="hidden sm:inline"><SelectValue placeholder="All shifts" /></span>
                      <span className="sm:hidden text-xs">{filterFlag === 'all' ? 'Flags' : filterFlag.slice(0, 4)}</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All shifts</SelectItem>
                    <SelectItem value="flagged">⚠️ Flagged</SelectItem>
                    <SelectItem value="auto_punch">🤖 Auto Clock-Out</SelectItem>
                    <SelectItem value="break_violation">🍽️ Break Violation</SelectItem>
                    <SelectItem value="open_shift">🔓 Open Shift</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {tipsLoading && (
              <Card className="border-muted">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                    <div>
                      <p className="text-sm text-muted-foreground">Loading tips data...</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {!tipsLoading && dailyTips.length > 0 && (
              <DailyTipsStrip dailyTips={dailyTips} totalTipPool={totalTipPool} timezone={timezone} />
            )}


            {/* Approval Controls - only show when period is open */}
            {!isPeriodClosed && (() => {
              const totalShifts = timeCards.reduce((sum, card) => sum + Object.keys(card.punchesByDay).length, 0);
              const approvedShifts = totalShifts - totalPunchesAwaitingApproval;
              
              return (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="include-approved"
                      checked={!includeApproved}
                      onCheckedChange={(checked) => setIncludeApproved(!checked as boolean)}
                      className="h-4 w-4"
                    />
                    <label htmlFor="include-approved" className="text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
                      Hide approved
                    </label>
                  </div>
                  <Button 
                    size="sm" 
                    onClick={handleApproveAll} 
                    disabled={filteredPunchesAwaitingApproval === 0}
                    className="font-semibold"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {approvedShifts}/{totalShifts} Approve All
                  </Button>
                </div>
              );
            })()}

            {isPeriodClosed ? (
              /* Payroll Summary */
              <Card>
                {calculatePayrollSummary().wageMissingNames.length > 0 && (
                  <div role="alert" className="m-4 mb-0 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      Wage missing for: {calculatePayrollSummary().wageMissingNames.join(', ')}. Their gross wages show $0 — your payroll provider has the real rates.
                    </span>
                  </div>
                )}
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Payroll Summary</CardTitle>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Export
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={exportToCSV}>
                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                        Export to CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportToPDF}>
                        <Download className="h-4 w-4 mr-2" />
                        Export to PDF
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Reg</TableHead>
                        <TableHead className="text-right">OT</TableHead>
                        <TableHead className="text-right">DT</TableHead>
                        <TableHead className="text-right">PTO</TableHead>
                        <TableHead className="text-right">Tips</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calculatePayrollSummary().employees.map((emp, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{emp.name}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {emp.wageMissing ? <span className="text-destructive">wage missing</span> : `$${emp.wage.toFixed(2)}`}
                          </TableCell>
                          <TableCell className="text-right">{emp.regularHours.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{emp.overtimeHours.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{emp.doubleOvertimeHours.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{emp.ptoHours.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-green-600">{emp.tips > 0 ? `$${emp.tips.toFixed(2)}` : '-'}</TableCell>
                          <TableCell className="text-right font-semibold">${emp.grossWages.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold bg-muted/50">
                        <TableCell>TOTALS</TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.regularHours.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.overtimeHours.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.doubleOvertimeHours.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.ptoHours.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-green-600">{calculatePayrollSummary().totals.tips > 0 ? `$${calculatePayrollSummary().totals.tips.toFixed(2)}` : '-'}</TableCell>
                        <TableCell className="text-right text-lg">${calculatePayrollSummary().totals.grossWages.toFixed(2)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  
                  {/* Tip Distribution Explanation */}
                  {totalTipPool > 0 && (
                    <div className="mt-4 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                      <p className="font-medium text-foreground mb-1">Tip Distribution</p>
                      <p>Tips are pooled daily and distributed based on hours worked. Each employee receives a share proportional to their hours relative to total hours worked that day.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                 {/* Desktop Table View - lg and up */}
                 <div className="hidden lg:block">
                   {viewMode === 'employee' ? (
                     <DesktopTimeTrackingTable
                       filteredCards={filteredCards}
                       timezone={timezone}
                       includeApproved={includeApproved}
                       onApproveDay={handleApproveDay}
                       onUnapproveDay={handleUnapproveDay}
                       onEditShift={setEditingShift}
                       calculateDayHours={calculateDayHours}
                       hasDayIssues={hasDayIssues}
                       sortPunches={sortPunches}
                       groupPunchesByWeek={groupPunchesByWeek}
                       currentLocationId={currentLocation?.id || ''}
                       approvingPunchIds={approvingPunchIds}
                       getDayFlags={getDayFlags}
                     />
                   ) : (
                     <DayByDayView
                       filteredCards={filteredCards}
                       timezone={timezone}
                       includeApproved={includeApproved}
                       onApproveDay={handleApproveDay}
                       onUnapproveDay={handleUnapproveDay}
                       onEditShift={setEditingShift}
                       calculateDayHours={calculateDayHours}
                       sortPunches={sortPunches}
                       currentLocationId={currentLocation?.id || ''}
                       approvingPunchIds={approvingPunchIds}
                       periodDates={periodDates}
                       getDayFlags={getDayFlags}
                     />
                   )}
                 </div>

                 {/* Mobile/Tablet Cards View - below lg */}
                 <div className="block lg:hidden">
                   {viewMode === 'employee' ? (
                     <MobileTimeTrackingCard
                       filteredCards={filteredCards}
                       timezone={timezone}
                       includeApproved={includeApproved}
                       onApproveDay={handleApproveDay}
                       onUnapproveDay={handleUnapproveDay}
                       onEditShift={setEditingShift}
                       calculateDayHours={calculateDayHours}
                       hasDayIssues={hasDayIssues}
                       sortPunches={sortPunches}
                       groupPunchesByWeek={groupPunchesByWeek}
                       currentLocationId={currentLocation?.id || ''}
                       approvingPunchIds={approvingPunchIds}
                       getDayFlags={getDayFlags}
                     />
                   ) : (
                     <MobileDayByDayCard
                       filteredCards={filteredCards}
                       timezone={timezone}
                       includeApproved={includeApproved}
                       onApproveDay={handleApproveDay}
                       onUnapproveDay={handleUnapproveDay}
                       onEditShift={setEditingShift}
                       calculateDayHours={calculateDayHours}
                       sortPunches={sortPunches}
                       currentLocationId={currentLocation?.id || ''}
                       approvingPunchIds={approvingPunchIds}
                       getDayFlags={getDayFlags}
                     />
                   )}
                 </div>
              </>
            )}
          </div>
        )}

        <QuickPunchDialog
          open={showQuickEntry}
          onOpenChange={setShowQuickEntry}
          onSuccess={fetchTimeCards}
        />

        <Dialog open={!!editingShift} onOpenChange={() => setEditingShift(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Shift</DialogTitle>
            </DialogHeader>
            {editingShift && (
              <EditShiftForm
                dayPunches={editingShift.dayPunches}
                userId={editingShift.userId}
                locationId={editingShift.locationId}
                shiftDate={editingShift.shiftDate}
                timezone={timezone}
                onSave={() => { setEditingShift(null); fetchTimeCards(); }}
                onCancel={() => setEditingShift(null)}
                onDelete={() => {
                  setDeleteConfirmation({ 
                    dayPunches: editingShift.dayPunches, 
                    shiftDate: editingShift.shiftDate 
                  });
                }}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Approval Warning Dialog */}
        <Dialog open={!!approvalWarning} onOpenChange={() => setApprovalWarning(null)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
                {approvalWarning?.type === 'all' ? 'Flagged Shifts Require Review' : 'Review Flagged Punches'}
              </DialogTitle>
              <DialogDescription>
                {approvalWarning?.type === 'all' 
                  ? 'The following shifts have flags and must be reviewed individually before approval.'
                  : 'The following issues were found with these punches. Please review before approving.'
                }
              </DialogDescription>
            </DialogHeader>
            {approvalWarning && (
              <div className="space-y-3">
                {/* Flag type summary */}
                <div className="space-y-2">
                  {approvalWarning.hasAutoClockOut && (
                    <div className="flex items-center gap-2 p-2 bg-orange-50 rounded border border-orange-200 text-sm">
                      <AlertCircle className="h-4 w-4 text-orange-600 shrink-0" />
                      <span className="text-orange-800">Auto Clock-Out</span>
                    </div>
                  )}
                  {approvalWarning.hasBreakViolation && (
                    <div className="flex items-center gap-2 p-2 bg-amber-50 rounded border border-amber-200 text-sm">
                      <Coffee className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="text-amber-800">Missing Meal Break</span>
                    </div>
                  )}
                  {approvalWarning.hasOvertime && (
                    <div className="flex items-center gap-2 p-2 bg-purple-50 rounded border border-purple-200 text-sm">
                      <Clock className="h-4 w-4 text-purple-600 shrink-0" />
                      <span className="text-purple-800">Overtime</span>
                    </div>
                  )}
                  {approvalWarning.hasExtendedBreak && (
                    <div className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-200 text-sm">
                      <Coffee className="h-4 w-4 text-blue-600 shrink-0" />
                      <span className="text-blue-800">Extended Break</span>
                    </div>
                  )}
                </div>

                {/* List of flagged shifts for Approve All */}
                {approvalWarning.type === 'all' && approvalWarning.flaggedShifts && (
                  <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                    {approvalWarning.flaggedShifts.map((shift, idx) => {
                      const shiftDate = parseDateStringInTimezone(shift.date, timezone);
                      return (
                        <div key={idx} className="px-3 py-2 flex items-center justify-between text-sm">
                          <div>
                            <span className="font-medium">{shift.employeeName}</span>
                            <span className="text-muted-foreground ml-2">
                              {formatDateTimeInTimezone(shiftDate, timezone, { weekday: 'short', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <div className="flex gap-1">
                            {shift.flags.map((flag, fIdx) => (
                              <Badge key={fIdx} variant="outline" className="text-[10px] px-1 py-0">
                                {flag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Show count of clean shifts that will be approved */}
                {approvalWarning.type === 'all' && approvalWarning.cleanPunchIds && approvalWarning.cleanPunchIds.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {approvalWarning.cleanPunchIds.length} clean punch records will be approved.
                  </p>
                )}
              </div>
            )}
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={() => setApprovalWarning(null)}>
                {approvalWarning?.type === 'all' ? 'Cancel' : 'Close'}
              </Button>
              {/* For single day approval, allow approve anyway */}
              {approvalWarning?.type === 'day' && approvalWarning?.shiftInfo && (
                <>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setEditingShift(approvalWarning.shiftInfo!);
                      setApprovalWarning(null);
                    }}
                  >
                    Fix Issues
                  </Button>
                  <Button 
                    variant="default"
                    onClick={() => approvalWarning && approvePunches(approvalWarning.punches.map((p: any) => p.id))}
                  >
                    Approve Anyway
                  </Button>
                </>
              )}
              {/* For Approve All, only approve clean shifts */}
              {approvalWarning?.type === 'all' && approvalWarning.cleanPunchIds && approvalWarning.cleanPunchIds.length > 0 && (
                <Button 
                  variant="default"
                  onClick={async () => {
                    await approvePunches(approvalWarning.cleanPunchIds!);
                    toast.success(`Approved ${approvalWarning.cleanPunchIds!.length} clean punches. ${approvalWarning.flaggedShifts?.length || 0} flagged shifts require manual review.`);
                  }}
                >
                  Approve Clean Shifts Only
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Shift Confirmation Dialog */}
        <Dialog open={!!deleteConfirmation} onOpenChange={() => setDeleteConfirmation(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="h-5 w-5" />
                Delete Shift
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this entire shift? This will remove all clock-in, clock-out, and break records for this day. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {deleteConfirmation && (
              <div className="py-2">
                <p className="text-sm text-muted-foreground">
                  Date: <span className="font-medium text-foreground">
                    {formatDateTimeInTimezone(parseDateStringInTimezone(deleteConfirmation.shiftDate, timezone), timezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Records to delete: <span className="font-medium text-foreground">{deleteConfirmation.dayPunches.length}</span>
                </p>
              </div>
            )}
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={() => setDeleteConfirmation(null)}>
                Cancel
              </Button>
              <Button 
                variant="destructive"
                onClick={() => deleteConfirmation && handleDeleteAllDayPunches(deleteConfirmation.dayPunches)}
              >
                Delete Shift
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
