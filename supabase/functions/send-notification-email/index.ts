import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function queueEmail(opts: { from: string; to: string[]; subject: string; html: string; source: string; dedupKey?: string; metadata?: Record<string, any> }) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { error } = await supabase.from('email_queue').insert({
    from_address: opts.from,
    to_addresses: opts.to,
    subject: opts.subject,
    html: opts.html,
    source: opts.source,
    dedup_key: opts.dedupKey || null,
    metadata: opts.metadata || {},
  });
  if (error) {
    console.error(`[notification-email] Queue insert failed for "${opts.subject}":`, error);
    throw error;
  }
  console.log(`[notification-email] Queued: "${opts.subject}" → ${opts.to.join(', ')}`);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

function getEmailHeader(title: string): string {
  return `<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;"><img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:50px;margin-bottom:12px;filter:brightness(0) invert(1);"/><h1 style="color:#fff;font-size:22px;font-weight:600;margin:0;">${title}</h1></td></tr>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f8f7f5;padding:24px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;"><a href="https://croohq.com" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;margin-bottom:16px;">Open Croo</a><p style="color:#aaa;font-size:11px;margin:16px 0 0;">© ${new Date().getFullYear()} Croo. All rights reserved.</p></td></tr></table></td></tr>`;
}

function getCTAButton(url: string, text: string): string {
  return `<div style="text-align:center;"><a href="${url}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">${text}</a></div>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { type, to, data } = payload;

    if (!type || !to) {
      return new Response(JSON.stringify({ error: "type and to required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let subject = "";
    let content = "";

    // ========== EMPLOYEE WRITE-UP ISSUANCE ==========
    if (type === "employee_writeup") {
      const { reason, issue_description, next_steps, is_final_warning, manager_name, location_name, date } = data;
      subject = `📋 You've received a write-up from management`;
      content = `
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">You have received an employee write-up from management.</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;border-left:4px solid #ef4444;">
          <table style="width:100%;">
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Reason</span><br/><strong style="color:#ef4444;font-size:15px;">${reason}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Issued By</span><br/><strong style="color:${textColor};font-size:14px;">${manager_name || 'Management'}</strong></td></tr>
            ${location_name ? `<tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">${location_name}</strong></td></tr>` : ''}
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Date</span><br/><strong style="color:${textColor};font-size:14px;">${date}</strong></td></tr>
          </table>
        </div>

        <div style="background:#fafafa;border-radius:10px;padding:16px;margin-bottom:16px;border-left:4px solid ${primaryColor};">
          <p style="color:#666;font-size:12px;text-transform:uppercase;margin:0 0 8px;">Issue Description</p>
          <p style="color:${textColor};font-size:14px;line-height:1.5;margin:0;">${issue_description}</p>
        </div>

        <div style="background:${backgroundColor};border-radius:10px;padding:16px;margin-bottom:20px;border-left:4px solid ${primaryColor};">
          <p style="color:#666;font-size:12px;text-transform:uppercase;margin:0 0 8px;">Next Steps</p>
          <p style="color:${textColor};font-size:14px;line-height:1.5;margin:0;">${next_steps}</p>
        </div>

        ${is_final_warning ? `<div style="background:#fef2f2;border-radius:10px;padding:16px;margin-bottom:20px;border-left:4px solid #ef4444;"><p style="color:#991b1b;font-size:13px;font-weight:600;margin:0;">⚠️ This is a final warning.</p></div>` : ''}

        <p style="color:#666;font-size:13px;margin:0 0 20px;">Open the Croo app to review the full details and acknowledge this write-up.</p>
      `;
    }
    // ========== WRITE-UP SIGNED/ACKNOWLEDGED ==========
    else if (type === "employee_writeup_signed") {
      const { reason, issue_description, next_steps, manager_name, location_name, signed_date } = data;
      subject = `✅ Write-up acknowledged by employee`;
      content = `
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">An employee has acknowledged and signed a write-up.</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;">
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Reason</span><br/><strong style="color:${primaryColor};font-size:15px;">${reason}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Signed Date</span><br/><strong style="color:${textColor};font-size:14px;">${signed_date}</strong></td></tr>
            ${location_name ? `<tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">${location_name}</strong></td></tr>` : ''}
          </table>
        </div>
      `;
    }
    else {
      return new Response(JSON.stringify({ error: "Unknown notification type" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const emailHtml = wrapEmail(`
      ${getEmailHeader("📋 Write-up Notification")}
      <tr><td style="padding:30px 40px;">${content}<div style="margin-top:24px;">${getCTAButton("https://croohq.com", "Open Croo")}</div></td></tr>
      ${getEmailFooter()}
    `);

    await queueEmail({
      from: "CrooHQ <hello@croohq.email>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html: emailHtml,
      source: type === "employee_writeup" ? "writeup_issued" : "writeup_signed",
      dedupKey: `${type}_${to}_${Date.now()}`,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[send-notification-email] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
