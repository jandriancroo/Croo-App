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
            <div>
              <h1 className="text-3xl font-bold">Time Tracking</h1>
              <p className="text-muted-foreground">Select a pay period to review time cards</p>
            </div>
            <div className="space-y-3">
              {payPeriods.map((period, index) => {
                const status = getPeriodStatus(period);
                const isClosed = status?.status === 'closed';
                const periodLabel = index === 0 ? 'This Period' : index === 1 ? 'Last Period' : null;
                const summary = periodSummaries?.[`${period.startDate}_${period.endDate}`];
                const summaryStats = [
                  { label: 'Sales', value: summary ? summary.sales.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—' },
                  { label: 'Hours', value: summary ? summary.hours.toFixed(1) : '—' },
                  { label: 'Labor', value: summary ? summary.cost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—' },
                  { label: 'Labor %', value: summary?.laborPercent != null ? `${summary.laborPercent.toFixed(1)}%` : '—' },
                ];
                
                return (
                  <Card
                    key={index}
                    className="cursor-pointer transition-shadow hover:shadow-lg"
                    onClick={() => setSelectedPeriod(period)}
                  >
                    <CardHeader className="p-4 sm:p-5">
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                        <div className="min-w-0 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {periodLabel && (
                              <Badge 
                                variant={index === 0 ? "default" : "secondary"}
                                className="text-xs"
                              >
                                {periodLabel}
                              </Badge>
                            )}
                            {isClosed ? (
                              <Badge variant="outline" className="bg-muted">
                                <Lock className="mr-1 h-3 w-3" />
                                Closed
                              </Badge>
                            ) : (
                              <Badge variant="default">
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                Open
                              </Badge>
                            )}
                          </div>
                          <CardTitle className="max-w-3xl text-xl leading-snug break-words whitespace-normal sm:text-2xl lg:text-3xl">
                            {period.label}
                          </CardTitle>
                        </div>
                        <div className="grid grid-cols-4 overflow-hidden rounded-full border bg-muted/35 sm:min-w-[520px]">
                          {summaryStats.map((stat) => (
                            <div key={stat.label} className="border-r px-2 py-2 text-center last:border-r-0 sm:px-4">
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">{stat.label}</div>
                              <div className="mt-0.5 text-base font-bold leading-tight sm:text-lg">{stat.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
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
                    <Button variant="outline" onClick={handleClosePeriod}>
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
              <DailyTipsStrip dailyTips={dailyTips} totalTipPool={totalTipPool} />
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
                        <TableHead className="text-right">PTO</TableHead>
                        <TableHead className="text-right">Tips</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calculatePayrollSummary().employees.map((emp, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{emp.name}</TableCell>
                          <TableCell className="text-right text-muted-foreground">${emp.wage.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{emp.regularHours.toFixed(1)}</TableCell>
                          <TableCell className="text-right">{emp.overtimeHours.toFixed(1)}</TableCell>
                          <TableCell className="text-right">{emp.ptoHours.toFixed(1)}</TableCell>
                          <TableCell className="text-right text-green-600">{emp.tips > 0 ? `$${emp.tips.toFixed(2)}` : '-'}</TableCell>
                          <TableCell className="text-right font-semibold">${emp.grossWages.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold bg-muted/50">
                        <TableCell>TOTALS</TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.regularHours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.overtimeHours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.ptoHours.toFixed(1)}</TableCell>
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
