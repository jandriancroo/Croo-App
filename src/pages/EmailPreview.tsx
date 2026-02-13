import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, Send, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";

const EMAIL_TYPES = [
  { value: "daily_summary", label: "Daily Summary", description: "End-of-day logbook summary with sales, labor, checklists, cash handling" },
  { value: "weekly_summary", label: "Weekly Summary", description: "Aggregated Mon-Sun sales, labor, checklists, and cash handling" },
  { value: "support_ticket", label: "Support Ticket", description: "New support ticket notification" },
  { value: "weekly_schedule", label: "Weekly Schedule (Employee)", description: "Individual schedule email sent to each employee" },
  { value: "weekly_schedule_manager", label: "Weekly Schedule (Manager)", description: "Full team schedule grid sent to shift managers and above" },
  { value: "hiring_invite", label: "Hiring - Invite", description: "New employee onboarding invite email" },
  { value: "hiring_rejection", label: "Hiring - Rejection", description: "Applicant rejection email" },
  { value: "hiring_interview", label: "Hiring - Interview", description: "Interview invite email" },
  { value: "hiring_chat", label: "Hiring - Chat Message", description: "Email sent to applicant when a manager messages them" },
  { value: "test_batch", label: "Test Batch (Chat/Announce/Schedule)", description: "Batch of sample emails: chat, announcement, schedule" },
];

const EmailPreview = () => {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState("daily_summary");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [entryDate, setEntryDate] = useState("2026-02-06");
  const [weekStart, setWeekStart] = useState("2026-02-02");
  const [weekEnd, setWeekEnd] = useState("2026-02-08");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const { data: locations } = useQuery({
    queryKey: ["locations-for-email-preview"],
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name").order("name");
      return data || [];
    },
  });

  const handlePreview = async () => {
    if (selectedType === "daily_summary" && (!selectedLocation || !entryDate)) return;
    setLoading(true);
    try {
      let data: any, error: any;

      if (selectedType === "daily_summary") {
        ({ data, error } = await supabase.functions.invoke("support-email-service", {
          body: {
            action: "send_daily_logbook_summary",
            payload: { location_id: selectedLocation, entry_date: entryDate, preview: true },
          },
        }));
      } else if (selectedType === "weekly_summary") {
        ({ data, error } = await supabase.functions.invoke("support-email-service", {
          body: {
            action: "send_weekly_summary_email",
            payload: { location_id: selectedLocation, week_start: weekStart, week_end: weekEnd, preview: true },
          },
        }));
      } else if (selectedType === "support_ticket") {
        ({ data, error } = await supabase.functions.invoke("support-email-service", {
          body: {
            action: "support_ticket",
            payload: { preview: true, ticketId: "preview", subject: "Test Ticket", message: "This is a preview of a support ticket email.", userName: "John Doe", userEmail: "john@example.com" },
          },
        }));
      } else if (selectedType === "weekly_schedule") {
        ({ data, error } = await supabase.functions.invoke("send-weekly-schedule-email", {
          body: { preview: true, location_id: selectedLocation, preview_type: "employee" },
        }));
      } else if (selectedType === "weekly_schedule_manager") {
        ({ data, error } = await supabase.functions.invoke("send-weekly-schedule-email", {
          body: { preview: true, location_id: selectedLocation, preview_type: "manager" },
        }));
      } else if (selectedType === "hiring_invite") {
        ({ data, error } = await supabase.functions.invoke("hiring-email-service", {
          body: { action: "send_invite", preview: true, to: "preview@test.com", fullName: "Jane Smith", resetLink: "https://croohq.com/reset", locationId: selectedLocation },
        }));
      } else if (selectedType === "hiring_rejection") {
        ({ data, error } = await supabase.functions.invoke("hiring-email-service", {
          body: { action: "send_rejection", preview: true },
        }));
      } else if (selectedType === "hiring_interview") {
        ({ data, error } = await supabase.functions.invoke("hiring-email-service", {
          body: { action: "send_interview_invite", preview: true },
        }));
      } else if (selectedType === "hiring_chat") {
        ({ data, error } = await supabase.functions.invoke("notify-hiring-message", {
          body: { preview: true },
        }));
      } else if (selectedType === "test_batch") {
        ({ data, error } = await supabase.functions.invoke("support-email-service", {
          body: { action: "send_all_test_emails", payload: { preview: true } },
        }));
      }

      if (error) throw error;
      if (data?.html) {
        setPreviewHtml(data.html);
      } else if (data?.results && Array.isArray(data.results)) {
        // batch - show first one
        setPreviewHtml(data.results[0]?.html || "<p>No HTML returned</p>");
      } else {
        toast({ title: "No HTML returned", description: data?.message || data?.error || "Check if preview mode is supported for this email type", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (selectedType === "daily_summary" && (!selectedLocation || !entryDate)) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("support-email-service", {
        body: {
          action: "send_daily_logbook_summary",
          payload: { location_id: selectedLocation, entry_date: entryDate },
        },
      });
      if (error) throw error;
      toast({ title: "Email sent", description: `Sent to ${data?.recipientCount || 0} recipients` });
    } catch (e: any) {
      toast({ title: "Send failed", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const selectedTypeInfo = EMAIL_TYPES.find(t => t.value === selectedType);
  const needsLocation = ["daily_summary", "weekly_summary", "weekly_schedule", "weekly_schedule_manager", "hiring_invite"].includes(selectedType);
  const needsDate = selectedType === "daily_summary";
  const needsWeekRange = selectedType === "weekly_summary";
  const canSend = selectedType === "daily_summary";

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Email Design Studio</h1>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Email Type</CardTitle>
            {selectedTypeInfo && <p className="text-xs text-muted-foreground">{selectedTypeInfo.description}</p>}
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-muted-foreground mb-1 block">Template</label>
                <Select value={selectedType} onValueChange={(v) => { setSelectedType(v); setPreviewHtml(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMAIL_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {needsLocation && (
                <div className="min-w-[180px]">
                  <label className="text-xs text-muted-foreground mb-1 block">Location</label>
                  <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                    <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                    <SelectContent>
                      {locations?.map(l => (
                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {needsDate && (
                <div className="min-w-[160px]">
                  <label className="text-xs text-muted-foreground mb-1 block">Date</label>
                  <Input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} />
                </div>
              )}
              {needsWeekRange && (
                <>
                  <div className="min-w-[140px]">
                    <label className="text-xs text-muted-foreground mb-1 block">Week Start (Mon)</label>
                    <Input type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} />
                  </div>
                  <div className="min-w-[140px]">
                    <label className="text-xs text-muted-foreground mb-1 block">Week End (Sun)</label>
                    <Input type="date" value={weekEnd} onChange={e => setWeekEnd(e.target.value)} />
                  </div>
                </>
              )}
              <Button onClick={handlePreview} disabled={loading || (needsLocation && !selectedLocation)}>
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Preview
              </Button>
              {canSend && (
                <Button variant="secondary" onClick={handleSend} disabled={sending || !selectedLocation}>
                  {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {previewHtml && (
          <Card>
            <CardContent className="p-0">
              <iframe
                srcDoc={previewHtml}
                className="w-full border-0 rounded-lg"
                style={{ minHeight: "800px" }}
                title="Email Preview"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default EmailPreview;
