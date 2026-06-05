import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function auth(): Promise<string | null> {
  const form = new FormData();
  form.append("grant_type", "client_credentials");
  form.append("client_id", Deno.env.get("QU_USERNAME")!);
  form.append("client_secret", Deno.env.get("QU_PASSWORD")!);
  const r = await fetch("https://gateway-api.qubeyond.com/api/v4/authentication/oauth2/access-token", { method: "POST", body: form });
  if (!r.ok) return null;
  return (await r.json()).access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const token = await auth();
  if (!token) return new Response("auth failed", { status: 502, headers: corsHeaders });
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "x-integration": Deno.env.get("QU_INTEGRATION_USER_ID") || "",
  };

  // From the previous probe:
  //  - kiosk dine-in:   checkId 6a230fc0f85aec73e1c03b56  (check# 260605180448274)
  //  - olo carry-out:   checkId 6a230ff7a07d581946d9a1a5  (check# 260605180543452 - Dave's kiosk carry-out test)
  //  - in-store:        checkId 6a230f7ae33ab1207af734ae  (check# 1000)
  //  - olo delivery:    checkId 6a2307d43628eaf2716644a5  (check# 260605173100516 - real 3rd-party)
  const targets = [
    { tag: "kiosk_dinein",  checkId: "6a230fc0f85aec73e1c03b56" },
    { tag: "olo_carry_kiosk_or_web", checkId: "6a230ff7a07d581946d9a1a5" },
    { tag: "in_store",      checkId: "6a230f7ae33ab1207af734ae" },
    { tag: "olo_delivery",  checkId: "6a2307d43628eaf2716644a5" },
  ];

  // Try several known sub-section endpoints on the check-detail report
  const sections = ["sub", "subreport", "details", "items", "payments", "header", "checkInfo"];
  const out: any = {};

  for (const t of targets) {
    out[t.tag] = {};
    for (const sec of sections) {
      const url = `https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/${sec}`;
      try {
        const r = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            params: { sectionId: sec, checkId: t.checkId, pageNumber: 1, pageSize: 100 },
          }),
        });
        const text = await r.text();
        out[t.tag][sec] = { status: r.status, body: text.slice(0, 1500) };
      } catch (e) {
        out[t.tag][sec] = { error: String(e) };
      }
    }
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
