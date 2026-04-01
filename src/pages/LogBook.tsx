import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Search, Settings, Plus } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ManageCategoriesDialog } from "@/components/logbook/ManageCategoriesDialog";
import { CateringOrdersSection } from "@/components/logbook/CateringOrdersSection";
import { LogBookNewEntrySheet } from "@/components/logbook/LogBookNewEntrySheet";
import { LogBookEntryList } from "@/components/logbook/LogBookEntryList";
import { useLogBookData } from "@/hooks/useLogBookData";

export default function LogBook() {
  const data = useLogBookData();

  const {
    activeTab, setActiveTab,
    searchQuery, setSearchQuery,
    searchDateFilter, setSearchDateFilter,
    manageCategoriesOpen, setManageCategoriesOpen,
    showCateringUpload, setShowCateringUpload,
    cateringSearchQuery, setCateringSearchQuery,
    deleteEntryId, setDeleteEntryId,
    deleteEntryMutation,
    isAdmin, isManager, isShiftManager, roleLoading,
  } = data;

  // Don't render if role is still loading or user doesn't have access
  if (roleLoading || (!isAdmin && !isManager && !isShiftManager)) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div className="mb-4">
          <h1 className="text-3xl font-bold">Logs</h1>
          <div className="flex items-center justify-between mt-3">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="search">Recent Logs</TabsTrigger>
                <TabsTrigger value="catering">Catering Orders</TabsTrigger>
              </TabsList>
            </Tabs>
            {isAdmin && (
              <Button
                size="icon"
                variant="outline"
                onClick={() => setManageCategoriesOpen(true)}
                title="Manage Categories"
              >
                <Settings className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Recent Logs Tab */}
        {activeTab === "search" && (
          <div className="space-y-4" style={{ marginTop: "1rem" }}>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search entries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="icon" variant={searchDateFilter ? "default" : "outline"} title="Filter by date">
                    <CalendarIcon className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={searchDateFilter}
                    onSelect={(date) => setSearchDateFilter(date || undefined)}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                  {searchDateFilter && (
                    <div className="p-2 border-t border-border">
                      <Button variant="ghost" size="sm" className="w-full" onClick={() => setSearchDateFilter(undefined)}>
                        Clear date filter
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
              <LogBookNewEntrySheet data={data} />
            </div>

            <div className="space-y-6">
              <LogBookEntryList data={data} />
            </div>
          </div>
        )}

        {/* Catering Orders Tab */}
        {activeTab === "catering" && (
          <div className="space-y-4" style={{ marginTop: "1rem" }}>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search orders..."
                value={cateringSearchQuery}
                onChange={(e) => setCateringSearchQuery(e.target.value)}
                className="flex-1"
              />
              <Button size="icon" variant="default" onClick={() => setShowCateringUpload(true)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <CateringOrdersSection
              showHeader={false}
              externalUploadOpen={showCateringUpload}
              onExternalUploadChange={setShowCateringUpload}
              searchQuery={cateringSearchQuery}
            />
          </div>
        )}

        {isAdmin && (
          <ManageCategoriesDialog
            open={manageCategoriesOpen}
            onOpenChange={setManageCategoriesOpen}
          />
        )}

        <AlertDialog open={!!deleteEntryId} onOpenChange={(open) => !open && setDeleteEntryId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Entry</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this log entry? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteEntryId && deleteEntryMutation.mutate(deleteEntryId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
}
