import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, supabaseKey);
}

function getLovableApiKey(): string {
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) throw new Error('LOVABLE_API_KEY is not configured');
  return key;
}

async function callAI(messages: any[], tools?: any[], toolChoice?: any, modelOverride?: string) {
  const apiKey = getLovableApiKey();
  const body: any = {
    model: modelOverride || 'google/gemini-2.5-flash',
    messages,
  };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw { status: 429, message: 'Rate limit exceeded. Please try again later.' };
    }
    if (response.status === 402) {
      throw { status: 402, message: 'AI credits exhausted. Please add credits.' };
    }
    const errorText = await response.text();
    console.error('AI gateway error:', response.status, errorText);
    throw { status: 500, message: 'AI service error' };
  }

  return response.json();
}

function errorResponse(message: string, status = 500) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

function jsonResponse(data: any, status = 200) {
  return new Response(
    JSON.stringify(data),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

async function handleAnalyzeApplication(payload: any) {
  const { applicationId } = payload;
  if (!applicationId) return errorResponse('applicationId is required', 400);

  const supabase = getSupabaseClient();

  const { data: application, error: fetchError } = await supabase
    .from('job_applications')
    .select(`*, work_history:job_application_work_history(*)`)
    .eq('id', applicationId)
    .single();

  if (fetchError || !application) {
    console.error('Error fetching application:', fetchError);
    return errorResponse('Application not found', 404);
  }

  let workHistory = application.work_history || [];

  // Parse resume if no work history
  if (workHistory.length === 0 && application.resume_url) {
    console.log('No work history, parsing resume:', application.resume_url);
    try {
      // The resumes bucket is PRIVATE — download through the service-role
      // storage client instead of hitting a (no longer valid) public URL.
      const resumePath = application.resume_url.split('/resumes/')[1];
      const resumeResponse = resumePath
        ? await supabase.storage.from('resumes').download(decodeURIComponent(resumePath))
        : { data: null, error: new Error('Unparseable resume path') };
      if (resumeResponse.data) {
        const blob = resumeResponse.data as Blob;
        const contentType = blob.type || 'application/pdf';
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(new Uint8Array(arrayBuffer).reduce((d, b) => d + String.fromCharCode(b), ''));

        const parseData = await callAI(
          [
            { role: 'system', content: 'You are a resume parser. Extract work history from resumes accurately.' },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Parse this resume and extract work history. Return ONLY the extracted data using the provided function.' },
                { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64}` } }
              ]
            }
          ],
          [{
            type: 'function',
            function: {
              name: 'extract_work_history',
              description: 'Extract work history from a resume',
              parameters: {
                type: 'object',
                properties: {
                  workHistory: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        employer_name: { type: 'string' },
                        job_title: { type: 'string' },
                        start_date: { type: 'string' },
                        end_date: { type: 'string' },
                        is_current: { type: 'boolean' }
                      },
                      required: ['employer_name', 'job_title']
                    }
                  }
                },
                required: ['workHistory']
              }
            }
          }],
          { type: 'function', function: { name: 'extract_work_history' } }
        );

        const toolCall = parseData.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          const parsed = JSON.parse(toolCall.function.arguments);
          if (parsed.workHistory?.length > 0) {
            const formatDate = (d: string | null) => {
              if (!d) return null;
              if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
              if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
              return null;
            };

            const historyPayload = parsed.workHistory.map((w: any, i: number) => ({
              application_id: applicationId,
              employer_name: w.employer_name || 'Unknown',
              job_title: w.job_title || 'Unknown',
              start_date: formatDate(w.start_date),
              end_date: w.is_current ? null : formatDate(w.end_date),
              is_current: w.is_current || false,
              display_order: i,
            }));

            const { data: insertedHistory } = await supabase
              .from('job_application_work_history')
              .insert(historyPayload)
              .select();

            if (insertedHistory) workHistory = insertedHistory;
          }
        }
      }
    } catch (e) {
      console.error('Error parsing resume:', e);
    }
  }

  const workHistoryText = workHistory.length > 0
    ? workHistory.map((wh: any) => `${wh.job_title || 'Unknown'} at ${wh.employer_name}`).join(', ')
    : 'No work history provided';

  const prompt = `Analyze this job applicant for a restaurant position.
Work History: ${workHistoryText}
Availability: ${JSON.stringify(application.availability || {})}

Respond with ONLY JSON:
{"isMatch": true/false, "matchReason": "Brief explanation (max 30 words)", "availabilityNote": "Brief availability note (max 20 words)"}`;

  const aiData = await callAI([
    { role: 'system', content: 'You are an HR assistant. Respond only with valid JSON.' },
    { role: 'user', content: prompt }
  ]);

  const content = aiData.choices?.[0]?.message?.content || '';
  let analysisResult = { isMatch: false, matchReason: '', availabilityNote: '' };
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) analysisResult = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('Error parsing AI response:', e);
  }

  const combinedReason = [
    analysisResult.matchReason,
    analysisResult.availabilityNote ? `Availability: ${analysisResult.availabilityNote}` : ''
  ].filter(Boolean).join(' | ');

  await supabase
    .from('job_applications')
    .update({
      ai_match: analysisResult.isMatch,
      ai_match_reason: combinedReason,
      ai_analyzed_at: new Date().toISOString(),
    })
    .eq('id', applicationId);

  return jsonResponse({
    success: true,
    isMatch: analysisResult.isMatch,
    matchReason: combinedReason,
    workHistoryExtracted: workHistory.length > 0,
  });
}

async function handleParseResume(payload: any) {
  const { resumeText, resumeBase64, mimeType } = payload;
  if (!resumeText && !resumeBase64) return errorResponse('Resume content is required', 400);

  let userContent: any;
  if (resumeBase64) {
    userContent = [
      { type: 'text', text: 'Parse this resume and extract the applicant\'s information. Return ONLY the extracted data using the provided function.' },
      { type: 'image_url', image_url: { url: `data:${mimeType || 'application/pdf'};base64,${resumeBase64}` } }
    ];
  } else {
    userContent = `Parse this resume and extract information.\n\nResume:\n${resumeText}`;
  }

  const data = await callAI(
    [
      { role: 'system', content: 'You are a resume parser. Extract applicant information accurately.' },
      { role: 'user', content: userContent }
    ],
    [{
      type: 'function',
      function: {
        name: 'extract_resume_data',
        description: 'Extract structured data from a resume',
        parameters: {
          type: 'object',
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            workHistory: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  employer_name: { type: 'string' },
                  job_title: { type: 'string' },
                  start_date: { type: 'string' },
                  end_date: { type: 'string' },
                  is_current: { type: 'boolean' }
                },
                required: ['employer_name', 'job_title', 'start_date', 'end_date', 'is_current']
              }
            }
          },
          required: ['firstName', 'lastName', 'email', 'phone', 'workHistory']
        }
      }
    }],
    { type: 'function', function: { name: 'extract_resume_data' } }
  );

  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    return jsonResponse({ success: true, data: JSON.parse(toolCall.function.arguments) });
  }

  const content = data.choices?.[0]?.message?.content;
  if (content) {
    try {
      return jsonResponse({ success: true, data: JSON.parse(content) });
    } catch { /* ignore */ }
  }

  return errorResponse('Failed to parse resume', 500);
}

async function handleExtractTemperature(payload: any) {
  const { imageUrl, itemName } = payload;
  if (!imageUrl) return errorResponse('Image URL is required', 400);

  const systemPrompt = `You are an expert temperature extraction assistant for restaurant food safety. You read both digital LCD stick thermometers and analog round dial gauge thermometers.

=== ANALOG ROUND DIAL GAUGE THERMOMETERS (most common) ===

These are circular gauges typically made by Taylor, with TWO scales:
- OUTER RING: Fahrenheit (°F) — this is the scale we need
- INNER RING: Celsius (°C) — ignore this

ANATOMY OF THE DIAL — CRITICAL LAYOUT:
The gauge face is a ~270° arc (not a full circle). The scale runs CLOCKWISE:
- The arc STARTS at roughly 7 o'clock position with the lowest value (around -20°F)
- The arc ENDS at roughly 5 o'clock position with the highest value (around 80°F)
- There is a GAP at the bottom (roughly 5-7 o'clock) with no scale

COLOR ZONES on the dial face (painted arcs):
- BLUE ARC: Covers roughly 7 o'clock to 10 o'clock. Labeled "FREEZER". Range: -20°F to ~20°F
- WHITE/CLEAR zone: Covers roughly 10 o'clock to 12-1 o'clock. Labeled "REF." (refrigerator safe). Range: ~28°F to ~40°F
- RED ARC: Covers roughly 1 o'clock to 5 o'clock. Labeled "DANGER ZONE". Range: ~40°F to 80°F

TICK MARKS: Major ticks every 10°F, minor ticks every 2°F. Each small notch = 2°F.

STEP-BY-STEP READING PROCESS:
1. IDENTIFY THE NEEDLE: Find the single metal pointer/needle.
2. DETERMINE WHICH COLOR ZONE the needle tip is in — this is your PRIMARY clue.
3. COUNT TICK MARKS from the nearest labeled number or zone boundary to get the exact reading.
4. ZONE-BASED ESTIMATION when numbers are cut off:
   - Needle deep in BLUE arc (7-8 o'clock) → -20°F to 0°F
   - Needle at left edge of BLUE (8-9 o'clock) → 0°F to 10°F
   - Needle at top of BLUE (9-10 o'clock) → 10°F to 20°F
   - Needle leaving BLUE, entering WHITE (10-11 o'clock) → 20°F to 30°F
   - Needle in WHITE zone (11-12 o'clock) → 30°F to 36°F
   - Needle at right side of WHITE (12-1 o'clock) → 36°F to 40°F
   - Needle at BOUNDARY of WHITE and RED → exactly 40°F
   - Needle ONE NOTCH past WHITE into RED → 42°F
   - Needle TWO NOTCHES into RED → 44°F
   - Needle clearly in RED (1-2 o'clock) → 42°F to 55°F
   - Needle mid RED (2-3 o'clock) → 55°F to 65°F
   - Needle deep RED (3-5 o'clock) → 65°F to 80°F

5. CROSS-VALIDATION RULES (MANDATORY):
   - If needle is in RED zone, temperature MUST be ≥ 40°F. Never return a value below 40 for a red-zone needle.
   - If needle is in BLUE zone, temperature MUST be ≤ 20°F. Never return a value above 20 for a blue-zone needle.
   - If needle is in WHITE zone, temperature MUST be between 28°F and 40°F.
   - If needle is RIGHT of center/top of gauge → it is ABOVE 35°F, not below.
   - If needle is LEFT of center/top of gauge → it is BELOW 35°F, not above.

6. CONTEXT CHECK: The item name may hint at expected range:
   - "Walk-In Cooler" → expect 34-42°F (needle should be in WHITE or just barely RED)
   - "Walk-In Freezer" → expect -10°F to 10°F (needle should be in BLUE)
   - "Reach-In" → expect 34-41°F
   Do NOT force the reading to match expected range, but USE this as a sanity check.

7. COMMON PHOTO ISSUES:
   - Photos at angles: focus on needle position relative to color arcs, not numbers
   - Numbers cut off: use color zone + tick count from zone boundary
   - Blurry: the COLOR ZONE is the most reliable indicator
   - Condensation: look for needle silhouette against color bands

=== DIGITAL LCD STICK THERMOMETERS ===
STEP 1: Find °F indicator (usually top-right of LCD). Use it to orient.
STEP 2: Read seven-segment digits LEFT to RIGHT once properly oriented.

=== OUTPUT ===
Return ONLY the numeric Fahrenheit value (include negative sign if applicable, decimal if visible).
If truly unreadable, return 'NONE'.
Do NOT return ranges — give your single best estimate.`;

  const itemContext = itemName ? ` The item being measured is: "${itemName}".` : '';
  const userPrompt = `Read the temperature on this thermometer.${itemContext} Even if numbers are partially cut off, use the needle position relative to the color zones (blue=freezer, white=refrigerator safe, red=danger) and count tick marks from zone boundaries. Return only the numeric Fahrenheit value.`;

  // Use pro model for better accuracy on visual temperature reading
  const data = await callAI([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ], undefined, undefined, 'google/gemini-2.5-pro');

  const extractedText = data.choices?.[0]?.message?.content?.trim() || 'NONE';
  let temperature: number | null = null;
  let isValid = false;

  if (extractedText !== 'NONE') {
    const tempMatch = extractedText.match(/[-+]?\d+\.?\d*/);
    if (tempMatch) {
      temperature = parseFloat(tempMatch[0]);
      isValid = temperature <= 41.0 || temperature >= 135.0;
    }
  }

  return jsonResponse({ temperature, isValid, extractedText });
}

async function handleExtractAuditDate(payload: any) {
  const { imageUrl, imageBase64 } = payload;
  if (!imageUrl && !imageBase64) return errorResponse('Image URL or base64 data required', 400);

  const imageContent = imageBase64
    ? { type: 'image_url', image_url: { url: imageBase64 } }
    : { type: 'image_url', image_url: { url: imageUrl } };

  const systemPrompt = `You are an expert at reading Food Safety Audit documents and extracting dates.
Analyze the document and find the audit/inspection date.

IMPORTANT: Look specifically for a date next to or near the word "Start" - this is the audit date.
Also look for text like "Audit Date:", "Inspection Date:", "Date:", or similar.

CRITICAL DATE FORMAT RULES:
- These are US documents, so dates are in US format: MM/DD/YYYY (Month/Day/Year)
- For example: 08/11/2025 means August 11, 2025 (NOT November 8)

IMPORTANT: Return ONLY a JSON object with no other text. Format:
{"audit_date": "YYYY-MM-DD", "confidence": "high|medium|low"}

If you cannot find a date, return:
{"audit_date": null, "confidence": "none"}`;

  const data = await callAI([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Please analyze this food safety audit document and extract the audit date.' },
        imageContent
      ]
    }
  ]);

  const content = data.choices?.[0]?.message?.content || '';
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return jsonResponse({
        success: true,
        audit_date: parsed.audit_date,
        confidence: parsed.confidence || 'medium'
      });
    }
  } catch (e) {
    console.error('[extract-audit-date] Failed to parse AI response:', e);
  }

  return jsonResponse({ success: false, audit_date: null, confidence: 'none', raw_response: content });
}

async function handleExtractAuditSummary(payload: any) {
  const { imageUrl, imageBase64 } = payload;
  if (!imageUrl && !imageBase64) return errorResponse('Image URL or base64 data required', 400);

  const imageContent = imageBase64
    ? { type: 'image_url', image_url: { url: imageBase64 } }
    : { type: 'image_url', image_url: { url: imageUrl } };

  const systemPrompt = `You are an expert at reading Food Safety Audit documents.
Analyze the document and extract:
1. MANAGER NAME - Look for "Manager" field near the top
2. VISIT SCORE - Look for "THIS VISIT" section - return the NUMBER only
3. PRIORITY ITEMS - Extract ALL items under each priority category

IMPORTANT: Return ONLY a JSON object:
{
  "manager_name": "Name",
  "visit_score": "95.00",
  "first_priority_items": ["Item 1", "Item 2"],
  "second_priority_items": ["Item 1"],
  "third_priority_items": ["Item 1"],
  "audit_date": "YYYY-MM-DD" or null
}`;

  const data = await callAI([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Please analyze this food safety audit document and extract all details.' },
        imageContent
      ]
    }
  ]);

  const content = data.choices?.[0]?.message?.content || '';
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return jsonResponse({
        success: true,
        manager_name: parsed.manager_name || null,
        visit_score: parsed.visit_score || null,
        first_priority_items: parsed.first_priority_items || [],
        second_priority_items: parsed.second_priority_items || [],
        third_priority_items: parsed.third_priority_items || [],
        audit_date: parsed.audit_date || null
      });
    }
  } catch (e) {
    console.error('[extract-audit-summary] Failed to parse:', e);
  }

  return jsonResponse({
    success: false,
    visit_score: null,
    first_priority_items: [],
    second_priority_items: [],
    third_priority_items: [],
    raw_response: content
  });
}

async function handleExtractCertificationDate(payload: any) {
  const { imageUrl, imageBase64 } = payload;
  if (!imageUrl && !imageBase64) return errorResponse('Image URL or base64 data required', 400);

  const imageContent = imageBase64
    ? { type: 'image_url', image_url: { url: imageBase64 } }
    : { type: 'image_url', image_url: { url: imageUrl } };

  const systemPrompt = `You are an expert at reading US food safety certificates and extracting expiration dates.
Look for "Expires:", "Expiration Date:", "Valid Until:", "Exp:", or similar.

CRITICAL DATE FORMAT RULES:
- US format: MM/DD/YYYY (Month/Day/Year)
- 08/11/2027 means August 11, 2027 (NOT November 8)

IMPORTANT: Return ONLY a JSON object:
{"expiration_date": "YYYY-MM-DD", "confidence": "high|medium|low", "certificate_type": "food_handlers|servsafe|other"}

If you cannot find a date:
{"expiration_date": null, "confidence": "none", "certificate_type": "unknown"}`;

  const data = await callAI([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Please analyze this certificate image and extract the expiration date.' },
        imageContent
      ]
    }
  ]);

  const content = data.choices?.[0]?.message?.content || '';
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return jsonResponse({
        success: true,
        expiration_date: parsed.expiration_date,
        confidence: parsed.confidence || 'medium',
        certificate_type: parsed.certificate_type || 'unknown'
      });
    }
  } catch (e) {
    console.error('[extract-certification-date] Failed to parse:', e);
  }

  return jsonResponse({
    success: false,
    expiration_date: null,
    confidence: 'none',
    certificate_type: 'unknown',
    raw_response: content
  });
}

async function handleParseCateringOrder(payload: any) {
  const { imageUrl, timezone } = payload;
  if (!imageUrl) return errorResponse('Image URL is required', 400);
  const tz = timezone || 'America/Los_Angeles';

  // Fetch and convert to base64
  const fileResponse = await fetch(imageUrl);
  if (!fileResponse.ok) return errorResponse(`Failed to fetch file: ${fileResponse.status}`, 500);

  const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await fileResponse.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  const base64Data = btoa(binary);

  let mimeType = contentType;
  if (imageUrl.toLowerCase().endsWith('.pdf') || contentType.includes('pdf')) mimeType = 'application/pdf';
  else if (imageUrl.toLowerCase().includes('.png') || contentType.includes('png')) mimeType = 'image/png';
  else if (imageUrl.toLowerCase().includes('.jpg') || imageUrl.toLowerCase().includes('.jpeg') || contentType.includes('jpeg')) mimeType = 'image/jpeg';

  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  // Anchor date parsing to today in the LOCATION's timezone to avoid year-guessing bugs
  // (e.g. Gemini returning 2024 for an order created in 2026 when the year is ambiguous
  // or when it accidentally grabs the "order received" date instead of pickup date).
  const todayLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const currentYearLocal = todayLocal.slice(0, 4);

  const data = await callAI(
    [
      { role: 'system', content: `You are a catering order parser. Extract order details from images/PDFs. For customer_name, use the "Deliver To" name (the person/company receiving the order), NOT the ordering platform. Today's date is ${todayLocal} (${tz}). The pickup_date is the date the food must be ready for the customer — it is always today or in the future, NEVER in the past. If the document does not show an explicit pickup year, assume ${currentYearLocal} (or ${Number(currentYearLocal) + 1} if the month/day has already passed this year). Do not copy the order-received / order-placed date into pickup_date.` },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Parse this catering order. Extract customer name (use "Deliver To" name), order number, pickup date, pickup time, headcount, and all items with quantities. Dates are US format (MM/DD/YYYY). Today is ${todayLocal} — pickup_date must be today or later.` },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ],
    [{
      type: 'function',
      function: {
        name: 'extract_order_details',
        description: 'Extract catering order details from an image',
        parameters: {
          type: 'object',
          properties: {
            customer_name: { type: 'string' },
            order_number: { type: 'string' },
            pickup_date: { type: 'string', description: 'YYYY-MM-DD format' },
            pickup_time: { type: 'string', description: 'HH:MM format (24-hour)' },
            headcount: { type: 'number' },
            contact_phone: { type: 'string' },
            total_price: { type: 'number' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: { quantity: { type: 'number' }, item: { type: 'string' }, notes: { type: 'string' } },
                required: ['quantity', 'item']
              }
            },
            notes: { type: 'string' }
          },
          required: ['customer_name', 'pickup_date', 'pickup_time', 'items']
        }
      }
    }],
    { type: 'function', function: { name: 'extract_order_details' } }
  );

  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== 'extract_order_details') {
    return errorResponse('Failed to extract order details', 500);
  }

  return jsonResponse({ success: true, data: JSON.parse(toolCall.function.arguments) });
}

// Audio-based voice parsing: accepts base64 audio, transcribes + matches in one Gemini call
async function handleParseInventoryAudio(payload: any) {
  const { audioBase64, mimeType, items } = payload;
  if (!audioBase64 || !items) return errorResponse('Missing audioBase64 or items', 400);

  const itemNames = items.map((i: any) => i.item_name).join(', ');

  const systemPrompt = `You are an inventory voice command parser for a restaurant. Listen to the audio and extract item counts.

Available inventory items: ${itemNames}

Rules:
- Match spoken item names to the closest available item (fuzzy match ok)
- "cases" / "cs" / "boxes" = cases field
- "units" / "ea" / "each" / "pieces" = units field
- A plain number with no unit keyword = cases (default)
- "half" = 0.5, "a" = 1
- Extract ALL items mentioned
- Use the EXACT item_name from the list above
- Also return the full transcript of what was said`;

  const audioDataUrl = `data:${mimeType || 'audio/webm;codecs=opus'};base64,${audioBase64}`;

  const data = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-lite',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Listen to this audio and extract inventory counts. Return the transcript and parsed items.' },
            { type: 'image_url', image_url: { url: audioDataUrl } }
          ]
        }
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'record_inventory_from_audio',
          description: 'Record inventory counts parsed from audio',
          parameters: {
            type: 'object',
            properties: {
              transcript: { type: 'string', description: 'Full text transcript of what was said' },
              commands: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    item_name: { type: 'string', description: 'Exact item name from the available list' },
                    cases: { type: 'number', description: 'Number of cases (default 0)' },
                    units: { type: 'number', description: 'Number of units (default 0)' },
                  },
                  required: ['item_name', 'cases', 'units'],
                  additionalProperties: false,
                }
              }
            },
            required: ['transcript', 'commands'],
            additionalProperties: false,
          }
        }
      }],
      tool_choice: { type: 'function', function: { name: 'record_inventory_from_audio' } },
    }),
  });

  if (!data.ok) {
    const errText = await data.text();
    console.error('[parse-inventory-audio] AI error:', data.status, errText);
    return errorResponse('AI service error', 500);
  }

  const json = await data.json();
  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    return jsonResponse({ transcript: '', commands: [] });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch (e) {
    console.error('[parse-inventory-audio] JSON parse error:', e);
    return jsonResponse({ transcript: '', commands: [] });
  }

  // Match AI-returned item names back to item IDs
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const results = (parsed.commands || []).map((cmd: any) => {
    const normCmd = normalize(cmd.item_name);
    let matchedItem = items.find((i: any) => normalize(i.item_name) === normCmd);
    if (!matchedItem) {
      matchedItem = items.find((i: any) => normalize(i.item_name).includes(normCmd) || normCmd.includes(normalize(i.item_name)));
    }
    return {
      item_name: matchedItem?.item_name || cmd.item_name,
      matched_item_id: matchedItem?.item_id || null,
      cases: cmd.cases || 0,
      units: cmd.units || 0,
      confidence: matchedItem ? 'high' : 'low',
    };
  }).filter((cmd: any) => cmd.matched_item_id);

  return jsonResponse({ transcript: parsed.transcript || '', commands: results });
}

async function handleParseInventoryVoice(payload: any) {
  const { transcript, items } = payload;
  if (!transcript || !items) return errorResponse('Missing transcript or items', 400);

  const itemNames = items.map((i: any) => i.item_name).join(', ');

  const systemPrompt = `You are an inventory voice command parser for a restaurant. Your job is to extract item counts from spoken commands.

Available inventory items: ${itemNames}

Rules:
- Match spoken item names to the closest available item (fuzzy match ok)
- "cases" / "cs" / "boxes" = cases field
- "units" / "ea" / "each" / "pieces" = units field
- A plain number with no unit keyword = cases (default)
- "half" = 0.5, "a" = 1
- Extract ALL items mentioned in one command
- Use the EXACT item_name from the list above`;

  // Use tool calling for structured output — faster and more reliable than JSON parsing
  const data = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-lite',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript }
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'record_inventory_counts',
          description: 'Record inventory counts parsed from voice command',
          parameters: {
            type: 'object',
            properties: {
              commands: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    item_name: { type: 'string', description: 'Exact item name from the available list' },
                    cases: { type: 'number', description: 'Number of cases (default 0)' },
                    units: { type: 'number', description: 'Number of units (default 0)' },
                  },
                  required: ['item_name', 'cases', 'units'],
                  additionalProperties: false,
                }
              }
            },
            required: ['commands'],
            additionalProperties: false,
          }
        }
      }],
      tool_choice: { type: 'function', function: { name: 'record_inventory_counts' } },
    }),
  });

  if (!data.ok) {
    const errText = await data.text();
    console.error('[parse-inventory-voice] AI error:', data.status, errText);
    return errorResponse('AI service error', 500);
  }

  const json = await data.json();
  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    return errorResponse('No tool call in AI response', 500);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch (e) {
    console.error('[parse-inventory-voice] JSON parse error:', e);
    return errorResponse('Failed to parse AI response', 500);
  }

  // Match AI-returned item names back to item IDs using fuzzy search
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const results = (parsed.commands || []).map((cmd: any) => {
    const normCmd = normalize(cmd.item_name);
    // Exact match first
    let matchedItem = items.find((i: any) => normalize(i.item_name) === normCmd);
    // Substring match fallback
    if (!matchedItem) {
      matchedItem = items.find((i: any) => normalize(i.item_name).includes(normCmd) || normCmd.includes(normalize(i.item_name)));
    }
    return {
      item_name: matchedItem?.item_name || cmd.item_name,
      matched_item_id: matchedItem?.item_id || null,
      cases: cmd.cases || 0,
      units: cmd.units || 0,
      confidence: matchedItem ? 'high' : 'low',
    };
  }).filter((cmd: any) => cmd.matched_item_id); // Drop unmatched items

  return jsonResponse({ commands: results });
}

