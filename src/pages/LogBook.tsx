import { useState, useRef, useEffect } from "react";
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
import { LibraryPanel } from "@/components/library/LibraryPanel";
import { PageTitle } from "@/components/PageTitle";

export default function LogBook() {
  const data = useLogBookData();

  const {
    activeTab, setActiveTab,
    searchQuery, setSearchQuery,
    searchDateFilter, setSearchDateFilter,
    searchCategoryName, setSearchCategoryName,
    manageCategoriesOpen, setManageCategoriesOpen,
    showCateringUpload, setShowCateringUpload,
    cateringSearchQuery, setCateringSearchQuery,
    deleteEntryId, setDeleteEntryId,
    deleteEntryMutation,
    isAdmin, isManager, isShiftManager, roleLoading,
    hasMoreRecentEntries, loadMoreRecentEntries, isFetchingRecentEntries,
    categories,
  } = data;

  const searchCategoryOptions: string[] = [
    ...((categories || []).map((c: any) => c.name).filter(Boolean)),
    'Catering Orders',
    'Corrective Action',
    'Read & Sign',
    ...((isAdmin || isManager) ? ['Performance Review'] : []),
  ];


  // Color palette for badges (deterministic by name hash)
  const badgePalette = [
    { bg: 'bg-blue-500/15', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-500/30', solid: 'bg-blue-500 text-white border-blue-500' },
    { bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-500/30', solid: 'bg-emerald-500 text-white border-emerald-500' },
    { bg: 'bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-500/30', solid: 'bg-amber-500 text-white border-amber-500' },
    { bg: 'bg-purple-500/15', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-500/30', solid: 'bg-purple-500 text-white border-purple-500' },
    { bg: 'bg-pink-500/15', text: 'text-pink-700 dark:text-pink-300', border: 'border-pink-500/30', solid: 'bg-pink-500 text-white border-pink-500' },
    { bg: 'bg-cyan-500/15', text: 'text-cyan-700 dark:text-cyan-300', border: 'border-cyan-500/30', solid: 'bg-cyan-500 text-white border-cyan-500' },
    { bg: 'bg-orange-500/15', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-500/30', solid: 'bg-orange-500 text-white border-orange-500' },
    { bg: 'bg-indigo-500/15', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-500/30', solid: 'bg-indigo-500 text-white border-indigo-500' },
    { bg: 'bg-rose-500/15', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-500/30', solid: 'bg-rose-500 text-white border-rose-500' },
    { bg: 'bg-teal-500/15', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-500/30', solid: 'bg-teal-500 text-white border-teal-500' },
  ];
  const colorFor = (name: string) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return badgePalette[h % badgePalette.length];
  };

  const [searchFocused, setSearchFocused] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!searchFocused) return;
    const onDown = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [searchFocused]);

  const hasLogAccess = isAdmin || isManager || isShiftManager;

  // While role loads
  if (roleLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </Layout>
    );
  }

  // Team members without log access: show Library only (if it's enabled).
  if (!hasLogAccess) {
    return (
      <Layout>
        <div className="space-y-4">
          <PageTitle color="purple">Library</PageTitle>
          <LibraryPanel />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div className="mb-4">
          <PageTitle
            color="purple"
            action={
              activeTab === "search" && isAdmin && (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setManageCategoriesOpen(true)}
                  title="Manage Categories"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              )
            }
          >
            {activeTab === "library" ? "Library" : "Logs"}
          </PageTitle>
          <div className="flex items-center justify-between mt-3">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="search">Recent Logs</TabsTrigger>
                <TabsTrigger value="library">Library</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Recent Logs Tab */}
        {activeTab === "search" && (
          <div className="space-y-4" style={{ marginTop: "1rem" }}>
            <div ref={searchWrapRef} className="relative">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <div className="relative flex-1">
                  <Input
                    placeholder={searchCategoryName ? "Refine within filter..." : "Search entries..."}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    className={searchCategoryName ? "pl-2" : ""}
                  />
                </div>
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

              {searchCategoryName && (() => {
                const c = colorFor(searchCategoryName);
                return (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Filter:</span>
                    <button
                      type="button"
                      onClick={() => setSearchCategoryName(null)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border ${c.solid}`}
                    >
                      {searchCategoryName}
                      <span aria-hidden className="ml-0.5 opacity-80">×</span>
                    </button>
                  </div>
                );
              })()}

              {searchFocused && !searchCategoryName && (
                <div className="absolute left-6 right-0 top-full z-30 mt-2 rounded-xl border border-border bg-popover shadow-lg p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Filter by log type</div>
                  <div className="flex flex-wrap gap-1.5">
                    {searchCategoryOptions.map((name: string) => {
                      const c = colorFor(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSearchCategoryName(name);
                            setSearchFocused(false);
                          }}
                          className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${c.bg} ${c.text} ${c.border} hover:opacity-80`}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              {searchCategoryName === 'Catering Orders' ? (
                <CateringOrdersSection
                  showHeader={false}
                  externalUploadOpen={showCateringUpload}
                  onExternalUploadChange={setShowCateringUpload}
                  searchQuery={searchQuery}
                />
              ) : (
                <>
                  <LogBookEntryList data={data} />
                  {hasMoreRecentEntries && !searchQuery && !searchDateFilter && (
                    <div className="flex justify-center py-2">
                      <Button
                        variant="outline"
                        onClick={loadMoreRecentEntries}
                        disabled={isFetchingRecentEntries}
                        className="w-full sm:w-auto"
                      >
                        {isFetchingRecentEntries ? "Loading..." : "Load more"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === "library" && (
          <div style={{ marginTop: "1rem" }}>
            <LibraryPanel />
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
