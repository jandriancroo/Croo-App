import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") ?? "domains";

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "RESEND_API_KEY is not set" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const callResend = async (path: string, init?: RequestInit) => {
      const resp = await fetch(`https://api.resend.com${path}`, {
        ...(init ?? {}),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
      const data = await resp.json().catch(() => null);
      return { ok: resp.ok, status: resp.status, data };
    };

    if (mode === "domains") {
      const result = await callResend("/domains");
      return new Response(JSON.stringify({ success: result.ok, ...result }), {
        status: result.ok ? 200 : 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (mode === "sent") {
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const result = await callResend(`/emails?limit=${Number.isFinite(limit) ? limit : 20}`);
      return new Response(JSON.stringify({ success: result.ok, ...result }), {
        status: result.ok ? 200 : 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (mode === "send") {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      const to = body.to ?? url.searchParams.get("to");
      const subject = body.subject ?? url.searchParams.get("subject") ?? "Croo Diagnostics";
      const from = body.from ?? url.searchParams.get("from") ?? "CrooHQ <hello@croohq.email>";

      if (!to) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing 'to'" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }

      const sendResult = await callResend("/emails", {
        method: "POST",
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          html: `<p>Diagnostics email for <strong>${to}</strong> at ${new Date().toISOString()}</p>`,
        }),
      });

      // If Resend returned an id, try to retrieve delivery state immediately.
      const id = sendResult?.data?.id;
      const retrieveResult = id ? await callResend(`/emails/${id}`) : null;

      return new Response(
        JSON.stringify({
          success: sendResult.ok,
          send: sendResult,
          retrieve: retrieveResult,
        }),
        { status: sendResult.ok ? 200 : 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown mode: ${mode}` }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error?.message ?? String(error) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