// ============================================================================
// RESCAN TEMPERATURES
// ============================================================================

async function handleRescanTemperatures(payload: any) {
  const supabase = getSupabaseClient();
  const scanDate = payload.targetDate || new Date().toISOString().split('T')[0];

  console.log(`Rescanning temperatures for date: ${scanDate}`);

  const { data: responses, error: fetchError } = await supabase
    .from('checklist_responses')
    .select(`
      id,
      response_image_url,
      extracted_temperature,
      item_id,
      checklist_items(question)
    `)
    .not('response_image_url', 'is', null)
    .gte('created_at', `${scanDate}T00:00:00`)
    .lte('created_at', `${scanDate}T23:59:59`);

  if (fetchError) {
    console.error("Error fetching responses:", fetchError);
    return errorResponse("Failed to fetch temperature readings", 500);
  }

  if (!responses || responses.length === 0) {
    return jsonResponse({ message: "No temperature readings found for this date", results: [], summary: { total: 0 } });
  }

  console.log(`Found ${responses.length} temperature readings to rescan`);

  const results: any[] = [];

  for (const response of responses) {
    try {
      const item = (response.checklist_items as any)?.[0] || (response.checklist_items as any);
      const question = item?.question || 'Unknown';

      const extractResult = await handleExtractTemperature({ imageUrl: response.response_image_url });
      const extractData = await extractResult.json();

      if (extractResult.status !== 200) {
        results.push({
          id: response.id,
          question,
          success: false,
          error: extractData.error || 'Extraction failed',
          previousTemp: response.extracted_temperature
        });
        continue;
      }

      const { temperature, isValid } = extractData;

      const { error: updateError } = await supabase
        .from('checklist_responses')
        .update({
          extracted_temperature: temperature,
          temperature_valid: isValid,
          temperature_validated_at: new Date().toISOString()
        })
        .eq('id', response.id);

      if (updateError) {
        results.push({
          id: response.id,
          question,
          success: false,
          error: updateError.message,
          previousTemp: response.extracted_temperature,
          newTemp: temperature
        });
        continue;
      }

      results.push({
        id: response.id,
        question,
        success: true,
        previousTemp: response.extracted_temperature,
        newTemp: temperature,
        isValid: isValid,
        changed: response.extracted_temperature !== temperature
      });
    } catch (error) {
      const item = (response.checklist_items as any)?.[0] || (response.checklist_items as any);
      results.push({
        id: response.id,
        question: item?.question || "Unknown",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        previousTemp: response.extracted_temperature
      });
    }
  }

  const summary = {
    total: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    changed: results.filter(r => r.changed).length
  };

  return jsonResponse({ summary, results });
}

