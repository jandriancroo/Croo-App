// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { recipients, reportTitle, period, author, pdfBase64, fileName } = await req.json();

    if (!Array.isArray(recipients) || recipients.length === 0 || !pdfBase64) {
      return new Response(JSON.stringify({ error: "recipients and pdfBase64 required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Upload PDF to reports bucket
    const safeName = (fileName || `report_${Date.now()}.pdf`).replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}_${safeName}`;
    const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));

    const { error: upErr } = await supabase.storage.from("reports").upload(path, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (upErr) throw upErr;

    const { data: signed, error: signErr } = await supabase.storage
      .from("reports")
      .createSignedUrl(path, 60 * 60 * 24 * 14); // 14-day link
    if (signErr) throw signErr;

    const downloadUrl = signed.signedUrl;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0ebe1;font-family:'Manrope',-apple-system,sans-serif;">
<table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;">
<table style="width:100%;max-width:640px;margin:0 auto;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
  <tr><td style="background:#0a7a8a;padding:30px 40px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">${escapeHtml(reportTitle || "Report")}</h1>
    <p style="color:#cce;font-size:13px;margin:8px 0 0;">${escapeHtml(period || "")}</p>
  </td></tr>
  <tr><td style="padding:30px 40px;">
    <p style="font-size:15px;color:#0f1215;margin:0 0 18px;">Your CrooHQ report is ready.</p>
    ${author ? `<p style="font-size:13px;color:#666;margin:0 0 24px;">Prepared by ${escapeHtml(author)}</p>` : ""}
    <div style="text-align:center;margin:28px 0;">
      <a href="${downloadUrl}" style="display:inline-block;background:#f58220;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">Download PDF</a>
    </div>
    <p style="font-size:12px;color:#999;margin:24px 0 0;">Link expires in 14 days.</p>
  </td></tr>
  <tr><td style="background:#f0ebe1;padding:20px 40px;text-align:center;color:#999;font-size:12px;">
    Powered by CrooHQ
  </td></tr>
</table></td></tr></table></body></html>`;

    const { error: queueErr } = await supabase.from("email_queue").insert({
      from_address: "CrooHQ Reports <hello@croohq.email>",
      to_addresses: recipients,
      subject: `${reportTitle || "Report"} — ${period || ""}`.trim(),
      html,
      source: "report_export",
      metadata: { report_title: reportTitle, period, file_path: path },
    });
    if (queueErr) throw queueErr;

    return new Response(JSON.stringify({ success: true, downloadUrl, path }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[send-report-email]", err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
