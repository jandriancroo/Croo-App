import { Layout } from "@/components/Layout";
import { PageTitle } from "@/components/PageTitle";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, Plus, List, CalendarDays } from "lucide-react";
import { useState } from "react";
import { RequestAvailabilityDialog } from "@/components/availability/RequestAvailabilityDialog";
import { ShiftPoolSection } from "@/components/availability/ShiftPoolSection";
import { SchedulingPreferencesSection } from "@/components/availability/SchedulingPreferencesSection";
import { AvailabilityRequestCard } from "@/components/availability/AvailabilityRequestCard";
import { AvailabilityDialogs } from "@/components/availability/AvailabilityDialogs";
import { AvailabilityCalendarView, expandDates } from "@/components/availability/AvailabilityCalendarView";
import { useAvailabilityData } from "@/hooks/useAvailabilityData";

export default function Availability() {
  const data = useAvailabilityData();
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const dayRequests = selectedDate
    ? data.requests.filter((r) => expandDates(r).includes(selectedDate))
    : [];

  if (data.roleLoading || data.loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading availability...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <PageTitle color="indigo">Availability</PageTitle>
            </div>
            <Button onClick={() => data.setRequestDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Request Time Off
            </Button>
          </div>
        </div>

        {!data.canApproveRequests && data.canViewSickTime && (
          <Card className="p-6 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Paid Time Off Balance</p>
                <p className="text-3xl font-bold">{data.myPtoBalance} hours</p>
              </div>
            </div>
          </Card>
        )}

        {/* Shift Pool - Manager Only */}
        {data.canApproveRequests && <ShiftPoolSection />}

        {/* View toggle + Filters + Content */}
        <Card className="p-4 md:p-6">
          {/* View mode tabs */}
          <div className="inline-flex rounded-lg border p-1 bg-muted/40 mb-4">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === "list"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-4 w-4" />
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === "calendar"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays className="h-4 w-4" />
              Calendar
            </button>
          </div>

          {viewMode === "list" ? (
            <>
              <div className="flex flex-wrap gap-4 items-center mb-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="hide-past-main"
                    checked={data.hidePastRequests}
                    onCheckedChange={(checked) => data.setHidePastRequests(checked === true)}
                  />
                  <label htmlFor="hide-past-main" className="text-sm cursor-pointer text-muted-foreground whitespace-nowrap">
                    Hide past
                  </label>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <Select value={data.filterStatus} onValueChange={data.setFilterStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="denied">Denied</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <Select value={data.filterType} onValueChange={data.setFilterType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Filter by type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="h-px bg-border mb-4" />

              <h2 className="text-lg font-semibold mb-4">
                {data.canApproveRequests ? "All Requests" : "My Requests"} ({data.filteredRequests.length})
              </h2>

              {data.filteredRequests.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No requests found</p>
              ) : (
                <div className="space-y-6">
                  {data.sortedWeekKeys.map((weekKey) => {
                    const weekRequests = data.groupedByWeek[weekKey];
                    const weekLabel = data.getWeekLabel(weekKey);

                    return (
                      <div key={weekKey}>
                        <div className="flex items-center gap-3 mb-3">
                          <div className="text-sm font-semibold text-foreground">{weekLabel}</div>
                          <div className="flex-1 h-px bg-border" />
                          <div className="text-xs text-muted-foreground">
                            {weekRequests.length} request{weekRequests.length !== 1 ? "s" : ""}
                          </div>
                        </div>
                        <div className="space-y-3">
                          {weekRequests.map((request) => (
                            <AvailabilityRequestCard
                              key={request.id}
                              request={request}
                              canApproveRequests={data.canApproveRequests}
                              userId={data.user?.id}
                              formatTimeScope={data.formatTimeScope}
                              formatDayOfWeek={data.formatDayOfWeek}
                              formatRequestedDate={data.formatRequestedDate}
                              onSetStatus={(id, status) => {
                                data.setSelectedRequest(id);
                                data.setEditStatus(status);
                              }}
                              onEdit={data.openEditDialog}
                              onEmployeeEdit={data.openEmployeeEditDialog}
                              onDelete={data.openDeleteDialog}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <AvailabilityCalendarView
                requests={data.requests}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
              {selectedDate && (
                <div className="mt-6 pt-6 border-t">
                  <h3 className="text-sm font-semibold mb-3">
                    Requests for {new Date(`${selectedDate}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} ({dayRequests.length})
                  </h3>
                  {dayRequests.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-6">No requests for this day</p>
                  ) : (
                    <div className="space-y-3">
                      {dayRequests.map((request) => (
                        <AvailabilityRequestCard
                          key={request.id}
                          request={request}
                          canApproveRequests={data.canApproveRequests}
                          userId={data.user?.id}
                          formatTimeScope={data.formatTimeScope}
                          formatDayOfWeek={data.formatDayOfWeek}
                          formatRequestedDate={data.formatRequestedDate}
                          onSetStatus={(id, status) => {
                            data.setSelectedRequest(id);
                            data.setEditStatus(status);
                          }}
                          onEdit={data.openEditDialog}
                          onEmployeeEdit={data.openEmployeeEditDialog}
                          onDelete={data.openDeleteDialog}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Card>

        {/* Scheduling Preferences - Manager Only */}
        {data.canApproveRequests && <SchedulingPreferencesSection />}

        <AvailabilityDialogs
          processing={data.processing}
          denyDialogOpen={data.denyDialogOpen}
          setDenyDialogOpen={data.setDenyDialogOpen}
          denialReason={data.denialReason}
          setDenialReason={data.setDenialReason}
          handleDeny={data.handleDeny}
          editDialogOpen={data.editDialogOpen}
          setEditDialogOpen={data.setEditDialogOpen}
          editRequestType={data.editRequestType}
          setEditRequestType={data.setEditRequestType}
          editTimeScope={data.editTimeScope}
          setEditTimeScope={data.setEditTimeScope}
          editStartDate={data.editStartDate}
          setEditStartDate={data.setEditStartDate}
          editEndDate={data.editEndDate}
          setEditEndDate={data.setEditEndDate}
          editStartTime={data.editStartTime}
          setEditStartTime={data.setEditStartTime}
          editEndTime={data.editEndTime}
          setEditEndTime={data.setEditEndTime}
          editHours={data.editHours}
          setEditHours={data.setEditHours}
          editStatus={data.editStatus}
          setEditStatus={data.setEditStatus}
          editNotes={data.editNotes}
          setEditNotes={data.setEditNotes}
          handleEditRequest={data.handleEditRequest}
          deleteDialogOpen={data.deleteDialogOpen}
          setDeleteDialogOpen={data.setDeleteDialogOpen}
          handleDeleteRequest={data.handleDeleteRequest}
          employeeEditDialogOpen={data.employeeEditDialogOpen}
          setEmployeeEditDialogOpen={data.setEmployeeEditDialogOpen}
          employeeEditNotes={data.employeeEditNotes}
          setEmployeeEditNotes={data.setEmployeeEditNotes}
          handleEmployeeEditRequest={data.handleEmployeeEditRequest}
        />

        <RequestAvailabilityDialog
          open={data.requestDialogOpen}
          onOpenChange={data.setRequestDialogOpen}
          onSuccess={data.fetchData}
        />
      </div>
    </Layout>
  );
}
