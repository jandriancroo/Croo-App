import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { requireAuthorizedCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type UtilityRequest = {
  action: string;
  [key: string]: any;
};

// ============= CREATE TEST USERS =============
async function handleCreateTestUsers(req: Request, supabaseAdmin: any): Promise<Response> {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace('Bearer ', '');
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) {
      throw new Error("Invalid token");
    }

    const payloadJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson);
    const requestingUserId = payload.sub as string | undefined;

    if (!requestingUserId) {
      throw new Error("Unauthorized");
    }

    const body = await req.json().catch(() => ({}));
    const locationId = body.location_id;
    const singleUser = body.single_user;

    const { data: roleData, error: roleError } = await supabaseAdmin
      .rpc('has_role', { _user_id: requestingUserId, _role: 'admin' });

    if (roleError || !roleData) {
      throw new Error("Only admins can create test users");
    }

    const defaultTestUsers = [
      { email: 'marcus.johnson@example.com', name: 'Marcus Johnson', role: 'team_member' },
      { email: 'sofia.rodriguez@example.com', name: 'Sofia Rodriguez', role: 'team_member' },
      { email: 'tyler.chen@example.com', name: 'Tyler Chen', role: 'team_member' },
      { email: 'aisha.patel@example.com', name: 'Aisha Patel', role: 'team_member' },
      { email: 'jordan.williams@example.com', name: 'Jordan Williams', role: 'team_member' },
      { email: 'emma.thompson@example.com', name: 'Emma Thompson', role: 'team_member' },
      { email: 'diego.martinez@example.com', name: 'Diego Martinez', role: 'team_member' },
      { email: 'chloe.nguyen@example.com', name: 'Chloe Nguyen', role: 'team_member' },
      { email: 'ethan.brown@example.com', name: 'Ethan Brown', role: 'team_member' },
      { email: 'maya.jackson@example.com', name: 'Maya Jackson', role: 'team_member' },
      { email: 'liam.oconnor@example.com', name: 'Liam O\'Connor', role: 'team_member' },
      { email: 'zara.ahmed@example.com', name: 'Zara Ahmed', role: 'team_member' },
      { email: 'noah.kim@example.com', name: 'Noah Kim', role: 'team_member' },
      { email: 'olivia.garcia@example.com', name: 'Olivia Garcia', role: 'team_member' },
      { email: 'alex.davis@example.com', name: 'Alex Davis', role: 'team_member' },
      { email: 'jasmine.lee@example.com', name: 'Jasmine Lee', role: 'team_member' },
      { email: 'ryan.moore@example.com', name: 'Ryan Moore', role: 'team_member' },
      { email: 'isabella.taylor@example.com', name: 'Isabella Taylor', role: 'team_member' },
      { email: 'kevin.wright@example.com', name: 'Kevin Wright', role: 'team_member' },
      { email: 'hannah.clark@example.com', name: 'Hannah Clark', role: 'team_member' },
    ];

    const count = body.count ?? defaultTestUsers.length;
    const testUsers = singleUser 
      ? [singleUser] 
      : defaultTestUsers.slice(0, Math.min(count, defaultTestUsers.length));

    const createdUsers = [];
    const errors = [];

    for (const testUser of testUsers) {
      try {
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find((u: any) => u.email === testUser.email);
        
        let userId: string;
        
        if (existingUser) {
          userId = existingUser.id;
        } else {
          const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: testUser.email,
            password: 'TestPassword123!',
            email_confirm: true,
            user_metadata: {
              full_name: testUser.name,
            },
          });

          if (authError) throw authError;
          userId = authUser.user.id;
        }

        await supabaseAdmin
          .from('profiles')
          .update({
            is_active: true,
            appears_on_schedule: true,
            min_weekly_hours: 20,
            max_weekly_hours: 39,
          })
          .eq('id', userId);

        await supabaseAdmin
          .from('user_roles')
          .upsert({
            user_id: userId,
            role: testUser.role,
          }, { onConflict: 'user_id,role' });

        if (locationId) {
          await supabaseAdmin
            .from('user_locations')
            .upsert({
              user_id: userId,
              location_id: locationId,
            }, { onConflict: 'user_id,location_id' });
        }

        createdUsers.push({ email: testUser.email, id: userId, name: testUser.name });
      } catch (error: any) {
        errors.push({ email: testUser.email, error: error.message });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        created: createdUsers.length,
        users: createdUsers,
        errors,
        locationId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "An error occurred" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// ============= DELETE TIME PUNCHES =============
async function handleDeleteTimePunches(req: Request, supabaseAdmin: any): Promise<Response> {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await userClient.auth.getUser();

    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const locationId = body.location_id;
    const punchIds = body.punch_ids;

    if (!locationId || !Array.isArray(punchIds) || punchIds.length === 0) {
      return new Response(JSON.stringify({ error: "location_id and punch_ids are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: hasRole, error: roleErr } = await supabaseAdmin.rpc("has_role_or_higher", {
      _user_id: user.id,
      _minimum_role: "manager",
    });

    if (roleErr) throw roleErr;

    const { data: hasLocationAccess, error: accessErr } = await supabaseAdmin.rpc("has_location_access", {
      _user_id: user.id,
      _location_id: locationId,
    });

    if (accessErr) throw accessErr;

    if (!hasRole || !hasLocationAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: deleted, error: delErr } = await supabaseAdmin
      .from("time_punches")
      .delete()
      .in("id", punchIds)
      .eq("location_id", locationId)
      .select("id");

    if (delErr) throw delErr;

    return new Response(
      JSON.stringify({ ok: true, deleted_ids: (deleted ?? []).map((r: { id: string }) => r.id) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// ============= RESEND DIAGNOSTICS =============
async function handleResendDiagnostics(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") ?? "domains";
    const apiKey = Deno.env.get("RESEND_API_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "RESEND_API_KEY is not set" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
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
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
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

      const id = sendResult?.data?.id;
      const retrieveResult = id ? await callResend(`/emails/${id}`) : null;

      return new Response(
        JSON.stringify({
          success: sendResult.ok,
          send: sendResult,
          retrieve: retrieveResult,
        }),
        { status: sendResult.ok ? 200 : 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown mode: ${mode}` }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error?.message ?? String(error) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}

// ============= FETCH GIFS =============
async function handleFetchGifs(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const search = body.search;
    const apiKey = Deno.env.get('GIPHY_API_KEY');
    
    if (!apiKey) {
      throw new Error('GIPHY_API_KEY not configured');
    }

    const endpoint = search
      ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(search)}&limit=30&rating=pg-13`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=30&rating=pg-13`;

    const response = await fetch(endpoint);
    const data = await response.json();

    return new Response(JSON.stringify({ gifs: data.data || [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message, gifs: [] }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// ============= UPLOAD BRAND ASSET =============
async function handleUploadBrandAsset(req: Request, supabaseAdmin: any): Promise<Response> {
  try {
    const contentType = req.headers.get("content-type") || "";
    
    let uint8Array: Uint8Array;
    let fileName: string;
    let fileType: string;

    if (contentType.includes("application/json")) {
      const { url, name } = await req.json();
      if (!url || !name) {
        return new Response(
          JSON.stringify({ error: "URL and name are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      uint8Array = new Uint8Array(arrayBuffer);
      fileName = name;
      fileType = response.headers.get("content-type") || "image/png";
    } else {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      fileName = (formData.get("fileName") as string) || file.name;

      if (!file) {
        return new Response(
          JSON.stringify({ error: "No file provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      uint8Array = new Uint8Array(arrayBuffer);
      fileType = file.type;
    }

    const { data, error } = await supabaseAdmin.storage
      .from("brand-assets")
      .upload(fileName, uint8Array, {
        contentType: fileType,
        upsert: true,
      });

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("brand-assets")
      .getPublicUrl(fileName);

    return new Response(
      JSON.stringify({ success: true, url: urlData.publicUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// ============= SUBMIT QR TASK REPORT =============
async function handleSubmitQRTaskReport(req: Request, supabaseAdmin: any): Promise<Response> {
  try {
    const body = await req.json();
    const { task_id, location_id, selected_issues, guest_note } = body;

    if (!task_id || !location_id || !selected_issues?.length) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    // Rate limit check
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentReports } = await supabaseAdmin
      .from('qr_task_reports')
      .select('id')
      .eq('task_id', task_id)
      .eq('reporter_ip', clientIP)
      .gte('created_at', fiveMinutesAgo)
      .limit(1);

    if (recentReports && recentReports.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Please wait before submitting another report' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert report
    const { data: report, error: insertError } = await supabaseAdmin
      .from('qr_task_reports')
      .insert({
        task_id,
        location_id,
        selected_issues,
        guest_note,
        reporter_ip: clientIP,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting report:', insertError);
      throw insertError;
    }

    // Fetch task details for notification
    const { data: task } = await supabaseAdmin
      .from('temporary_tasks')
      .select('title, qr_notify_punch_clock, accent_color')
      .eq('id', task_id)
      .single();

    const { data: location } = await supabaseAdmin
      .from('locations')
      .select('name')
      .eq('id', location_id)
      .single();

    // Send push notification to managers
    const issuesText = selected_issues.join(', ');
    const notificationTitle = `🚨 ${task?.title || 'QR Alert'}`;
    const notificationBody = `Issues reported: ${issuesText}${guest_note ? ` - "${guest_note}"` : ''}`;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    try {
      await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          roles: ['manager', 'general_manager', 'admin', 'org_admin', 'super_admin'],
          location_id,
          title: notificationTitle,
          body: notificationBody,
          type: 'qr_task_report',
          data: {
            task_id,
            report_id: report.id,
            selected_issues,
          },
        }),
      });
    } catch (pushError) {
      console.error('Error sending push notification:', pushError);
    }

    console.log(`[QR Task Report] Created report ${report.id} for task ${task_id} at ${location?.name || location_id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        report_id: report.id,
        message: 'Report submitted successfully' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in submit-qr-task-report:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// ============= VERIFY TURNSTILE + UPLOAD RESUME =============
async function handleVerifyTurnstileUpload(req: Request, supabaseAdmin: any): Promise<Response> {
  try {
    const contentType = req.headers.get("content-type") || "";
    
    if (!contentType.includes("multipart/form-data")) {
      return new Response(
        JSON.stringify({ error: "Expected multipart/form-data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formData = await req.formData();
    const turnstileToken = formData.get("turnstile_token") as string;
    const file = formData.get("file") as File;
    const filePath = formData.get("file_path") as string;

    if (!turnstileToken) {
      return new Response(
        JSON.stringify({ error: "CAPTCHA verification required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!file || !filePath) {
      return new Response(
        JSON.stringify({ error: "File and file_path are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify Turnstile token with Cloudflare
    const secretKey = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!secretKey) {
      console.error("TURNSTILE_SECRET_KEY not configured");
      return new Response(
        JSON.stringify({ error: "CAPTCHA verification not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verifyResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: secretKey,
        response: turnstileToken,
      }),
    });

    const verifyResult = await verifyResponse.json();

    if (!verifyResult.success) {
      console.log("Turnstile verification failed:", verifyResult);
      return new Response(
        JSON.stringify({ error: "CAPTCHA verification failed. Please try again." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Turnstile passed — upload file via service role
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const { data, error } = await supabaseAdmin.storage
      .from("resumes")
      .upload(filePath, uint8Array, {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      console.error("Storage upload error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("resumes")
      .getPublicUrl(filePath);

    return new Response(
      JSON.stringify({ success: true, url: urlData.publicUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("verify-turnstile-upload error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Upload failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// ============= FLUSH INVENTORY COUNT =============
async function handleFlushInventoryCount(req: Request, supabaseAdmin: any): Promise<Response> {
  try {
    const body = await req.json();
    const { countId, itemCounts, elapsedSeconds } = body;

    if (!countId || !itemCounts || !Array.isArray(itemCounts)) {
      return new Response(
        JSON.stringify({ error: "Missing countId or itemCounts" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[flush_inventory_count] Flushing ${itemCounts.length} items for count ${countId}`);

    for (const ic of itemCounts) {
      const { data: existing } = await supabaseAdmin
        .from("inventory_count_items")
        .select("id, storage_location_id")
        .eq("count_id", countId)
        .eq("item_id", ic.item_id);

      const storLocId = ic.storage_location_id;
      const match = (existing || []).find((r: any) =>
        r.storage_location_id === storLocId ||
        (!storLocId && !r.storage_location_id)
      );

      if (match) {
        await supabaseAdmin
          .from("inventory_count_items")
          .update({
            quantity: ic.quantity,
            entered_cases: ic.entered_cases,
            entered_units: ic.entered_units,
            entered_inner_packs: ic.entered_inner_packs ?? null,
            cost_at_count: ic.cost_at_count ?? null,
            pack_quantity_at_count: ic.pack_quantity_at_count ?? null,
            inner_pack_quantity_at_count: ic.inner_pack_quantity_at_count ?? null,
            item_name_at_count: ic.item_name_at_count ?? null,
            unit_at_count: ic.unit_at_count ?? null,
            pan_sizes_at_count: ic.pan_sizes_at_count ?? null,
          })
          .eq("id", match.id);
      } else {
        await supabaseAdmin
          .from("inventory_count_items")
          .insert({
            count_id: countId,
            item_id: ic.item_id,
            quantity: ic.quantity,
            storage_location_id: storLocId,
            entered_cases: ic.entered_cases,
            entered_units: ic.entered_units,
            entered_inner_packs: ic.entered_inner_packs ?? null,
            cost_at_count: ic.cost_at_count ?? null,
            pack_quantity_at_count: ic.pack_quantity_at_count ?? null,
            inner_pack_quantity_at_count: ic.inner_pack_quantity_at_count ?? null,
            item_name_at_count: ic.item_name_at_count ?? null,
            unit_at_count: ic.unit_at_count ?? null,
            pan_sizes_at_count: ic.pan_sizes_at_count ?? null,
          });
      }
    }

    if (elapsedSeconds != null) {
      await supabaseAdmin
        .from("inventory_counts")
        .update({ duration_seconds: elapsedSeconds })
        .eq("id", countId);
    }

    console.log(`[flush_inventory_count] Done flushing count ${countId}`);
    return new Response(
      JSON.stringify({ success: true, flushed: itemCounts.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[flush_inventory_count] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Flush failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// ============= MAIN ROUTER =============
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "create-test-users";

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    switch (action) {
      case "create-test-users":
        return await handleCreateTestUsers(req, supabaseAdmin);
      case "delete-time-punches":
        return await handleDeleteTimePunches(req, supabaseAdmin);
      case "resend-diagnostics":
        return await handleResendDiagnostics(req);
      case "fetch-gifs":
        return await handleFetchGifs(req);
      case "upload-brand-asset":
        return await handleUploadBrandAsset(req, supabaseAdmin);
      case "submit-qr-task-report":
        return await handleSubmitQRTaskReport(req, supabaseAdmin);
      case "verify-turnstile-upload":
        return await handleVerifyTurnstileUpload(req, supabaseAdmin);
      case "flush_inventory_count": {
        // Writes inventory counts with service-role — signed-in users only.
        const denied = await requireAuthorizedCaller(req, corsHeaders);
        if (denied) return denied;
        return await handleFlushInventoryCount(req, supabaseAdmin);
      }
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
