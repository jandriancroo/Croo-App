import { format, startOfWeek, endOfWeek, getDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CalendarIcon, Paperclip, Plus, ChevronLeft, ChevronRight, DollarSign, ClipboardList, ClipboardCheck, AlertTriangle, Package, Truck, MessageSquare, ShieldCheck, ToggleLeft, Wrench, CalendarRange, PenLine, Calculator } from "lucide-react";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DrawerCountForm, type PriorPull } from "@/components/logbook/DrawerCountForm";
import { SafeCountForm } from "@/components/logbook/SafeCountForm";
import { BankDepositForm } from "@/components/logbook/BankDepositForm";
import { EmployeeWriteUpForm } from "@/components/logbook/EmployeeWriteUpForm";
import { ReadAndSignForm } from "@/components/logbook/ReadAndSignForm";
import { PerformanceReviewForm } from "@/components/logbook/PerformanceReviewForm";
import { WasteLogForm, type WasteLogData } from "@/components/logbook/WasteLogForm";
import { CashCountTool } from "@/components/logbook/CashCountTool";
import { CateringOrderUploadInline } from "@/components/logbook/CateringOrderUploadInline";

import type { DrawerCountData } from "@/components/logbook/DrawerCountForm";
import type { SafeCountData } from "@/components/logbook/SafeCountForm";
import type { BankDepositData } from "@/components/logbook/BankDepositForm";
import type { WriteUpData } from "@/components/logbook/EmployeeWriteUpForm";
import type { PerformanceReviewData } from "@/components/logbook/PerformanceReviewForm";
import type { useLogBookData } from "@/hooks/useLogBookData";

type LogBookData = ReturnType<typeof useLogBookData>;

interface LogBookNewEntrySheetProps {
  data: LogBookData;
}

const getCategoryIcon = (name: string) => {
  const lower = name.toLowerCase();
  if (lower.includes('cash count tool')) return <Calculator className="h-5 w-5" />;
  if (lower.includes('drawer')) return <DollarSign className="h-5 w-5" />;
  if (lower.includes('safe')) return <ShieldCheck className="h-5 w-5" />;
  if (lower.includes('bank') || lower.includes('deposit')) return <Building2 className="h-5 w-5" />;
  if (lower.includes('write') || lower.includes('up')) return <AlertTriangle className="h-5 w-5" />;
  if (lower.includes('86') || lower.includes('68')) return <ToggleLeft className="h-5 w-5" />;
  if (lower.includes('maintenance')) return <Wrench className="h-5 w-5" />;
  if (lower.includes('weekly') && lower.includes('summary')) return <CalendarRange className="h-5 w-5" />;
  if (lower.includes('read') && lower.includes('sign')) return <PenLine className="h-5 w-5" />;
  if (lower.includes('performance') && lower.includes('review')) return <ClipboardCheck className="h-5 w-5" />;
  if (lower.includes('incident') || lower.includes('accident')) return <AlertTriangle className="h-5 w-5" />;
  if (lower.includes('inventory') || lower.includes('waste')) return <Package className="h-5 w-5" />;
  if (lower.includes('delivery') || lower.includes('catering')) return <Truck className="h-5 w-5" />;
  if (lower.includes('note') || lower.includes('message')) return <MessageSquare className="h-5 w-5" />;
  return <ClipboardList className="h-5 w-5" />;
};

