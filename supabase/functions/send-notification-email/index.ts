import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Croo brand colors
const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

type NotificationType = 
  | 'chat_message' 
  | 'announcement' 
  | 'schedule_update' 
  | 'shift_approval'
  | 'overdue_checklist'
  | 'late_arrival'
  | 'cert_expiring'
  | 'drawer_count'
  | 'safe_count'
  | 'bank_deposit'
  | 'test';

interface NotificationEmailRequest {
  type: NotificationType;
  to: string;
  user_id?: string;
  location_id?: string;
  data?: Record<string, any>;
}

function getEmailHeader(title: string, emoji: string = "📢"): string {
  return `
    <tr>
      <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 30px 40px; text-align: center;">
        <img 
          src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
          alt="Croo" 
          style="height: 50px; width: auto; margin-bottom: 12px; filter: brightness(0) invert(1);" 
        />
        <h1 style="color: #ffffff; font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.5px;">
          ${emoji} ${title}
        </h1>
      </td>
    </tr>
  `;
}

function getEmailFooter(): string {
  return `
    <tr>
      <td style="background-color: #f8f7f5; padding: 24px 40px; border-top: 1px solid #e8e5df;">
        <table role="presentation" style="width: 100%;">
          <tr>
            <td style="text-align: center;">
              <a href="https://croohq.com" style="display: inline-block; background: linear-gradient(135deg, ${accentColor} 0%, #e06b10 100%); color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 16px;">
                Open Croo
              </a>
              <p style="color: #aaa; font-size: 11px; margin: 16px 0 0;">
                © ${new Date().getFullYear()} Croo. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function wrapEmail(content: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: ${backgroundColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 30px 20px;">
            <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
              ${content}
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

function generateEmailContent(type: NotificationType, data: Record<string, any>): { subject: string; html: string } {
  switch (type) {
    case 'chat_message':
      return {
        subject: `💬 New message from ${data.sender_name || 'Someone'}`,
        html: wrapEmail(`
          ${getEmailHeader('New Chat Message', '💬')}
          <tr>
            <td style="padding: 30px 40px;">
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                <strong style="color: ${primaryColor};">${data.sender_name || 'A team member'}</strong> sent you a message${data.chat_name ? ` in <strong>${data.chat_name}</strong>` : ''}:
              </p>
              <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0; border-left: 4px solid ${primaryColor};">
                <p style="color: ${textColor}; font-size: 14px; line-height: 1.5; margin: 0; font-style: italic;">
                  "${data.message_preview || 'New message waiting for you...'}"
                </p>
              </div>
              <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
                Tap below to view and reply.
              </p>
            </td>
          </tr>
          ${getEmailFooter()}
        `)
      };

    case 'announcement':
      return {
        subject: `📢 New Announcement: ${data.title || 'Important Update'}`,
        html: wrapEmail(`
          ${getEmailHeader('New Announcement', '📢')}
          <tr>
            <td style="padding: 30px 40px;">
              <h2 style="color: ${textColor}; font-size: 18px; font-weight: 600; margin: 0 0 16px;">
                ${data.title || 'New Announcement'}
              </h2>
              <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 20px; margin: 16px 0;">
                <p style="color: ${textColor}; font-size: 14px; line-height: 1.6; margin: 0;">
                  ${data.message || 'A new announcement has been posted. Check the app for details.'}
                </p>
              </div>
              <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
                Posted by <strong>${data.sender_name || 'Management'}</strong>${data.location_name ? ` at ${data.location_name}` : ''}
              </p>
            </td>
          </tr>
          ${getEmailFooter()}
        `)
      };

    case 'schedule_update':
      return {
        subject: `📅 Schedule Update: ${data.change_type || 'Your schedule has changed'}`,
        html: wrapEmail(`
          ${getEmailHeader('Schedule Update', '📅')}
          <tr>
            <td style="padding: 30px 40px;">
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                ${data.message || 'Your schedule has been updated.'}
              </p>
              ${data.shift_date ? `
                <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
                  <table role="presentation" style="width: 100%;">
                    <tr>
                      <td style="padding: 8px 0;">
                        <span style="color: #666; font-size: 12px; text-transform: uppercase;">Date</span><br/>
                        <strong style="color: ${textColor}; font-size: 15px;">${data.shift_date}</strong>
                      </td>
                    </tr>
                    ${data.shift_time ? `
                      <tr>
                        <td style="padding: 8px 0;">
                          <span style="color: #666; font-size: 12px; text-transform: uppercase;">Time</span><br/>
                          <strong style="color: ${textColor}; font-size: 15px;">${data.shift_time}</strong>
                        </td>
                      </tr>
                    ` : ''}
                    ${data.position ? `
                      <tr>
                        <td style="padding: 8px 0;">
                          <span style="color: #666; font-size: 12px; text-transform: uppercase;">Position</span><br/>
                          <strong style="color: ${textColor}; font-size: 15px;">${data.position}</strong>
                        </td>
                      </tr>
                    ` : ''}
                  </table>
                </div>
              ` : ''}
              <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
                Check the app to view your full schedule.
              </p>
            </td>
          </tr>
          ${getEmailFooter()}
        `)
      };

    case 'shift_approval':
      return {
        subject: `✅ Shift Request ${data.status || 'Updated'}`,
        html: wrapEmail(`
          ${getEmailHeader(`Shift Request ${data.status || 'Updated'}`, data.approved ? '✅' : '❌')}
          <tr>
            <td style="padding: 30px 40px;">
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                Your ${data.request_type || 'shift'} request has been <strong style="color: ${data.approved ? '#22c55e' : '#ef4444'};">${data.status || 'updated'}</strong>.
              </p>
              ${data.details ? `
                <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
                  <p style="color: ${textColor}; font-size: 14px; line-height: 1.5; margin: 0;">
                    ${data.details}
                  </p>
                </div>
              ` : ''}
              ${data.reviewer_name ? `
                <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
                  Reviewed by <strong>${data.reviewer_name}</strong>
                </p>
              ` : ''}
            </td>
          </tr>
          ${getEmailFooter()}
        `)
      };

    case 'overdue_checklist':
      return {
        subject: `⚠️ Overdue Checklist: ${data.checklist_name || 'Action Required'}`,
        html: wrapEmail(`
          ${getEmailHeader('Overdue Checklist', '⚠️')}
          <tr>
            <td style="padding: 30px 40px;">
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                The following checklist is overdue and needs attention:
              </p>
              <div style="background-color: #fef2f2; border-radius: 10px; padding: 16px; margin: 16px 0; border-left: 4px solid #ef4444;">
                <strong style="color: ${textColor}; font-size: 15px;">${data.checklist_name || 'Checklist'}</strong>
                ${data.due_time ? `<p style="color: #666; font-size: 13px; margin: 8px 0 0;">Due by: ${data.due_time}</p>` : ''}
              </div>
              <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
                ${data.location_name ? `Location: ${data.location_name}` : 'Please complete this as soon as possible.'}
              </p>
            </td>
          </tr>
          ${getEmailFooter()}
        `)
      };

    case 'late_arrival':
      return {
        subject: `🕐 Late Arrival Alert`,
        html: wrapEmail(`
          ${getEmailHeader('Late Arrival Alert', '🕐')}
          <tr>
            <td style="padding: 30px 40px;">
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                <strong>${data.employee_name || 'An employee'}</strong> has not yet clocked in for their shift.
              </p>
              <div style="background-color: #fffbeb; border-radius: 10px; padding: 16px; margin: 16px 0; border-left: 4px solid #f59e0b;">
                <table role="presentation" style="width: 100%;">
                  <tr>
                    <td>
                      <span style="color: #666; font-size: 12px;">Scheduled Time</span><br/>
                      <strong style="color: ${textColor}; font-size: 15px;">${data.scheduled_time || 'Unknown'}</strong>
                    </td>
                    <td style="text-align: right;">
                      <span style="color: #666; font-size: 12px;">Late By</span><br/>
                      <strong style="color: #f59e0b; font-size: 15px;">${data.minutes_late || '?'} min</strong>
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>
          ${getEmailFooter()}
        `)
      };

    case 'cert_expiring':
      return {
        subject: `📋 Certification Expiring Soon: ${data.cert_type || 'Action Required'}`,
        html: wrapEmail(`
          ${getEmailHeader('Certification Expiring', '📋')}
          <tr>
            <td style="padding: 30px 40px;">
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                ${data.employee_name ? `<strong>${data.employee_name}'s</strong> certification is expiring soon:` : 'A certification is expiring soon:'}
              </p>
              <div style="background-color: #fef2f2; border-radius: 10px; padding: 16px; margin: 16px 0; border-left: 4px solid #ef4444;">
                <strong style="color: ${textColor}; font-size: 15px;">${data.cert_type || 'Certification'}</strong>
                <p style="color: #666; font-size: 13px; margin: 8px 0 0;">
                  Expires: <strong style="color: #ef4444;">${data.expiration_date || 'Soon'}</strong>
                </p>
              </div>
              <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
                Please renew this certification before it expires.
              </p>
            </td>
          </tr>
          ${getEmailFooter()}
        `)
      };

    case 'drawer_count':
      return {
        subject: `💵 Drawer Count Submitted`,
        html: wrapEmail(`
          ${getEmailHeader('Drawer Count Submitted', '💵')}
          <tr>
            <td style="padding: 30px 40px;">
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                A drawer count has been submitted${data.location_name ? ` at <strong>${data.location_name}</strong>` : ''}.
              </p>
              <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
                <table role="presentation" style="width: 100%;">
                  ${data.submitted_by ? `
                    <tr>
                      <td style="padding: 6px 0;">
                        <span style="color: #666; font-size: 12px;">Submitted by</span><br/>
                        <strong style="color: ${textColor}; font-size: 14px;">${data.submitted_by}</strong>
                      </td>
                    </tr>
                  ` : ''}
                  ${data.drawer_total ? `
                    <tr>
                      <td style="padding: 6px 0;">
                        <span style="color: #666; font-size: 12px;">Drawer Total</span><br/>
                        <strong style="color: ${primaryColor}; font-size: 18px;">$${data.drawer_total}</strong>
                      </td>
                    </tr>
                  ` : ''}
                  ${data.variance !== undefined ? `
                    <tr>
                      <td style="padding: 6px 0;">
                        <span style="color: #666; font-size: 12px;">Variance</span><br/>
                        <strong style="color: ${data.variance >= 0 ? '#22c55e' : '#ef4444'}; font-size: 14px;">
                          ${data.variance >= 0 ? '+' : ''}$${data.variance}
                        </strong>
                      </td>
                    </tr>
                  ` : ''}
                </table>
              </div>
            </td>
          </tr>
          ${getEmailFooter()}
        `)
      };

    case 'safe_count':
      return {
        subject: `🔐 Safe Count Submitted`,
        html: wrapEmail(`
          ${getEmailHeader('Safe Count Submitted', '🔐')}
          <tr>
            <td style="padding: 30px 40px;">
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                A safe count has been submitted${data.location_name ? ` at <strong>${data.location_name}</strong>` : ''}.
              </p>
              <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
                <table role="presentation" style="width: 100%;">
                  ${data.submitted_by ? `
                    <tr>
                      <td style="padding: 6px 0;">
                        <span style="color: #666; font-size: 12px;">Submitted by</span><br/>
                        <strong style="color: ${textColor}; font-size: 14px;">${data.submitted_by}</strong>
                      </td>
                    </tr>
                  ` : ''}
                  ${data.count_type ? `
                    <tr>
                      <td style="padding: 6px 0;">
                        <span style="color: #666; font-size: 12px;">Count Type</span><br/>
                        <strong style="color: ${textColor}; font-size: 14px;">${data.count_type}</strong>
                      </td>
                    </tr>
                  ` : ''}
                  ${data.safe_total ? `
                    <tr>
                      <td style="padding: 6px 0;">
                        <span style="color: #666; font-size: 12px;">Safe Total</span><br/>
                        <strong style="color: ${primaryColor}; font-size: 18px;">$${data.safe_total}</strong>
                      </td>
                    </tr>
                  ` : ''}
                </table>
              </div>
            </td>
          </tr>
          ${getEmailFooter()}
        `)
      };

    case 'bank_deposit':
      return {
        subject: `🏦 Bank Deposit Submitted`,
        html: wrapEmail(`
          ${getEmailHeader('Bank Deposit Submitted', '🏦')}
          <tr>
            <td style="padding: 30px 40px;">
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                A bank deposit has been recorded${data.location_name ? ` at <strong>${data.location_name}</strong>` : ''}.
              </p>
              <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
                <table role="presentation" style="width: 100%;">
                  ${data.submitted_by ? `
                    <tr>
                      <td style="padding: 6px 0;">
                        <span style="color: #666; font-size: 12px;">Submitted by</span><br/>
                        <strong style="color: ${textColor}; font-size: 14px;">${data.submitted_by}</strong>
                      </td>
                    </tr>
                  ` : ''}
                  ${data.deposit_amount ? `
                    <tr>
                      <td style="padding: 6px 0;">
                        <span style="color: #666; font-size: 12px;">Deposit Amount</span><br/>
                        <strong style="color: ${primaryColor}; font-size: 18px;">$${data.deposit_amount}</strong>
                      </td>
                    </tr>
                  ` : ''}
                  ${data.bag_number ? `
                    <tr>
                      <td style="padding: 6px 0;">
                        <span style="color: #666; font-size: 12px;">Bag Number</span><br/>
                        <strong style="color: ${textColor}; font-size: 14px;">${data.bag_number}</strong>
                      </td>
                    </tr>
                  ` : ''}
                </table>
              </div>
            </td>
          </tr>
          ${getEmailFooter()}
        `)
      };

    case 'test':
    default:
      return {
        subject: `🧪 Test Notification Email`,
        html: wrapEmail(`
          ${getEmailHeader('Test Notification', '🧪')}
          <tr>
            <td style="padding: 30px 40px;">
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                This is a test notification email from Croo. If you're receiving this, email notifications are working correctly!
              </p>
              <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
                <p style="color: ${textColor}; font-size: 14px; line-height: 1.5; margin: 0;">
                  <strong>Notification Type:</strong> ${type}<br/>
                  <strong>Sent at:</strong> ${new Date().toLocaleString()}
                </p>
              </div>
              <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
                You can manage your notification preferences in the app settings.
              </p>
            </td>
          </tr>
          ${getEmailFooter()}
        `)
      };
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, to, user_id, location_id, data = {} }: NotificationEmailRequest = await req.json();

    console.log(`Sending ${type} notification email to: ${to}`);

    // Check user preferences if user_id and location_id are provided
    if (user_id && location_id) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      // Map notification type to settings column
      const typeToSettingMap: Record<string, string> = {
        'chat_message': 'chat_messages',
        'announcement': 'announcements',
        'schedule_update': 'schedule_updates',
        'shift_approval': 'shift_approvals',
        'overdue_checklist': 'overdue_checklists',
        'late_arrival': 'late_arrivals',
        'cert_expiring': 'cert_expiring',
        'drawer_count': 'cash_drawer_count',
        'safe_count': 'cash_safe_count',
        'bank_deposit': 'cash_bank_deposit',
      };

      const settingColumn = typeToSettingMap[type];
      
      if (settingColumn) {
        const { data: settings } = await supabase
          .from('user_notification_settings')
          .select('*')
          .eq('user_id', user_id)
          .eq('location_id', location_id)
          .single();
        
        if (settings) {
          const columnName = `${settingColumn}_email_enabled`;
          if (settings[columnName] === false) {
            console.log(`User has disabled ${type} email notifications for this location`);
            return new Response(JSON.stringify({ success: true, skipped: true, reason: 'user_disabled' }), {
              status: 200,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }
        }
      }
    }

    const { subject, html } = generateEmailContent(type, data);

    const emailResponse = await resend.emails.send({
      from: "CrooHQ <hello@croohq.email>",
      to: [to],
      subject: subject,
      html: html,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending notification email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
