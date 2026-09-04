// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { requireCaller } from "../_shared/callerAuth.ts";

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

const systemFontStack = "'Manrope', -apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:${systemFontStack};"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="width:100%;max-width:720px;margin:0 auto;background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

function getEmailHeader(title: string): string {
  return `<tr><td style="background:${primaryColor};padding:30px 40px;text-align:center;"><img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:50px;margin-bottom:12px;"/><h1 style="color:#fff;font-size:28px;font-weight:600;margin:0;font-family:${systemFontStack};text-transform:uppercase;letter-spacing:0.5px;">${title}</h1></td></tr>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f0ebe1;padding:30px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;padding-bottom:12px;"><div style="display:inline-flex;align-items:center;gap:10px;justify-content:center;"><span style="color:#3a5f7d;font-size:16px;font-weight:400;letter-spacing:-0.2px;">Powered by</span><img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-transparent.webp" alt="CrooHQ" style="height:44px;" /></div></td></tr><tr><td style="text-align:center;"><p style="color:#999;font-size:12px;margin:0;">&copy; 2026 Croo. All rights reserved.</p></td></tr></table></td></tr>`;
}

function getCTAButton(url: string, text: string): string {
  return `<div style="text-align:center;"><a href="${url}" style="display:inline-block;background:${accentColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">${text}</a></div>`;
}

// Escape any caller-supplied value before it lands in email HTML.
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow https URLs for image/link fields; anything else is dropped.
function safeUrl(value: unknown): string {
  if (!value) return '';
  try {
    const u = new URL(String(value));
    if (u.protocol !== 'https:') return '';
    return escapeHtml(u.toString());
  } catch {
    return '';
  }
}