export function LogBookNewEntrySheet({ data }: LogBookNewEntrySheetProps) {
  const {
    user, currentLocation, categories, selectedCategory, setSelectedCategory,
    showNewEntrySheet, setShowNewEntrySheet, wizardStep, setWizardStep,
    selectedDate, setSelectedDate, entry, fields, formData, setFormData,
    isSavingSpecialForm, setIsSavingSpecialForm, preselectedShift, setPreselectedShift,
    existingSafeCountShifts, locationSettings, drawerCountEntries,
    bankDepositCategoryId, generatingWeeklySummary, setGeneratingWeeklySummary,
    getDateInTimezone, getBusinessDateInTimezone,
    handleFileUpload, uploadingFiles, saveEntryMutation, employees,
    toast, queryClient, setActiveTab, isAdmin, isManager, isShiftManager,
  } = data;

  const currentCategoryName = categories.find((c: any) => c.id === selectedCategory)?.name?.toLowerCase();
  const isDrawerCount = currentCategoryName === 'drawer count';
  const isSafeCount = currentCategoryName === 'safe count';
  const isWeeklySummary = currentCategoryName === 'weekly summary';
  const isBankDeposit = selectedCategory === 'bank-deposit' || currentCategoryName === 'bank deposit';
  const isCashCountTool = selectedCategory === 'cash-count-tool';
  const isCateringOrder = selectedCategory === 'catering-order';
  const isEmployeeWriteUp = ['corrective action', 'employee write-up', 'employee writeup', 'employee write up', 'write-up', 'writeup', 'write up'].includes(currentCategoryName || '');
  const isReadAndSign = ['read & sign', 'read and sign', 'read-and-sign'].includes(currentCategoryName || '');
  const isPerformanceReview = ['performance review', 'performance-review'].includes(currentCategoryName || '');
  const isWasteLog = ['waste log', 'waste', 'waste report'].includes(currentCategoryName || '');


  const renderFormContent = () => {
    if (isCashCountTool) {
      return (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Cash Count Tool</h2>
          <p className="text-xs text-muted-foreground">
            Calculator-only utility. Useful for the morning re-count to confirm the drawer
            still contains the bank — nothing here is saved or recorded.
          </p>
          <CashCountTool drawerBank={locationSettings?.drawer_bank ?? 200} />
        </div>
      );
    }

    if (isCateringOrder) {
      return (
        <CateringOrderUploadInline
          onDone={() => {
            setShowNewEntrySheet(false);
            setActiveTab('search');
            queryClient.invalidateQueries({ queryKey: ['catering-orders'] });
          }}
          currentLocationId={currentLocation!.id}
          currentLocationName={currentLocation?.name || 'Location'}
          userId={user!.id}
          timezone={locationSettings?.timezone || 'America/Los_Angeles'}
          toast={toast}
        />
      );
    }


    if (isPerformanceReview) {
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Performance Review</h2>
          <PerformanceReviewForm
            onSave={async (reviewData: PerformanceReviewData) => {
              if (isSavingSpecialForm) return;
              setIsSavingSpecialForm(true);
              try {
                const { data: review, error: reviewError } = await supabase
                  .from('performance_reviews')
                  .insert({ location_id: currentLocation!.id, employee_id: reviewData.employeeId, created_by: user!.id, follow_up_notes: reviewData.followUpNotes || null })
                  .select().single();
                if (reviewError) throw reviewError;
                if (reviewData.ratings.length > 0) {
                  const ratingsToInsert = reviewData.ratings.map(r => ({ review_id: review.id, item_id: r.itemId, rating: r.rating, notes: r.notes || null }));
                  const { error: ratingsError } = await supabase.from('performance_review_ratings').insert(ratingsToInsert);
                  if (ratingsError) throw ratingsError;
                }
                const { data: task, error: taskError } = await supabase
                  .from('temporary_tasks')
                  .insert({ location_id: currentLocation!.id, title: 'Sign Performance Review', description: 'You have a performance review that requires your acknowledgment and signature.', created_by: user!.id, accent_color: '#3b82f6', task_style: 'quick', is_active: true, push_enabled: true })
                  .select().single();
                if (taskError) throw taskError;
                if (task) {
                  await supabase.from('temporary_task_assignments').insert({ task_id: task.id, user_id: reviewData.employeeId });
                  await supabase.from('performance_reviews').update({ task_id: task.id }).eq('id', review.id);
                }
                toast({ title: "Performance review submitted", description: `${reviewData.employeeName} will be notified to sign.` });
                queryClient.invalidateQueries({ queryKey: ['performance-reviews'] });
                queryClient.invalidateQueries({ queryKey: ['temporary-tasks'] });
                setShowNewEntrySheet(false);
                setActiveTab('search');
              } catch (error: any) {
                toast({ title: "Error saving review", description: error.message, variant: "destructive" });
              } finally { setIsSavingSpecialForm(false); }
            }}
            isSaving={isSavingSpecialForm}
          />
        </div>
      );
    }

    if (isWasteLog) {
      return (
        <WasteLogForm
          onSave={async (wasteData: WasteLogData) => {
            if (isSavingSpecialForm) return;
            setIsSavingSpecialForm(true);
            try {
              // Upload photo
              const ext = wasteData.photoFile.name.split(".").pop() || "jpg";
              const filePath = `${currentLocation!.id}/${Date.now()}.${ext}`;
              const { error: uploadError } = await supabase.storage
                .from("waste-photos")
                .upload(filePath, wasteData.photoFile);
              if (uploadError) throw uploadError;

              const { data: urlData } = supabase.storage
                .from("waste-photos")
                .getPublicUrl(filePath);

              // Insert waste log
              const { error: insertError } = await supabase
                .from("inventory_waste_logs")
                .insert({
                  location_id: currentLocation!.id,
                  item_id: wasteData.itemId,
                  quantity: wasteData.quantity,
                  unit: wasteData.unit,
                  reason: wasteData.reason,
                  photo_url: urlData.publicUrl,
                  estimated_cost: wasteData.estimatedCost,
                  logged_by: user!.id,
                });
              if (insertError) throw insertError;

              // Also create a logbook entry so it shows in Recent Logs
              const dateStr = getDateInTimezone(new Date());
              const costStr = wasteData.estimatedCost ? `$${wasteData.estimatedCost.toFixed(2)}` : 'N/A';
              const noteText = `${wasteData.itemName} — ${wasteData.quantity} ${wasteData.unit}\nReason: ${wasteData.reason}\nEstimated loss: ${costStr}`;
              
              // Look up the "Details" field for this waste log category
              const { data: wasteField } = await supabase
                .from("logbook_fields")
                .select("id")
                .eq("category_id", selectedCategory)
                .eq("field_name", "Details")
                .maybeSingle();

              const { data: entryData, error: entryError } = await supabase
                .from("logbook_entries")
                .insert({
                  category_id: selectedCategory,
                  entry_date: dateStr,
                  created_by: user!.id,
                  location_id: currentLocation!.id,
                })
                .select()
                .single();
              if (entryError) console.error("[WasteLog] Logbook entry error:", entryError);
              
              // Save waste details + photo as entry value
              if (entryData && wasteField) {
                await supabase.from("logbook_entry_values").insert({
                  entry_id: entryData.id,
                  field_id: wasteField.id,
                  value_text: noteText,
                  attachment_url: urlData.publicUrl,
                });
              }

              // Send push notification to managers
              try {
                await supabase.functions.invoke("send-push-notification", {
                  body: {
                    notification_type: "waste_log",
                    title: `Waste Logged`,
                    body: `${wasteData.itemName} — ${wasteData.quantity} ${wasteData.unit} wasted. Reason: ${wasteData.reason.slice(0, 60)}`,
                    location_id: currentLocation!.id,
                    roles: ["admin", "manager", "super_admin", "brand_admin", "org_admin"],
                  },
                });
              } catch (e) {
                console.error("[WasteLog] Push notification failed:", e);
              }

              // Send email notification to managers at location
              try {
                const { data: loggerProfile } = await supabase
                  .from("profiles")
                  .select("full_name")
                  .eq("id", user!.id)
                  .single();

                const { data: locationMembers } = await supabase
                  .from("user_locations")
                  .select("user_id")
                  .eq("location_id", currentLocation!.id);

                if (locationMembers && locationMembers.length > 0) {
                  const memberIds = locationMembers.map((m: any) => m.user_id);
                  const { data: managerRoles } = await supabase
                    .from("user_roles")
                    .select("user_id")
                    .in("user_id", memberIds)
                    .in("role", ["manager", "admin", "org_admin", "brand_admin", "super_admin"]);

                  if (managerRoles && managerRoles.length > 0) {
                    const managerUserIds = managerRoles.map((r: any) => r.user_id);
                    const { data: managerProfiles } = await supabase
                      .from("profiles")
                      .select("email")
                      .in("id", managerUserIds)
                      .not("email", "is", null);

                    const managerEmails = managerProfiles
                      ?.map((p: any) => p.email)
                      .filter(Boolean) as string[];

                    if (managerEmails.length > 0) {
                      await supabase.functions.invoke("send-notification-email", {
                        body: {
                          type: "waste_log",
                          to: managerEmails,
                          data: {
                            item_name: wasteData.itemName,
                            quantity: `${wasteData.quantity} ${wasteData.unit}`,
                            reason: wasteData.reason,
                            estimated_cost: wasteData.estimatedCost
                              ? `$${wasteData.estimatedCost.toFixed(2)}`
                              : "N/A",
                            photo_url: urlData.publicUrl,
                            logged_by: loggerProfile?.full_name || "Team Member",
                            location_name: currentLocation!.name || "Location",
                            date: format(new Date(), "MMM d, yyyy h:mm a"),
                          },
                        },
                      });
                    }
                  }
                }
              } catch (e) {
                console.error("[WasteLog] Email notification failed:", e);
              }

              toast({ title: "Waste logged successfully", description: `${wasteData.itemName} — ${wasteData.quantity} ${wasteData.unit}` });
              queryClient.invalidateQueries({ queryKey: ["waste-logs"] });
              queryClient.invalidateQueries({ queryKey: ["logbook-entries"] });
              queryClient.invalidateQueries({ queryKey: ["logbook-search"] });
              setShowNewEntrySheet(false);
              setActiveTab('search');
            } catch (error: any) {
              toast({ title: "Error logging waste", description: error.message, variant: "destructive" });
            } finally { setIsSavingSpecialForm(false); }
          }}
          isSaving={isSavingSpecialForm}
        />
      );
    }

    if (isReadAndSign) {
      return (
        <ReadAndSignForm
          locationId={currentLocation!.id}
          employees={employees}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['read-and-sign-docs'] });
            setShowNewEntrySheet(false);
            setActiveTab('search');
          }}
          onCancel={() => {
            setShowNewEntrySheet(false);
          }}
        />
      );
    }

    if (isEmployeeWriteUp) {
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Corrective Action</h2>
          <EmployeeWriteUpForm
            onSave={async (writeUpData: WriteUpData) => {
              if (isSavingSpecialForm) return;
              setIsSavingSpecialForm(true);
              try {
                const { data: writeUp, error: writeUpError } = await supabase
                  .from('employee_writeups')
                  .insert({
                    location_id: currentLocation!.id,
                    employee_id: writeUpData.employeeId,
                    created_by: user!.id,
                    reason: writeUpData.reason,
                    issue_description: writeUpData.issueDescription || null,
                    next_steps: writeUpData.nextSteps || null,
                    photo_url: writeUpData.photoUrl || null,
                    is_final_warning: writeUpData.isFinalWarning,
                    transcript_text: writeUpData.transcriptText || null,
                    notes_bullets: writeUpData.notesBullets ?? null,
                    consent_confirmed_at: writeUpData.consentConfirmedAt || null,
                    recording_duration_seconds: writeUpData.recordingDurationSeconds ?? null,
                    stt_model_used: writeUpData.sttModelUsed || null,
                  })
                  .select().single();
                if (writeUpError) throw writeUpError;
                // Trail id: attach to the picked trail, otherwise this row starts its own trail.
                const resolvedFamilyId = writeUpData.familyId || writeUp.id;
                await supabase.from('employee_writeups').update({ family_id: resolvedFamilyId }).eq('id', writeUp.id);
                const { error: taskError } = await supabase
                  .from('temporary_tasks')
                  .insert({ location_id: currentLocation!.id, title: `Sign Corrective Action: ${writeUpData.reason}`, description: 'You have a corrective action that requires your acknowledgment and signature.', created_by: user!.id, accent_color: '#ef4444', task_style: 'quick', is_active: true, write_up_id: writeUp.id, push_enabled: true });
                if (taskError) throw taskError;
                const { data: taskData } = await supabase.from('temporary_tasks').select('id').eq('write_up_id', writeUp.id).single();
                if (taskData) {
                  await supabase.from('temporary_task_assignments').insert({ task_id: taskData.id, user_id: writeUpData.employeeId });
                }
                toast({ title: "Corrective action submitted", description: `${writeUpData.employeeName} will be notified to sign.` });
                queryClient.invalidateQueries({ queryKey: ['employee-writeups'] });
                queryClient.invalidateQueries({ queryKey: ['temporary-tasks'] });
                setShowNewEntrySheet(false);
                setActiveTab('search');
              } catch (error: any) {
                toast({ title: "Error saving corrective action", description: error.message, variant: "destructive" });
              } finally { setIsSavingSpecialForm(false); }
            }}
            isSaving={isSavingSpecialForm}
          />
        </div>
      );
    }

    if (isWeeklySummary) {
      const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
      const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
      return (
        <div className="space-y-4">
          <div className="flex flex-col justify-between items-start gap-3">
            <h2 className="text-lg font-semibold">Generate Weekly Summary</h2>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  <span className="text-xs sm:text-sm">Week of {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={selectedDate} onSelect={(date) => date && setSelectedDate(date)} />
              </PopoverContent>
            </Popover>
          </div>
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">
                This will generate an AI-powered summary for the week of <strong>{format(weekStart, 'MMM d')}</strong> to <strong>{format(weekEnd, 'MMM d, yyyy')}</strong>, including:
              </p>
              <ul className="mt-2 text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>Total sales & daily breakdown</li>
                <li>Cash over/short from drawer counts</li>
                <li>Task completion rate</li>
                <li>AI-generated insights</li>
              </ul>
            </CardContent>
          </Card>
          <Button className="w-full" disabled={generatingWeeklySummary} onClick={async () => {
            setGeneratingWeeklySummary(true);
            try {
              const weekStartStr = format(weekStart, 'yyyy-MM-dd');
              const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
              toast({ title: "Generating weekly summary...", description: "Please wait" });
              const { error } = await supabase.functions.invoke('maintenance-service?action=generate-weekly-summary', {
                body: { location_id: currentLocation?.id, week_start: weekStartStr, week_end: weekEndStr, user_id: user!.id }
              });
              if (error) throw error;
              toast({ title: "Weekly summary generated!" });
              queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
              queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
              setShowNewEntrySheet(false);
              setActiveTab('search');
            } catch (error: any) {
              toast({ title: "Error generating summary", description: error.message || "Please try again", variant: "destructive" });
            } finally { setGeneratingWeeklySummary(false); }
          }}>
            {generatingWeeklySummary ? "Generating..." : "Generate Weekly Summary"}
          </Button>
        </div>
      );
    }

    if (isBankDeposit) {
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Bank Deposit</h2>
          <BankDepositForm
            onSave={async (depositData: BankDepositData) => {
              if (isSavingSpecialForm) return;
              setIsSavingSpecialForm(true);
              try {
                let categoryId = bankDepositCategoryId;
                if (!categoryId) {
                  const { data: newCategory, error: categoryError } = await supabase
                    .from('logbook_categories')
                    .insert({ name: 'Bank Deposit', location_id: currentLocation?.id, display_order: 999, is_active: true, alert_enabled: false, push_notification_enabled: false })
                    .select().single();
                  if (categoryError) throw categoryError;
                  categoryId = newCategory.id;
                  queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
                }
                const { data: existingFields } = await supabase.from('logbook_fields').select('id').eq('category_id', categoryId).limit(1);
                let fieldId = existingFields?.[0]?.id;
                if (!fieldId) {
                  const { data: newField, error: fieldError } = await supabase
                    .from('logbook_fields')
                    .insert({ category_id: categoryId, field_name: 'bank_deposit_data', field_type: 'text', display_order: 0, is_required: false })
                    .select().single();
                  if (fieldError) throw fieldError;
                  fieldId = newField.id;
                }
                const { data: entryData, error: entryError } = await supabase
                  .from('logbook_entries')
                  .insert({ category_id: categoryId, entry_date: depositData.endDate, created_by: user!.id, location_id: currentLocation?.id })
                  .select().single();
                if (entryError) throw entryError;
                const { error: valuesError } = await supabase
                  .from('logbook_entry_values')
                  .insert({ entry_id: entryData.id, field_id: fieldId, value_text: JSON.stringify(depositData) });
                if (valuesError) throw valuesError;

                // Write audits back onto the drawer counts so the audited amount
                // becomes the authoritative data point for reporting/summaries.
                const auditedEntries = (depositData.entries || []).filter((e: any) => e.audit);
                if (auditedEntries.length > 0) {
                  const { data: drawerValues } = await supabase
                    .from('logbook_entry_values')
                    .select('id, entry_id, value_text')
                    .in('entry_id', auditedEntries.map((e: any) => e.entryId));
                  for (const row of drawerValues || []) {
                    const target = auditedEntries.find((e: any) => e.entryId === row.entry_id);
                    if (!target?.audit) continue;
                    try {
                      const parsed = JSON.parse(row.value_text || '{}');
                      if (parsed.actualDeposit === undefined) continue;
                      const recorded = Number(parsed.actualDeposit) || 0;
                      const counted = Number(target.audit.countedAmount) || 0;
                      const updated = {
                        ...parsed,
                        audit: target.audit,
                        auditedDeposit: counted,
                        auditedVariance: (Number(parsed.variance) || 0) + (counted - recorded),
                      };
                      await supabase
                        .from('logbook_entry_values')
                        .update({ value_text: JSON.stringify(updated) })
                        .eq('id', row.id);
                    } catch (e) { console.error('Failed to write audit back to drawer count:', e); }
                  }
                }

                toast({ title: "Bank deposit recorded successfully" });
                queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
                queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
                queryClient.invalidateQueries({ queryKey: ['deposited-drawer-entries'] });
                setShowNewEntrySheet(false);
                setActiveTab('search');
              } catch (error: any) {
                toast({ title: "Error saving bank deposit", description: error.message, variant: "destructive" });
              } finally { setIsSavingSpecialForm(false); }
            }}
            isSaving={isSavingSpecialForm}
            timezone={locationSettings?.timezone || "America/Los_Angeles"}
          />
        </div>
      );
    }

    if (isDrawerCount) {
      const businessDateStr = getBusinessDateInTimezone();
      const businessDateDisplay = new Date(businessDateStr + 'T12:00:00');
      return (
        <div className="space-y-4">
          <div className="flex flex-col justify-between items-start gap-3">
            <h2 className="text-lg font-semibold">Drawer Count</h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarIcon className="h-4 w-4" />
              <span>Business Day: {format(businessDateDisplay, 'EEEE, MMMM d, yyyy')}</span>
            </div>
          </div>
          {entry && (
            <p className="text-xs text-muted-foreground">
              Last entry by {entry.profiles?.full_name} at {format(new Date(entry.created_at), 'PPp')}
            </p>
          )}
          <DrawerCountForm
            key={getBusinessDateInTimezone()}
            businessDate={getBusinessDateInTimezone()}
            onSave={async (drawerData: DrawerCountData) => {
              if (isSavingSpecialForm) return;
              setIsSavingSpecialForm(true);
              try {
                const dateStr = getBusinessDateInTimezone();
                let fieldId = fields[0]?.id;
                if (!fieldId) {
                  const { data: newField, error: fieldError } = await supabase
                    .from('logbook_fields')
                    .insert({ category_id: selectedCategory, field_name: 'drawer_data', field_type: 'text', display_order: 0, is_required: false })
                    .select().single();
                  if (fieldError) throw fieldError;
                  fieldId = newField.id;
                  queryClient.invalidateQueries({ queryKey: ['logbook-fields', selectedCategory] });
                }
                const { data: entryData, error: entryError } = await supabase
                  .from('logbook_entries')
                  .insert({ category_id: selectedCategory, entry_date: dateStr, created_by: user!.id, location_id: currentLocation?.id })
                  .select().single();
                if (entryError) throw entryError;
                await supabase.from('logbook_entry_values').delete().eq('entry_id', entryData.id);
                const { error: valuesError } = await supabase
                  .from('logbook_entry_values')
                  .insert({ entry_id: entryData.id, field_id: fieldId, value_text: JSON.stringify(drawerData) });
                if (valuesError) throw valuesError;
                toast({ title: "Drawer count saved successfully" });
                queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
                queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
                queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
                queryClient.invalidateQueries({ queryKey: ['drawer-count-entries'] });
                setShowNewEntrySheet(false);
                setActiveTab('search');

                if (locationSettings?.drawer_count_notifications_enabled !== false) {
                  try {
                    const overUnderText = drawerData.variance > 0 ? `OVER $${drawerData.variance.toFixed(2)}` : drawerData.variance < 0 ? `SHORT $${Math.abs(drawerData.variance).toFixed(2)}` : 'BALANCED';
                    await supabase.functions.invoke('send-push-notification', {
                      body: { notification_type: 'drawer_count', title: `Drawer Count - ${currentLocation?.name || 'Location'}`, body: `Deposit: $${drawerData.actualDeposit.toFixed(2)} | ${overUnderText}`, location_id: currentLocation?.id, roles: ['admin', 'manager', 'shift_manager', 'shift_manager_in_training', 'super_admin'] }
                    });
                  } catch (notifError) { console.error('Error sending drawer count notification:', notifError); }
                }

                const businessDate = new Date(dateStr + 'T12:00:00');
                const dayOfWeek = getDay(businessDate);
                if (dayOfWeek === 0 && currentLocation?.id) {
                  try {
                    const weekStart = format(startOfWeek(businessDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
                    const weekEnd = format(endOfWeek(businessDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
                    toast({ title: "Generating weekly summary...", description: "Please wait" });
                    await supabase.functions.invoke('maintenance-service?action=generate-weekly-summary', {
                      body: { location_id: currentLocation.id, week_start: weekStart, week_end: weekEnd, user_id: user!.id }
                    });
                    toast({ title: "Weekly summary generated!" });
                    queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
                    queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
                  } catch (summaryError) { console.error('Error generating weekly summary:', summaryError); }
                }
              } catch (error: any) {
                toast({ title: "Error saving drawer count", description: error.message, variant: "destructive" });
              } finally { setIsSavingSpecialForm(false); }
            }}
            isSaving={isSavingSpecialForm}
            existingData={entry?.logbook_entry_values?.[0]?.value_text ? JSON.parse(entry.logbook_entry_values[0].value_text) : null}
            entryCount={drawerCountEntries.length}
            drawerBank={locationSettings?.drawer_bank ?? 200}
            priorPulls={drawerCountEntries.map((e: any) => {
              try {
                const parsed = JSON.parse(e.logbook_entry_values?.[0]?.value_text || '{}');
                return {
                  amount: parsed.actualDeposit || 0,
                  time: e.created_at,
                  createdBy: e.profiles?.full_name,
                } as PriorPull;
              } catch { return null; }
            }).filter(Boolean) as PriorPull[]}
          />
        </div>
      );
    }

    if (isSafeCount) {
      return (
        <div className="space-y-4">
          <div className="flex flex-col justify-between items-start gap-3">
            <h2 className="text-lg font-semibold">Safe Count</h2>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  <span className="text-xs sm:text-sm">{format(selectedDate, 'PPP')}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={selectedDate} onSelect={(date) => date && setSelectedDate(date)} />
              </PopoverContent>
            </Popover>
          </div>
          {entry && (
            <p className="text-xs text-muted-foreground">
              Last entry by {entry.profiles?.full_name} at {format(new Date(entry.created_at), 'PPp')}
            </p>
          )}
          <SafeCountForm
            key={`${getDateInTimezone(selectedDate)}-${preselectedShift || ''}`}
            onSave={async (safeData: SafeCountData) => {
              if (isSavingSpecialForm) return;
              setIsSavingSpecialForm(true);
              try {
                const dateStr = getDateInTimezone(selectedDate);
                let fieldId = fields[0]?.id;
                if (!fieldId) {
                  const { data: newField, error: fieldError } = await supabase
                    .from('logbook_fields')
                    .insert({ category_id: selectedCategory, field_name: 'safe_data', field_type: 'text', display_order: 0, is_required: false })
                    .select().single();
                  if (fieldError) throw fieldError;
                  fieldId = newField.id;
                  queryClient.invalidateQueries({ queryKey: ['logbook-fields', selectedCategory] });
                }
                const { data: entryData, error: entryError } = await supabase
                  .from('logbook_entries')
                  .insert({ category_id: selectedCategory, entry_date: dateStr, created_by: user!.id, location_id: currentLocation?.id })
                  .select().single();
                if (entryError) throw entryError;
                const { data: existingValues } = await supabase
                  .from('logbook_entry_values')
                  .select('id, value_text')
                  .eq('entry_id', entryData.id)
                  .eq('field_id', fieldId);
                if (existingValues && existingValues.length > 0) {
                  const valueIdsToDelete = existingValues
                    .filter(v => { try { return JSON.parse(v.value_text || '{}').shift === safeData.shift; } catch { return false; } })
                    .map(v => v.id);
                  if (valueIdsToDelete.length > 0) {
                    await supabase.from('logbook_entry_values').delete().in('id', valueIdsToDelete);
                  }
                }
                const { error: valuesError } = await supabase
                  .from('logbook_entry_values')
                  .insert({ entry_id: entryData.id, field_id: fieldId, value_text: JSON.stringify(safeData) });
                if (valuesError) throw valuesError;
                toast({ title: "Safe count saved successfully" });
                queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
                queryClient.invalidateQueries({ queryKey: ['logbook-recent-entries'] });
                queryClient.invalidateQueries({ queryKey: ['logbook-search'] });
                queryClient.invalidateQueries({ queryKey: ['safe-count-entries'] });
                setShowNewEntrySheet(false);
                setActiveTab('search');
                setPreselectedShift(null);
                if (locationSettings?.safe_count_notifications_enabled !== false) {
                  try {
                    await supabase.functions.invoke('send-push-notification', {
                      body: { notification_type: 'safe_count', title: `Safe Count - ${currentLocation?.name || 'Location'}`, body: `${safeData.shift} Safe Count Complete - $${safeData.totalSafe.toFixed(2)} balanced`, location_id: currentLocation?.id, roles: ['admin', 'manager', 'shift_manager', 'shift_manager_in_training', 'super_admin'] }
                    });
                  } catch (notifError) { console.error('Error sending safe count notification:', notifError); }
                }
              } catch (error: any) {
                toast({ title: "Error saving safe count", description: error.message, variant: "destructive" });
              } finally { setIsSavingSpecialForm(false); }
            }}
            isSaving={isSavingSpecialForm}
            existingShifts={existingSafeCountShifts}
            safeTarget={locationSettings?.safe_target ?? 300}
            defaultShift={preselectedShift || undefined}
          />
        </div>
      );
    }

    // Default generic form
    return (
      <div className="space-y-4">
        <div className="flex flex-col justify-between items-start gap-3">
          <h2 className="text-lg font-semibold">
            {categories.find((c: any) => c.id === selectedCategory)?.name}
          </h2>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="w-full">
                <CalendarIcon className="h-4 w-4 mr-2" />
                <span className="text-xs sm:text-sm">{format(selectedDate, 'PPP')}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={selectedDate} onSelect={(date) => date && setSelectedDate(date)} />
            </PopoverContent>
          </Popover>
        </div>
        {entry && (
          <p className="text-xs text-muted-foreground">
            Entry by {entry.profiles?.full_name} at {format(new Date(entry.created_at), 'PPp')}
          </p>
        )}
        <form onSubmit={(e) => {
          e.preventDefault();
          saveEntryMutation.mutate();
          setShowNewEntrySheet(false);
        }} className="space-y-4">
          {fields
            .filter((field: any) => !['bank_deposit_data', 'drawer_data', 'safe_data', 'weekly_summary_data'].includes(field.field_name))
            .map((field: any) => (
              <div key={field.id} className="space-y-2">
                <Label>
                  {field.field_name}
                  {field.is_required && <span className="text-destructive ml-1">*</span>}
                </Label>
                {field.field_type === 'text' && (
                  <Input value={formData[field.id] || ''} onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })} required={field.is_required} />
                )}
                {field.field_type === 'textarea' && (
                  <Textarea value={formData[field.id] || ''} onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })} required={field.is_required} />
                )}
                {field.field_type === 'number' && (
                  <Input type="number" value={formData[field.id] || ''} onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })} required={field.is_required} />
                )}
                {field.field_type === 'date' && (
                  <Input type="date" value={formData[field.id] || ''} onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })} required={field.is_required} />
                )}
                {field.field_type === 'attachment' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input type="file" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(field.id, file); }} disabled={uploadingFiles[field.id]} />
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                    </div>
                    {uploadingFiles[field.id] && <p className="text-xs text-muted-foreground">Uploading...</p>}
                    {formData[field.id] && !uploadingFiles[field.id] && (
                      <a href={formData[field.id]} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">View uploaded file</a>
                    )}
                  </div>
                )}
                {field.field_type === 'radio' && field.options && (
                  <div className="space-y-2">
                    {(field.options as string[]).map((option: string) => (
                      <label key={option} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name={field.id} value={option} checked={formData[field.id] === option} onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })} required={field.is_required} className="h-4 w-4" />
                        <span className="text-sm">{option}</span>
                      </label>
                    ))}
                  </div>
                )}
                {field.field_type === 'dropdown' && field.options && (
                  <Select value={formData[field.id] || ''} onValueChange={(value) => setFormData({ ...formData, [field.id]: value })}>
                    <SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger>
                    <SelectContent>
                      {(field.options as string[]).map((option: string) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}
          <Button type="submit" disabled={saveEntryMutation.isPending} className="w-full">
            {saveEntryMutation.isPending ? 'Saving...' : 'Add Entry'}
          </Button>
        </form>
      </div>
    );
  };

  if (!isShiftManager && !isManager && !isAdmin) return null;

  return (
    <Sheet open={showNewEntrySheet} onOpenChange={(open) => {
      setShowNewEntrySheet(open);
      if (!open) { setWizardStep('category'); setSelectedCategory(''); setPreselectedShift(null); }
    }}>
      <SheetTrigger asChild>
        <Button size="icon" variant="default">
          <Plus className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[92vh] overflow-y-auto">
        {wizardStep === 'category' ? (
          <>
            <SheetHeader>
              <SheetTitle>New Log Entry</SheetTitle>
            </SheetHeader>
            {(() => {
              const all = [
                ...[...categories].sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0)),
                { id: 'catering-order', name: 'Catering Order', __synthetic: true },
                { id: 'cash-count-tool', name: 'Cash Count Tool', __synthetic: true },
              ];
              const isCash = (name: string) =>
                ['drawer', 'safe', 'bank', 'deposit', 'cash count tool'].some(term => name.toLowerCase().includes(term));
              const logs = all.filter((c: any) => !isCash(c.name));
              const cash = all.filter((c: any) => isCash(c.name));

              const Row = ({ category, cashStyle }: { category: any; cashStyle: boolean }) => (
                <button
                  key={category.id}
                  onClick={() => { setSelectedCategory(category.id); setWizardStep('form'); }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60 active:bg-muted"
                >
                  <div className={`shrink-0 flex items-center justify-center h-8 w-8 rounded-lg ${cashStyle ? "bg-teal-500/10 text-teal-500" : "bg-primary/10 text-primary"}`}>
                    {getCategoryIcon(category.name)}
                  </div>
                  <span className="flex-1 font-medium text-sm">{category.name}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );

              return (
                <div className="mt-3 space-y-3 pb-2">
                  <div>
                    <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Logs</p>
                    <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                      {logs.map((c: any) => <Row key={c.id} category={c} cashStyle={false} />)}
                    </div>
                  </div>
                  {cash.length > 0 && (
                    <div>
                      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Cash Handling</p>
                      <div className="rounded-xl border border-teal-500/40 bg-teal-500/5 divide-y divide-teal-500/20 overflow-hidden">
                        {cash.map((c: any) => <Row key={c.id} category={c} cashStyle />)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        ) : (
          <>
            <SheetHeader className="flex flex-row items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setWizardStep('category')} className="h-8 w-8 -ml-2">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <SheetTitle className="!mt-0">
                {selectedCategory === 'bank-deposit' ? 'Bank Deposit' : selectedCategory === 'cash-count-tool' ? 'Cash Count Tool' : selectedCategory === 'catering-order' ? 'Catering Order' : categories.find((c: any) => c.id === selectedCategory)?.name || 'New Entry'}
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              {renderFormContent()}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