// ============================================================================
// BATCH ANALYZE APPLICATIONS
// ============================================================================

async function handleBatchAnalyzeApplications(payload: any) {
  const supabase = getSupabaseClient();
  const { locationId, limit = 50 } = payload;

  let query = supabase
    .from('job_applications')
    .select('id, full_name, resume_url')
    .is('ai_analyzed_at', null)
    .order('submitted_at', { ascending: false })
    .limit(limit);

  if (locationId) {
    query = query.eq('location_id', locationId);
  }

  const { data: applications, error: fetchError } = await query;

  if (fetchError) {
    console.error('Error fetching applications:', fetchError);
    return errorResponse('Failed to fetch applications', 500);
  }

  console.log(`Found ${applications?.length || 0} unanalyzed applications`);

  const results: Array<{ id: string; name: string; success: boolean; isMatch?: boolean; error?: string }> = [];

  for (const app of applications || []) {
    console.log(`Analyzing: ${app.full_name} (${app.id})`);
    
    try {
      const analysisResult = await handleAnalyzeApplication({ applicationId: app.id });
      const data = await analysisResult.json();

      if (analysisResult.status === 200 && data.success) {
        results.push({
          id: app.id,
          name: app.full_name,
          success: true,
          isMatch: data.isMatch,
        });
      } else {
        results.push({
          id: app.id,
          name: app.full_name,
          success: false,
          error: data.error || 'Unknown error',
        });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      results.push({
        id: app.id,
        name: app.full_name,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const matchCount = results.filter(r => r.isMatch).length;

  return jsonResponse({
    success: true,
    processed: results.length,
    successful: successCount,
    matches: matchCount,
    results,
  });
}

// ============================================================================
// MAIN ROUTER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const payload = await req.json();

    console.log(`[ai-extraction-service] Action: ${action}`);

    switch (action) {
      case 'analyze-application':
        return await handleAnalyzeApplication(payload);
      case 'parse-resume':
        return await handleParseResume(payload);
      case 'extract-temperature':
        return await handleExtractTemperature(payload);
      case 'extract-audit-date':
        return await handleExtractAuditDate(payload);
      case 'extract-audit-summary':
        return await handleExtractAuditSummary(payload);
      case 'extract-certification-date':
        return await handleExtractCertificationDate(payload);
      case 'parse-catering-order':
        return await handleParseCateringOrder(payload);
      case 'parse-inventory-audio':
        return await handleParseInventoryAudio(payload);
      case 'parse-inventory-voice':
        return await handleParseInventoryVoice(payload);
      case 'rescan-temperatures':
        return await handleRescanTemperatures(payload);
      case 'batch-analyze-applications':
        return await handleBatchAnalyzeApplications(payload);
      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (error: any) {
    console.error('[ai-extraction-service] Error:', error);
    const status = error.status || 500;
    const message = error.message || (error instanceof Error ? error.message : 'Unknown error');
    return errorResponse(message, status);
  }
});
