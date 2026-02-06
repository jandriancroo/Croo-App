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

async function callAI(messages: any[], tools?: any[], toolChoice?: any) {
  const apiKey = getLovableApiKey();
  const body: any = {
    model: 'google/gemini-2.5-flash',
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
      const resumeResponse = await fetch(application.resume_url);
      if (resumeResponse.ok) {
        const contentType = resumeResponse.headers.get('content-type') || 'application/pdf';
        const arrayBuffer = await resumeResponse.arrayBuffer();
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
  const { imageUrl } = payload;
  if (!imageUrl) return errorResponse('Image URL is required', 400);

  const systemPrompt = `You are a temperature extraction assistant. Extract the exact numeric temperature value from thermometer images, including both digital LCD stick thermometers and analog round gauge thermometers. IMPORTANT: First, zoom all the way into the display area (LCD screen for digital or dial face for analog) to read the numbers clearly. For digital LCD stick thermometers: STEP 1 - FIND THE FAHRENHEIT INDICATOR FIRST. Look for a small degree symbol (°) with an 'F' below it in the TOP RIGHT corner of the LCD screen - this is the °F (degrees Fahrenheit) indicator. Use this °F to determine correct orientation - if it's not in the top right, you are reading the display upside down or sideways. STEP 2 - Once oriented correctly with °F in top right, read the numbers LEFT TO RIGHT sequentially. These use SEVEN-SEGMENT DISPLAYS where each digit is formed by illuminated bar segments. CRITICAL: Identify which segments are illuminated for each digit. For analog round gauge thermometers: STEP 1 - ROTATION REQUIRED. Mentally rotate the image until the 'NSF' text on the gauge face is right-side up and readable. STEP 2 - After rotation, zoom in very close until the circular gauge fills your view. STEP 3 - CRITICAL DECISION POINT: Determine which side of the gauge the needle is pointing to. If the needle points to the LEFT HALF, look for a BLUE LINE or BLUE COLORED ARC - this means you MUST read from the NEGATIVE temperature scale. VALIDATION RULES: COLD HOLDING (refrigerated items): Expect 28°F to 60°F. WALK-IN COOLER: Should be HIGHER than 30°F, typically 35-40°F. WALK-IN FREEZER: Should be BELOW 15°F. HOT HOLDING: Expect 130°F to 190°F. Return ONLY the numeric value with decimal if present (MUST include negative sign if reading from blue line), nothing else. If you cannot read a temperature, return 'NONE'.`;

  const userPrompt = `What is the temperature reading on this thermometer? Return only the numeric value.`;

  const data = await callAI([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ]);

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
  const { imageUrl } = payload;
  if (!imageUrl) return errorResponse('Image URL is required', 400);

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

  const data = await callAI(
    [
      { role: 'system', content: 'You are a catering order parser. Extract order details from images/PDFs. For customer_name, use the "Deliver To" name (the person/company receiving the order), NOT the ordering platform.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Parse this catering order. Extract customer name (use "Deliver To" name), order number, pickup date, pickup time, headcount, and all items with quantities. Dates are US format (MM/DD/YYYY).' },
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

async function handleParseInventoryVoice(payload: any) {
  const { transcript, items } = payload;
  if (!transcript || !items) return errorResponse('Missing transcript or items', 400);

  const itemNames = items.map((i: any) => i.item_name).join(', ');

  const systemPrompt = `You are an inventory voice command parser. Parse the user's spoken command to extract ONE OR MORE items with their quantities.

Available inventory items: ${itemNames}

Common patterns:
- "Cookies 5 cases" → item: Cookies, cases: 5, units: 0
- "Ranch 2 cases 3 units" → item: Ranch, cases: 2, units: 3
- "Chicken half a case" → item: Chicken, cases: 0.5, units: 0
- "5 cookies" → item: Cookies, cases: 5, units: 0

IMPORTANT: Users may say multiple items in one command. Extract ALL of them.

Respond ONLY with valid JSON:
{
  "commands": [
    {"item_name": "matched item name", "cases": 0, "units": 0, "confidence": "high|medium|low"}
  ]
}`;

  const data = await callAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: transcript }
  ]);

  const content = data.choices?.[0]?.message?.content || '';
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return errorResponse('No JSON found in response', 400);

    const parsed = JSON.parse(jsonMatch[0]);
    const commands = parsed.commands || [parsed];

    const results = commands.map((cmd: any) => {
      const matchedItem = items.find((i: any) => i.item_name.toLowerCase() === cmd.item_name.toLowerCase());
      return { ...cmd, matched_item_id: matchedItem?.item_id };
    });

    return jsonResponse({ commands: results });
  } catch (e) {
    console.error('[parse-inventory-voice] Parse error:', e);
    return errorResponse('Failed to parse AI response', 400);
  }
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
