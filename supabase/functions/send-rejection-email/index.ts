import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RejectionEmailRequest {
  applicationId: string;
  templateId: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { applicationId, templateId }: RejectionEmailRequest = await req.json();

    if (!applicationId || !templateId) {
      return new Response(
        JSON.stringify({ error: "applicationId and templateId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the application
    const { data: application, error: appError } = await supabase
      .from("job_applications")
      .select("id, full_name, email, organization_id")
      .eq("id", applicationId)
      .single();

    if (appError || !application) {
      console.error("Error fetching application:", appError);
      return new Response(
        JSON.stringify({ error: "Application not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the template
    const { data: template, error: templateError } = await supabase
      .from("rejection_email_templates")
      .select("*")
      .eq("id", templateId)
      .eq("organization_id", application.organization_id)
      .single();

    if (templateError || !template) {
      console.error("Error fetching template:", templateError);
      return new Response(
        JSON.stringify({ error: "Template not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch organization for branding
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", application.organization_id)
      .single();

    const orgName = org?.name || "Our Team";

    // Replace placeholders in template
    const subject = template.subject
      .replace(/{{name}}/gi, application.full_name)
      .replace(/{{first_name}}/gi, application.full_name.split(" ")[0])
      .replace(/{{organization}}/gi, orgName);

    const body = template.body
      .replace(/{{name}}/gi, application.full_name)
      .replace(/{{first_name}}/gi, application.full_name.split(" ")[0])
      .replace(/{{organization}}/gi, orgName);

    // Convert newlines to HTML breaks for email
    const htmlBody = body.replace(/\n/g, "<br>");

    // Send the email
    const emailResponse = await resend.emails.send({
      from: `${orgName} <onboarding@resend.dev>`,
      to: [application.email],
      subject: subject,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${htmlBody}
        </div>
      `,
    });

    console.log("Rejection email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailId: emailResponse.data?.id }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in send-rejection-email function:", error);
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
