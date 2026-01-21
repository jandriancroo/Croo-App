import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Croo brand colors
const primaryColor = "#0a7a8a";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

interface SendInterviewInviteRequest {
  conversationId: string;
  interviewDate: string; // YYYY-MM-DD
  interviewTime: string; // HH:mm
  locationName: string;
  locationAddress?: string;
  scheduledByName: string;
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

// Generate ICS calendar file content
function generateICS(
  date: string,
  time: string,
  orgName: string,
  locationName: string,
  locationAddress: string | undefined,
  applicantName: string
): string {
  // Parse date and time (assuming PST/PDT timezone for Blaze locations)
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  
  // Create date in Pacific timezone and convert to UTC for ICS
  // ICS format: YYYYMMDDTHHMMSSZ (UTC)
  const startDate = new Date(Date.UTC(year, month - 1, day, hours + 8, minutes)); // +8 for PST to UTC
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour duration
  
  const formatICSDate = (d: Date): string => {
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };
  
  const uid = `interview-${date}-${time}-${Date.now()}@croohq.email`;
  const now = formatICSDate(new Date());
  const location = locationAddress || locationName;
  
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CrooHQ//Interview Scheduler//EN
CALSCALE:GREGORIAN
METHOD:REQUEST
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${now}
DTSTART:${formatICSDate(startDate)}
DTEND:${formatICSDate(endDate)}
SUMMARY:Interview at ${orgName}
DESCRIPTION:Your interview with ${orgName}.\\n\\nPlease arrive 5-10 minutes early.\\n\\nIf you need to reschedule, please reply to this message.
LOCATION:${location}
ORGANIZER:mailto:hiring@croohq.email
ATTENDEE;RSVP=TRUE:mailto:${applicantName}
STATUS:CONFIRMED
SEQUENCE:0
BEGIN:VALARM
TRIGGER:-PT1H
ACTION:DISPLAY
DESCRIPTION:Interview at ${orgName} in 1 hour
END:VALARM
BEGIN:VALARM
TRIGGER:-P1D
ACTION:DISPLAY
DESCRIPTION:Interview at ${orgName} tomorrow
END:VALARM
END:VEVENT
END:VCALENDAR`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { 
      conversationId, 
      interviewDate, 
      interviewTime, 
      locationName,
      locationAddress,
      scheduledByName 
    }: SendInterviewInviteRequest = await req.json();

    if (!conversationId || !interviewDate || !interviewTime) {
      return new Response(
        JSON.stringify({ error: "conversationId, interviewDate, and interviewTime are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch conversation with application and org details
    const { data: conversation, error: convError } = await supabase
      .from("hiring_conversations")
      .select(`
        id,
        access_token,
        application:job_applications(
          id,
          full_name,
          email,
          organization_id,
          organization:organizations(name, logo_url, brand_name)
        )
      `)
      .eq("id", conversationId)
      .single();

    if (convError || !conversation) {
      console.error("Error fetching conversation:", convError);
      return new Response(
        JSON.stringify({ error: "Conversation not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const application = conversation.application as any;
    const org = application?.organization;
    const applicantEmail = application?.email;
    const applicantName = application?.full_name || "Applicant";
    const firstName = applicantName.split(" ")[0];
    const orgName = org?.brand_name || org?.name || "Hiring Team";
    const logoUrl = org?.logo_url || "";

    if (!applicantEmail) {
      return new Response(
        JSON.stringify({ error: "Applicant has no email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the chat URL
    const chatUrl = `https://kitchen-check-mate.lovable.app/hiring-chat/${conversation.access_token}`;

    // Format date for display
    const dateObj = new Date(interviewDate + 'T12:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });
    
    // Format time for display
    const [hours, mins] = interviewTime.split(':').map(Number);
    const hour12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedTime = `${hour12}:${mins.toString().padStart(2, '0')} ${ampm}`;

    // Generate ICS file
    const icsContent = generateICS(
      interviewDate, 
      interviewTime, 
      orgName, 
      locationName, 
      locationAddress,
      applicantName
    );

    const emailHtml = wrapEmail(`
      <!-- Header -->
      <tr>
        <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 30px 40px; text-align: center;">
          ${logoUrl ? `
            <img 
              src="${logoUrl}" 
              alt="${orgName}" 
              style="max-height: 60px; max-width: 160px; width: auto; margin-bottom: 12px; border-radius: 8px;"
            />
          ` : `
            <img 
              src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
              alt="Croo" 
              style="height: 50px; width: auto; margin-bottom: 12px; filter: brightness(0) invert(1);" 
            />
          `}
          <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 8px 0 0; font-weight: 500;">
            ${orgName}
          </p>
        </td>
      </tr>
      
      <!-- Content -->
      <tr>
        <td style="padding: 30px 40px;">
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.7; margin: 0 0 20px;">
            Hi ${firstName},
          </p>
          
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.7; margin: 0 0 24px;">
            Great news! <strong>${scheduledByName}</strong> would like to invite you for an interview at <strong>${orgName}</strong>.
          </p>
          
          <!-- Interview Details Box -->
          <div style="background: linear-gradient(135deg, #f0f9fa 0%, #e8f4f5 100%); border-radius: 12px; padding: 24px; margin: 0 0 24px; border: 1px solid rgba(10, 122, 138, 0.2);">
            <div style="text-align: center;">
              <p style="color: ${primaryColor}; font-size: 13px; font-weight: 600; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                📅 Interview Details
              </p>
              <p style="color: ${textColor}; font-size: 20px; font-weight: 700; margin: 0 0 4px;">
                ${formattedDate}
              </p>
              <p style="color: ${primaryColor}; font-size: 24px; font-weight: 700; margin: 0 0 12px;">
                ${formattedTime}
              </p>
              <p style="color: #666; font-size: 14px; margin: 0;">
                📍 ${locationName}
              </p>
              ${locationAddress ? `
                <p style="color: #888; font-size: 13px; margin: 4px 0 0;">
                  ${locationAddress}
                </p>
              ` : ''}
            </div>
          </div>
          
          <!-- CTA Buttons -->
          <div style="text-align: center; margin: 24px 0;">
            <a href="${chatUrl}" style="display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 15px; margin-bottom: 12px;">
              ✓ Accept Interview
            </a>
            <p style="color: #888; font-size: 13px; margin: 12px 0 0;">
              Can't make it? <a href="${chatUrl}" style="color: ${primaryColor};">Request a different time</a>
            </p>
          </div>
          
          <!-- Calendar Add Info -->
          <div style="background-color: #fffbeb; border-radius: 8px; padding: 16px 20px; margin-top: 24px; border: 1px solid #fcd34d;">
            <p style="color: #92400e; font-size: 13px; font-weight: 600; margin: 0 0 8px;">
              📱 Add to your calendar:
            </p>
            <p style="color: #78350f; font-size: 13px; line-height: 1.6; margin: 0;">
              Open the attached <strong>interview.ics</strong> file to add this interview to your phone's calendar with automatic reminders.
            </p>
          </div>
          
          <!-- Instructions -->
          <div style="background-color: #f0f9fa; border-radius: 8px; padding: 16px 20px; margin-top: 16px;">
            <p style="color: ${primaryColor}; font-size: 13px; font-weight: 600; margin: 0 0 8px;">
              💬 Stay connected:
            </p>
            <p style="color: #666; font-size: 13px; line-height: 1.6; margin: 0;">
              Click the link above to open your chat. Add it to your home screen to get instant notifications about your application!
            </p>
          </div>
        </td>
      </tr>
      
      <!-- Footer -->
      <tr>
        <td style="background-color: #f8f7f5; padding: 24px 40px; border-top: 1px solid #e8e5df;">
          <table role="presentation" style="width: 100%;">
            <tr>
              <td style="text-align: center;">
                <img 
                  src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
                  alt="Powered by Croo" 
                  style="height: 24px; width: auto; margin-bottom: 8px; opacity: 0.5;"
                />
                <p style="color: #aaa; font-size: 11px; margin: 0;">
                  Powered by Croo • Team management made simple
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `);

    // Send the email with ICS attachment
    const emailResponse = await resend.emails.send({
      from: "CrooHQ Hiring <hiring@croohq.email>",
      to: [applicantEmail],
      subject: `Interview Invitation - ${orgName} on ${formattedDate}`,
      html: emailHtml,
      attachments: [
        {
          filename: "interview.ics",
          content: btoa(icsContent),
        },
      ],
    });

    console.log("Interview invite sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailId: emailResponse.data?.id }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in send-interview-invite function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
