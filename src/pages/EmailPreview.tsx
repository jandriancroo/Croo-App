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

const EmailPreview = () => {
  const navigate = useNavigate();
  const [selectedLocation, setSelectedLocation] = useState("");
  const [entryDate, setEntryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  });
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
    if (!selectedLocation || !entryDate) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("support-email-service", {
        body: {
          action: "send_daily_logbook_summary",
          payload: { location_id: selectedLocation, entry_date: entryDate, preview: true },
        },
      });
      if (error) throw error;
      if (data?.html) {
        setPreviewHtml(data.html);
      } else {
        toast({ title: "No HTML returned", description: data?.message || "Check data availability", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!selectedLocation || !entryDate) return;
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

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Email Preview</h1>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Daily Summary Email</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[180px]">
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
              <div className="min-w-[160px]">
                <label className="text-xs text-muted-foreground mb-1 block">Date</label>
                <Input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} />
              </div>
              <Button onClick={handlePreview} disabled={loading || !selectedLocation}>
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Preview
              </Button>
              <Button variant="secondary" onClick={handleSend} disabled={sending || !selectedLocation}>
                {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </Button>
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