function sanitizeData(input: any): any {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return escapeHtml(input);
  if (Array.isArray(input)) return input.map(sanitizeData);
  if (typeof input === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = /_url$/.test(k) ? safeUrl(v) : sanitizeData(v);
    }
    return out;
  }
  return input;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireCaller(req, corsHeaders);
  if ("response" in auth) return auth.response;

  try {
    const payload = await req.json();
    const { type, to } = payload;
    const data = sanitizeData(payload.data ?? {});

    if (!type || !to) {
      return new Response(JSON.stringify({ error: "type and to required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    let subject = "";
    let content = "";
    let headerTitle = "";
    let source = "";

    // ========== EMPLOYEE WRITE-UP ISSUANCE ==========
    if (type === "employee_writeup") {
      const { reason, issue_description, next_steps, is_final_warning, manager_name, location_name, date } = data;
      subject = `You've received a Corrective Action from management`;
      headerTitle = "Corrective Action";
      source = "writeup_issued";
      content = `
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">You have received a Corrective Action from management.</p>
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
        <p style="color:#666;font-size:13px;margin:0 0 20px;">Open the Croo app to review the full details and acknowledge this Corrective Action.</p>
      `;
    }
    // ========== WRITE-UP SIGNED/ACKNOWLEDGED ==========
    else if (type === "employee_writeup_signed") {
      const { reason, issue_description, next_steps, manager_name, location_name, signed_date } = data;
      subject = `Corrective Action acknowledged by employee`;
      headerTitle = "Corrective Action";
      source = "writeup_signed";
      content = `
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">An employee has acknowledged and signed a Corrective Action.</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;">
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Reason</span><br/><strong style="color:${primaryColor};font-size:15px;">${reason}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Signed Date</span><br/><strong style="color:${textColor};font-size:14px;">${signed_date}</strong></td></tr>
            ${location_name ? `<tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">${location_name}</strong></td></tr>` : ''}
          </table>
        </div>
      `;
    }
    // ========== PERFORMANCE REVIEW SIGNED ==========
    else if (type === "performance_review_signed") {
      const { manager_name, location_name, signed_date, average_rating } = data;
      subject = `Performance review acknowledged`;
      headerTitle = "Performance Review";
      source = "review_signed";
      content = `
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Thank you for reviewing and acknowledging your performance review.</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;">
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Reviewed By</span><br/><strong style="color:${textColor};font-size:14px;">${manager_name || 'Management'}</strong></td></tr>
            ${location_name ? `<tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">${location_name}</strong></td></tr>` : ''}
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Signed Date</span><br/><strong style="color:${textColor};font-size:14px;">${signed_date}</strong></td></tr>
            ${average_rating ? `<tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Average Rating</span><br/><strong style="color:${primaryColor};font-size:18px;">⭐ ${average_rating}/10</strong></td></tr>` : ''}
          </table>
        </div>
        <p style="color:#666;font-size:13px;margin:0 0 20px;">Your signed review is saved in your employee records. Open the Croo app to view it anytime.</p>
      `;
    }
    // ========== WASTE LOG NOTIFICATION ==========
    else if (type === "waste_log") {
      const { item_name, quantity: qty, reason: wasteReason, estimated_cost, photo_url, logged_by, location_name, date } = data;
      subject = `Waste Logged — ${item_name} at ${location_name}`;
      headerTitle = "Waste Alert";
      source = "waste_log";
      content = `
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">A waste event has been logged and may require a credit memo from your vendor.</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;border-left:4px solid #ef4444;">
          <table style="width:100%;">
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Item</span><br/><strong style="color:#ef4444;font-size:15px;">${item_name}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Quantity Wasted</span><br/><strong style="color:${textColor};font-size:14px;">${qty}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Estimated Cost</span><br/><strong style="color:#ef4444;font-size:14px;">${estimated_cost}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Logged By</span><br/><strong style="color:${textColor};font-size:14px;">${logged_by}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">${location_name}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Date</span><br/><strong style="color:${textColor};font-size:14px;">${date}</strong></td></tr>
          </table>
        </div>
        <div style="background:#fafafa;border-radius:10px;padding:16px;margin-bottom:16px;border-left:4px solid ${primaryColor};">
          <p style="color:#666;font-size:12px;text-transform:uppercase;margin:0 0 8px;">Reason</p>
          <p style="color:${textColor};font-size:14px;line-height:1.5;margin:0;">${wasteReason}</p>
        </div>
        ${photo_url ? `<div style="margin-bottom:20px;"><p style="color:#666;font-size:12px;text-transform:uppercase;margin:0 0 8px;">Photo Evidence</p><img src="${photo_url}" alt="Waste photo" style="width:100%;max-width:400px;border-radius:10px;"/></div>` : ''}
        <p style="color:#666;font-size:13px;margin:0 0 10px;">💡 <strong>Tip:</strong> Forward this email to your vendor rep if a credit memo is needed.</p>
      `;
    }
    // ========== BILLING INITIATED ==========
    else if (type === "billing_initiated") {
      const { location_name, recipient_name, billing_url, initiated_by_name } = data;
      subject = `Activate your CrooHQ subscription for ${location_name}`;
      headerTitle = "Time to Activate Billing";
      source = "billing_initiated";
      content = `
        <p style="color:${textColor};font-size:15px;margin:0 0 16px;">${recipient_name ? `Hi ${recipient_name},` : 'Hi there,'}</p>
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Your demo of CrooHQ for <strong>${location_name}</strong> is ready to convert to a full subscription. ${initiated_by_name ? `${initiated_by_name} from the Croo team` : 'The Croo team'} has enabled billing for your location.</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;border-left:4px solid ${accentColor};">
          <p style="color:${textColor};font-size:14px;margin:0 0 8px;"><strong>What happens next:</strong></p>
          <ul style="color:${textColor};font-size:14px;margin:0;padding-left:20px;line-height:1.7;">
            <li>Click the button below to choose your plan</li>
            <li>Enter payment details through our secure Stripe checkout</li>
            <li>Your subscription renews automatically each cycle</li>
            <li>Manage or cancel anytime from your billing portal</li>
          </ul>
        </div>
        <p style="color:#666;font-size:13px;margin:0 0 20px;">You'll also see a banner inside the app linking you to this same page.</p>
      `;
    }
    // ========== NEW SUBSCRIPTION (super admin alert) ==========
    else if (type === "new_subscription") {
      const { location_name, organization_name, subscribed_by, amount, status, subscription_id, trial_end } = data;
      subject = `🎉 New CrooHQ subscriber — ${organization_name} / ${location_name}`;
      headerTitle = "New Subscription";
      source = "new_subscription";
      const trialLine = trial_end ? `<tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Trial ends</span><br/><strong style="color:${textColor};font-size:14px;">${new Date(trial_end).toLocaleString()}</strong></td></tr>` : "";
      content = `
        <p style="color:${textColor};font-size:15px;margin:0 0 16px;">A new paid subscription just started on CrooHQ.</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:16px;border-left:4px solid ${accentColor};">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Organization</span><br/><strong style="color:${textColor};font-size:14px;">${organization_name}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">${location_name}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Subscribed by</span><br/><strong style="color:${textColor};font-size:14px;">${subscribed_by}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Plan</span><br/><strong style="color:${textColor};font-size:14px;">${amount}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Status</span><br/><strong style="color:${textColor};font-size:14px;text-transform:capitalize;">${status}</strong></td></tr>
            ${trialLine}
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Stripe subscription</span><br/><code style="color:${textColor};font-size:12px;">${subscription_id}</code></td></tr>
          </table>
        </div>
      `;
    }
    else {
      return new Response(JSON.stringify({ error: "Unknown notification type: " + type }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    const ctaUrl = type === "billing_initiated" && data?.billing_url ? data.billing_url : "https://croohq.com";
    const ctaText = type === "billing_initiated" ? "Activate Subscription" : "Open Croo";
    const emailHtml = wrapEmail(`
      ${getEmailHeader(headerTitle)}
      <tr><td style="padding:30px 40px;">${content}<div style="margin-top:24px;">${getCTAButton(ctaUrl, ctaText)}</div></td></tr>
      ${getEmailFooter()}
    `);


    await queueEmail({
      from: "CrooHQ <hello@croohq.email>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html: emailHtml,
      source,
      dedupKey: `${type}_${to}_${Date.now()}`,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[send-notification-email] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
