import { useState } from "react";
import { format } from "date-fns";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical, Trash2, Pencil, Paperclip } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getDisplayName } from "@/utils/displayName";
import { DrawerCountEntry, parseDrawerCountData } from "@/components/logbook/DrawerCountEntry";
import { SafeCountEntry, parseSafeCountData, checkBankRunCompleted } from "@/components/logbook/SafeCountEntry";
import { BankDepositEntry, parseBankDepositData } from "@/components/logbook/BankDepositEntry";
import { WeeklySummaryEntry, parseWeeklySummaryData } from "@/components/logbook/WeeklySummaryEntry";
import { EmployeeWriteUpEntry } from "@/components/logbook/EmployeeWriteUpEntry";
import { ReadAndSignEntry } from "@/components/logbook/ReadAndSignEntry";
import { PerformanceReviewEntry } from "@/components/logbook/PerformanceReviewEntry";

import type { useLogBookData } from "@/hooks/useLogBookData";

type LogBookData = ReturnType<typeof useLogBookData>;

interface LogBookEntryListProps {
  data: LogBookData;
}

export function LogBookEntryList({ data }: LogBookEntryListProps) {
  const {
    sortedDays, entriesByDay, locationSettings,
    checkPreviousNightNeededBankRun, setDeleteEntryId,
    setSelectedCategory, setSelectedDate, setFormData,
    setShowNewEntrySheet, setWizardStep,
    followupMutation, isAdmin, toast,
    queryClient,
  } = data;

  if (sortedDays.length === 0) {
    return <p className="text-center text-muted-foreground py-8">No entries found</p>;
  }

  return (
    <>
      {sortedDays.map((day: string) => (
        <div key={day} className="space-y-3">
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {format(new Date(day + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
            </h3>
          </div>

          {entriesByDay[day].map((entry: any) => {
            const isSpecialEntry = entry.logbook_categories?.name?.toLowerCase() === 'drawer count'
              || entry.logbook_categories?.name?.toLowerCase() === 'safe count'
              || entry.logbook_categories?.name?.toLowerCase() === 'weekly summary'
              || entry.logbook_categories?.name?.toLowerCase() === 'bank deposit'
              || entry._isReadAndSign
              || entry._isPerformanceReview;

            return (
              <Card key={entry._virtualId || entry.id}>
                <CardContent className="pt-4 pb-3">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          {entry.profiles?.profile_photo_url && <AvatarImage src={entry.profiles.profile_photo_url} />}
                          <AvatarFallback>{getDisplayName(entry.profiles?.full_name, entry.profiles?.nickname)?.split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium leading-tight">{getDisplayName(entry.profiles?.full_name, entry.profiles?.nickname) || 'Unknown'}</p>
                          <p className="text-xs text-muted-foreground">
                            {entry.logbook_categories?.name} • {format(new Date(entry.created_at), 'h:mm a')}
                          </p>
                        </div>
                      </div>

                      {/* Actions dropdown */}
                      {(() => {
                        if (entry._isReadAndSign) {
                          return isAdmin ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon-sm" variant="ghost" className=""><MoreVertical className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={async () => {
                                  try {
                                    const { error } = await supabase.from('read_and_sign_documents').update({ is_active: false }).eq('id', entry._readAndSignData.id);
                                    if (error) throw error;
                                    toast({ title: "Document archived" });
                                    queryClient.invalidateQueries({ queryKey: ['read-and-sign-docs'] });
                                  } catch (error: any) { toast({ title: "Error archiving", description: error.message, variant: "destructive" }); }
                                }} className="text-destructive focus:text-destructive">
                                  <Trash2 className="h-4 w-4 mr-2" />Archive
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null;
                        }

                        if (entry._isPerformanceReview) {
                          return isAdmin ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon-sm" variant="ghost" className=""><MoreVertical className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={async () => {
                                  try {
                                    if (entry._performanceReviewData?.task_id) {
                                      await supabase.from('temporary_tasks').delete().eq('id', entry._performanceReviewData.task_id);
                                    }
                                    await supabase.from('performance_review_ratings').delete().eq('review_id', entry._performanceReviewData.id);
                                    const { error } = await supabase.from('performance_reviews').delete().eq('id', entry._performanceReviewData.id);
                                    if (error) throw error;
                                    toast({ title: "Review deleted" });
                                    queryClient.invalidateQueries({ queryKey: ['performance-reviews'] });
                                  } catch (error: any) { toast({ title: "Error deleting review", description: error.message, variant: "destructive" }); }
                                }} className="text-destructive focus:text-destructive">
                                  <Trash2 className="h-4 w-4 mr-2" />Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null;
                        }

                        if (entry._isWriteUp) {
                          return isAdmin ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon-sm" variant="ghost" className=""><MoreVertical className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={async () => {
                                  try {
                                    const { data: writeUp } = await supabase.from('employee_writeups').select('task_id').eq('id', entry._writeUpData.id).single();
                                    if (writeUp?.task_id) { await supabase.from('temporary_tasks').delete().eq('id', writeUp.task_id); }
                                    const { error } = await supabase.from('employee_writeups').delete().eq('id', entry._writeUpData.id);
                                    if (error) throw error;
                                    toast({ title: "Corrective action deleted" });
                                    queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
                                    queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
                                  } catch (error: any) { toast({ title: "Error deleting corrective action", description: error.message, variant: "destructive" }); }
                                }} className="text-destructive focus:text-destructive">
                                  <Trash2 className="h-4 w-4 mr-2" />Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null;
                        }

                        return (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon-sm" variant="ghost" className=""><MoreVertical className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {!isSpecialEntry && (
                                <DropdownMenuItem onClick={() => {
                                  setSelectedCategory(entry.category_id);
                                  setSelectedDate(new Date(entry.entry_date + 'T12:00:00'));
                                  const existingData: Record<string, any> = {};
                                  entry.logbook_entry_values?.forEach((val: any) => {
                                    existingData[val.field_id] = val.value_text || val.value_number || val.value_date || val.attachment_url;
                                  });
                                  setFormData(existingData);
                                  setShowNewEntrySheet(true);
                                  setWizardStep('form');
                                  toast({ title: "Edit mode", description: "Update the entry and save" });
                                }}>
                                  <Pencil className="h-4 w-4 mr-2" />Edit
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => setDeleteEntryId(entry.id)} className="text-destructive focus:text-destructive">
                                <Trash2 className="h-4 w-4 mr-2" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        );
                      })()}
                    </div>

                    <EntryBody data={data} entry={entry} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** Full body of an entry (values, special entry types, follow-up buttons). Shared by the list card and the Duo inspector. */
export function EntryBody({ data, entry, mode = 'card' }: { data: LogBookData; entry: any; mode?: 'card' | 'inline' | 'tags' }) {
  const tags = mode === 'tags';
  const { locationSettings, checkPreviousNightNeededBankRun, followupMutation } = data;
  return (
    <>
                    <div className="mt-2 space-y-1">
                      {!tags && entry._isWriteUp && entry._writeUpData && <EmployeeWriteUpEntry writeUp={entry._writeUpData} />}

                      {!tags && entry._isReadAndSign && entry._readAndSignData && (
                        <ReadAndSignEntry
                          documentId={entry._readAndSignData.id}
                          title={entry._readAndSignData.title}
                          createdAt={entry._readAndSignData.created_at}
                          createdByName={entry._readAndSignData.created_by_profile?.full_name}
                          revisionNumber={entry._readAndSignData.revision_number || 0}
                          revisedAt={entry._readAndSignData.revised_at}
                        />
                      )}

                      {!tags && entry._isPerformanceReview && entry._performanceReviewData && (
                        <PerformanceReviewEntry
                          reviewId={entry._performanceReviewData.id}
                          employeeName={entry._performanceReviewData.employee?.full_name || 'Unknown'}
                          employeePhoto={entry._performanceReviewData.employee?.profile_photo_url}
                          createdAt={entry._performanceReviewData.created_at}
                          createdByName={entry._performanceReviewData.created_by_profile?.full_name}
                          isSigned={!!entry._performanceReviewData.signed_at}
                          signedAt={entry._performanceReviewData.signed_at}
                        />
                      )}

                      {!entry._isWriteUp && !entry._isReadAndSign && !entry._isPerformanceReview && entry.logbook_entry_values?.map((val: any) => {
                        const bankDepositData = val.value_text ? parseBankDepositData(val.value_text) : null;
                        if (bankDepositData) return <BankDepositEntry mode={mode} key={val.id} data={bankDepositData} createdAt={entry.created_at} />;

                        const drawerData = val.value_text ? parseDrawerCountData(val.value_text) : null;
                        if (drawerData && drawerData.actualDeposit !== undefined) return <DrawerCountEntry mode={mode} key={val.id} data={drawerData} createdAt={entry.created_at} drawerBank={locationSettings?.drawer_bank || 200} createdByName={getDisplayName(entry.profiles?.full_name, entry.profiles?.nickname)} />;

                        const safeData = val.value_text ? parseSafeCountData(val.value_text) : null;
                        if (safeData) {
                          const bankRunCompleted = safeData.shift === 'AM' && checkPreviousNightNeededBankRun(entry.entry_date) && checkBankRunCompleted(safeData);
                          return <SafeCountEntry mode={mode} key={val.id} data={safeData} createdAt={entry.created_at} bankRunCompleted={bankRunCompleted} safeTarget={locationSettings?.safe_target ?? 300} />;
                        }

                        const summaryData = val.value_text ? parseWeeklySummaryData(val.value_text) : null;
                        if (summaryData) return <WeeklySummaryEntry mode={mode} key={val.id} data={summaryData} createdAt={entry.created_at} />;

                        if (tags) return null;
                        return (
                          <div key={val.id} className="text-sm">
                            {val.value_text || val.value_number || val.value_date ||
                              (val.attachment_url && (
                                <a href={val.attachment_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                                  <Paperclip className="h-3 w-3" />View attachment
                                </a>
                              ))}
                          </div>
                        );
                      })}
                    </div>

                    {!tags && entry.logbook_categories?.name === 'Guest Remakes' && (
                      <div className="mt-3 pt-3 border-t border-border">
                        {entry.followup_completed_at ? (
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" className="bg-green-500/20 text-green-600 border-green-500/30 hover:bg-green-500/30 cursor-default" disabled>✓ Re-Make Completed</Button>
                            <span className="text-xs text-muted-foreground">{format(new Date(entry.followup_completed_at), 'MMM d, h:mm a')}</span>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10" onClick={() => followupMutation.mutate(entry.id)} disabled={followupMutation.isPending}>Pending Remake</Button>
                        )}
                      </div>
                    )}

                    {!tags && entry.logbook_categories?.name === 'Online Refunds' && (
                      <div className="mt-3 pt-3 border-t border-border">
                        {entry.followup_completed_at ? (
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" className="bg-green-500/20 text-green-600 border-green-500/30 hover:bg-green-500/30 cursor-default" disabled>✓ Refund Completed</Button>
                            <span className="text-xs text-muted-foreground">{format(new Date(entry.followup_completed_at), 'MMM d, h:mm a')}</span>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10" onClick={() => followupMutation.mutate(entry.id)} disabled={followupMutation.isPending}>Pending Refund</Button>
                        )}
                      </div>
                    )}
    </>
  );
}

export const isSpecialLogEntry = (entry: any) => {
  const n = entry.logbook_categories?.name?.toLowerCase();
  return n === 'drawer count' || n === 'safe count' || n === 'weekly summary' || n === 'bank deposit' || !!entry._isReadAndSign || !!entry._isPerformanceReview;
};

/** Edit flow shared with the list dropdown. */
export function startLogEdit(data: LogBookData, entry: any) {
  const { setSelectedCategory, setSelectedDate, setFormData, setShowNewEntrySheet, setWizardStep, toast } = data;
  setSelectedCategory(entry.category_id);
  setSelectedDate(new Date(entry.entry_date + 'T12:00:00'));
  const existingData: Record<string, any> = {};
  entry.logbook_entry_values?.forEach((val: any) => {
    existingData[val.field_id] = val.value_text || val.value_number || val.value_date || val.attachment_url;
  });
  setFormData(existingData);
  setShowNewEntrySheet(true);
  setWizardStep('form');
  toast({ title: "Edit mode", description: "Update the entry and save" });
}

const initials = (entry: any) => getDisplayName(entry.profiles?.full_name, entry.profiles?.nickname)?.split(/\s+/).map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '?';

const previewOf = (entry: any): string => {
  if (entry._isWriteUp) return 'Corrective action';
  if (entry._isReadAndSign) return entry._readAndSignData?.title || 'Read & Sign';
  if (entry._isPerformanceReview) return entry._performanceReviewData?.employee?.full_name || 'Performance review';
  const v = entry.logbook_entry_values?.find((x: any) => x.value_text && !String(x.value_text).trim().startsWith('{'));
  return v ? String(v.value_text).replace(/\s+/g, ' ') : '';
};

export const entryKey = (entry: any) => entry._virtualId || entry.id;

/** Duo list: one compact row per entry, grouped by day. Tapping selects it for the inspector. */
export function DuoLogRows({ data, selectedKey, onSelect }: { data: LogBookData; selectedKey: string | null; onSelect: (entry: any) => void }) {
  const { sortedDays, entriesByDay } = data;
  if (sortedDays.length === 0) return <p className="text-center text-muted-foreground py-8">No entries found</p>;
  return (
    <div className="duo-log-rows">
      {sortedDays.map((day: string) => (
        <section key={day}>
          <h3 className="duo-log-day">{format(new Date(day + 'T12:00:00'), 'EEEE, MMM d')}</h3>
          {entriesByDay[day].map((entry: any) => (
            <button key={entryKey(entry)} type="button" onClick={() => onSelect(entry)} className={`duo-log-row${selectedKey === entryKey(entry) ? ' duo-row-sel' : ''}`}>
              <Avatar className="h-8 w-8 shrink-0">
                {entry.profiles?.profile_photo_url && <AvatarImage src={entry.profiles.profile_photo_url} />}
                <AvatarFallback>{initials(entry)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="duo-log-top"><b>{getDisplayName(entry.profiles?.full_name, entry.profiles?.nickname) || 'Unknown'}</b><small>{format(new Date(entry.created_at), 'h:mm a')}</small></span>
                <span className="duo-log-cat">{entry.logbook_categories?.name || (entry._isWriteUp ? 'Corrective Action' : entry._isReadAndSign ? 'Read & Sign' : entry._isPerformanceReview ? 'Performance Review' : '')}</span>
                <span className="duo-log-tags"><EntryBody data={data} entry={entry} mode="tags" /></span>
                {previewOf(entry) && <span className="duo-log-prev">{previewOf(entry)}</span>}
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Duo inspector: the full entry plus Edit and Delete (delete lives here). */
export function LogEntryInspector({ data, entry, onEdit, onDone }: { data: LogBookData; entry: any; onEdit: () => void; onDone: () => void }) {
  const { isAdmin, toast, queryClient, deleteEntryMutation } = data;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  type Rm = { label: string; run: () => Promise<void> | void };
  let rm: Rm | null = null;
  if (entry._isReadAndSign) {
    if (isAdmin) rm = { label: 'Archive', run: async () => {
      const { error } = await supabase.from('read_and_sign_documents').update({ is_active: false }).eq('id', entry._readAndSignData.id);
      if (error) throw error;
      toast({ title: "Document archived" });
      queryClient.invalidateQueries({ queryKey: ['read-and-sign-docs'] });
    } };
  } else if (entry._isPerformanceReview) {
    if (isAdmin) rm = { label: 'Delete', run: async () => {
      if (entry._performanceReviewData?.task_id) await supabase.from('temporary_tasks').delete().eq('id', entry._performanceReviewData.task_id);
      await supabase.from('performance_review_ratings').delete().eq('review_id', entry._performanceReviewData.id);
      const { error } = await supabase.from('performance_reviews').delete().eq('id', entry._performanceReviewData.id);
      if (error) throw error;
      toast({ title: "Review deleted" });
      queryClient.invalidateQueries({ queryKey: ['performance-reviews'] });
    } };
  } else if (entry._isWriteUp) {
    if (isAdmin) rm = { label: 'Delete', run: async () => {
      const { data: writeUp } = await supabase.from('employee_writeups').select('task_id').eq('id', entry._writeUpData.id).single();
      if (writeUp?.task_id) await supabase.from('temporary_tasks').delete().eq('id', writeUp.task_id);
      const { error } = await supabase.from('employee_writeups').delete().eq('id', entry._writeUpData.id);
      if (error) throw error;
      toast({ title: "Corrective action deleted" });
      queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
    } };
  } else {
    rm = { label: 'Delete', run: () => new Promise<void>((resolve, reject) => deleteEntryMutation.mutate(entry.id, { onSuccess: () => resolve(), onError: reject })) };
  }

  const canEdit = !entry._isWriteUp && !entry._isReadAndSign && !entry._isPerformanceReview && !isSpecialLogEntry(entry);
  const run = async () => {
    if (!rm) return;
    setBusy(true);
    try { await rm.run(); setConfirm(false); onDone(); }
    catch (error: any) { toast({ title: `Error: ${rm.label.toLowerCase()}`, description: error?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <div className="duo-log-insp space-y-4">
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          {entry.profiles?.profile_photo_url && <AvatarImage src={entry.profiles.profile_photo_url} />}
          <AvatarFallback>{initials(entry)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-base font-semibold leading-tight">{getDisplayName(entry.profiles?.full_name, entry.profiles?.nickname) || 'Unknown'}</p>
          <p className="text-sm text-muted-foreground">{entry.logbook_categories?.name} • {format(new Date(entry.created_at), 'EEE, MMM d • h:mm a')}</p>
        </div>
      </div>
      <div className="space-y-2"><EntryBody data={data} entry={entry} mode="inline" /></div>
      {(canEdit || rm) && (
        <div className="duo-log-actions flex items-center gap-2 pt-2">
          {canEdit && <Button variant="outline" onClick={onEdit}><Pencil className="h-4 w-4 mr-2" />Edit</Button>}
          {rm && <Button variant="outline" className="text-destructive border-destructive/40" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4 mr-2" />{rm.label}</Button>}
        </div>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="duo-popup">
          <AlertDialogHeader>
            <AlertDialogTitle>{rm?.label} entry</AlertDialogTitle>
            <AlertDialogDescription>{rm?.label === 'Archive' ? 'Archive this document?' : 'Are you sure you want to delete this log entry? This action cannot be undone.'}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); run(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{rm?.label}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
