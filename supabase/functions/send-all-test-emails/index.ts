import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Croo brand colors
const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

interface TestEmailsRequest {
  to: string;
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

const testEmails = [
  {
    subject: '💬 New message from Sarah Johnson',
    html: (content: string) => wrapEmail(`
      ${getEmailHeader('New Chat Message', '💬')}
      <tr>
        <td style="padding: 30px 40px;">
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            <strong style="color: ${primaryColor};">Sarah Johnson</strong> sent you a message in <strong>Hemet Team Chat</strong>:
          </p>
          <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0; border-left: 4px solid ${primaryColor};">
            <p style="color: ${textColor}; font-size: 14px; line-height: 1.5; margin: 0; font-style: italic;">
              "Hey! Can you cover my shift tomorrow? I have a doctor's appointment 🙏"
            </p>
          </div>
          <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
            Tap below to view and reply.
          </p>
        </td>
      </tr>
      ${getEmailFooter()}
    `)
  },
  {
    subject: '📢 New Announcement: Holiday Schedule Update',
    html: (content: string) => wrapEmail(`
      ${getEmailHeader('New Announcement', '📢')}
      <tr>
        <td style="padding: 30px 40px;">
          <h2 style="color: ${textColor}; font-size: 18px; font-weight: 600; margin: 0 0 16px;">
            Holiday Schedule Update
          </h2>
          <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 20px; margin: 16px 0;">
            <p style="color: ${textColor}; font-size: 14px; line-height: 1.6; margin: 0;">
              Quick reminder: We'll be running special holiday hours next week. Please check your schedule carefully and let me know if you have any conflicts. Thanks team! 🎄
            </p>
          </div>
          <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
            Posted by <strong>Mike Thompson</strong> at Hemet
          </p>
        </td>
      </tr>
      ${getEmailFooter()}
    `)
  },
  {
    subject: '📅 Schedule Update: New shift added',
    html: (content: string) => wrapEmail(`
      ${getEmailHeader('Schedule Update', '📅')}
      <tr>
        <td style="padding: 30px 40px;">
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            A new shift has been added to your schedule.
          </p>
          <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
            <table role="presentation" style="width: 100%;">
              <tr>
                <td style="padding: 8px 0;">
                  <span style="color: #666; font-size: 12px; text-transform: uppercase;">Date</span><br/>
                  <strong style="color: ${textColor}; font-size: 15px;">Monday, January 13, 2026</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">
                  <span style="color: #666; font-size: 12px; text-transform: uppercase;">Time</span><br/>
                  <strong style="color: ${textColor}; font-size: 15px;">9:00 AM - 5:00 PM</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">
                  <span style="color: #666; font-size: 12px; text-transform: uppercase;">Position</span><br/>
                  <strong style="color: ${textColor}; font-size: 15px;">Shift Leader</strong>
                </td>
              </tr>
            </table>
          </div>
          <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
            Check the app to view your full schedule.
          </p>
        </td>
      </tr>
      ${getEmailFooter()}
    `)
  },
  {
    subject: '💵 Drawer Count Submitted',
    html: (content: string) => wrapEmail(`
      ${getEmailHeader('Drawer Count Submitted', '💵')}
      <tr>
        <td style="padding: 30px 40px;">
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            A drawer count has been submitted at <strong>Hemet</strong>.
          </p>
          <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
            <table role="presentation" style="width: 100%;">
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px;">Submitted by</span><br/>
                  <strong style="color: ${textColor}; font-size: 14px;">Emily Chen</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px;">Drawer Total</span><br/>
                  <strong style="color: ${primaryColor}; font-size: 18px;">$247.50</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px;">Variance</span><br/>
                  <strong style="color: #22c55e; font-size: 14px;">+$2.50</strong>
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>
      ${getEmailFooter()}
    `)
  },
  {
    subject: '🔐 Safe Count Submitted',
    html: (content: string) => wrapEmail(`
      ${getEmailHeader('Safe Count Submitted', '🔐')}
      <tr>
        <td style="padding: 30px 40px;">
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            A safe count has been submitted at <strong>Hemet</strong>.
          </p>
          <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
            <table role="presentation" style="width: 100%;">
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px;">Submitted by</span><br/>
                  <strong style="color: ${textColor}; font-size: 14px;">Mike Thompson</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px;">Count Type</span><br/>
                  <strong style="color: ${textColor}; font-size: 14px;">PM Count</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px;">Safe Total</span><br/>
                  <strong style="color: ${primaryColor}; font-size: 18px;">$3,847.25</strong>
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>
      ${getEmailFooter()}
    `)
  },
  {
    subject: '🏦 Bank Deposit Submitted',
    html: (content: string) => wrapEmail(`
      ${getEmailHeader('Bank Deposit Submitted', '🏦')}
      <tr>
        <td style="padding: 30px 40px;">
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            A bank deposit has been recorded at <strong>Hemet</strong>.
          </p>
          <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
            <table role="presentation" style="width: 100%;">
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px;">Submitted by</span><br/>
                  <strong style="color: ${textColor}; font-size: 14px;">Sarah Johnson</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px;">Deposit Amount</span><br/>
                  <strong style="color: ${primaryColor}; font-size: 18px;">$2,500.00</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px;">Bag Number</span><br/>
                  <strong style="color: ${textColor}; font-size: 14px;">BAG-12345</strong>
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>
      ${getEmailFooter()}
    `)
  },
  {
    subject: '✅ Shift Request Approved',
    html: (content: string) => wrapEmail(`
      ${getEmailHeader('Shift Request Approved', '✅')}
      <tr>
        <td style="padding: 30px 40px;">
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            Your time-off request has been <strong style="color: #22c55e;">approved</strong>.
          </p>
          <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
            <p style="color: ${textColor}; font-size: 14px; line-height: 1.5; margin: 0;">
              Your request for January 15-17, 2026 has been approved. Enjoy your time off!
            </p>
          </div>
          <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
            Reviewed by <strong>Mike Thompson</strong>
          </p>
        </td>
      </tr>
      ${getEmailFooter()}
    `)
  },
  {
    subject: '⚠️ Overdue Checklist: Opening Tasks',
    html: (content: string) => wrapEmail(`
      ${getEmailHeader('Overdue Checklist', '⚠️')}
      <tr>
        <td style="padding: 30px 40px;">
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            The following checklist is overdue and needs attention:
          </p>
          <div style="background-color: #fef2f2; border-radius: 10px; padding: 16px; margin: 16px 0; border-left: 4px solid #ef4444;">
            <strong style="color: ${textColor}; font-size: 15px;">Opening Tasks</strong>
            <p style="color: #666; font-size: 13px; margin: 8px 0 0;">Due by: 9:00 AM</p>
          </div>
          <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
            Location: Hemet
          </p>
        </td>
      </tr>
      ${getEmailFooter()}
    `)
  },
  {
    subject: '🕐 Late Arrival Alert',
    html: (content: string) => wrapEmail(`
      ${getEmailHeader('Late Arrival Alert', '🕐')}
      <tr>
        <td style="padding: 30px 40px;">
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            <strong>Alex Martinez</strong> has not yet clocked in for their shift.
          </p>
          <div style="background-color: #fffbeb; border-radius: 10px; padding: 16px; margin: 16px 0; border-left: 4px solid #f59e0b;">
            <table role="presentation" style="width: 100%;">
              <tr>
                <td>
                  <span style="color: #666; font-size: 12px;">Scheduled Time</span><br/>
                  <strong style="color: ${textColor}; font-size: 15px;">10:00 AM</strong>
                </td>
                <td style="text-align: right;">
                  <span style="color: #666; font-size: 12px;">Late By</span><br/>
                  <strong style="color: #f59e0b; font-size: 15px;">15 min</strong>
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>
      ${getEmailFooter()}
    `)
  },
  {
    subject: '📋 Certification Expiring Soon: Food Handler',
    html: (content: string) => wrapEmail(`
      ${getEmailHeader('Certification Expiring', '📋')}
      <tr>
        <td style="padding: 30px 40px;">
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            <strong>Jordan Smith's</strong> certification is expiring soon:
          </p>
          <div style="background-color: #fef2f2; border-radius: 10px; padding: 16px; margin: 16px 0; border-left: 4px solid #ef4444;">
            <strong style="color: ${textColor}; font-size: 15px;">Food Handler Certificate</strong>
            <p style="color: #666; font-size: 13px; margin: 8px 0 0;">
              Expires: <strong style="color: #ef4444;">January 20, 2026</strong>
            </p>
          </div>
          <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
            Please renew this certification before it expires.
          </p>
        </td>
      </tr>
      ${getEmailFooter()}
    `)
  }
];

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to }: TestEmailsRequest = await req.json();

    if (!to) {
      throw new Error("Email address is required");
    }

    console.log(`Sending all test emails to: ${to}`);

    const results = [];
    
    // Send emails with a small delay between each
    for (let i = 0; i < testEmails.length; i++) {
      const email = testEmails[i];
      
      try {
        const emailResponse = await resend.emails.send({
          from: "CrooHQ <hello@croohq.email>",
          to: [to],
          subject: `[TEST ${i + 1}/${testEmails.length}] ${email.subject}`,
          html: email.html(''),
        });
        
        results.push({ subject: email.subject, success: true, id: emailResponse.data?.id });
        console.log(`Sent email ${i + 1}: ${email.subject}`);
        
        // Small delay to avoid rate limiting
        if (i < testEmails.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error: any) {
        results.push({ subject: email.subject, success: false, error: error.message });
        console.error(`Failed to send email ${i + 1}: ${error.message}`);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      total: testEmails.length,
      results 
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending test emails:", error);
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
