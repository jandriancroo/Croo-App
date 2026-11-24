import { decideReads, needsTiebreak, applyBands, type TempRead } from './temperatureDecision.ts';
import { parseTempReply } from './parseTempReply.ts';
import { asEquipmentType, possibleRange, TEMP_BANDS } from '../_shared/tempBands.ts';
import { straightener, parseOrientTilt, totalCcw, ORIENT_TILT_PROMPT } from './orient.ts';
import { readDialWithLuna, LUNA_DIAL_MODEL, type LunaRead } from './lunaDial.ts';
import { planBackgroundOutcome, jumpCheck, isCurrentReadToken, BG_READ_BUDGET_MS } from '../_shared/bgTempRead.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
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

async function callAI(messages: any[], tools?: any[], toolChoice?: any, modelOverride?: string, signal?: AbortSignal, extraBody?: Record<string, unknown>) {
  const apiKey = getLovableApiKey();
  const body: any = {
    model: modelOverride || 'google/gemini-2.5-flash',
    messages,
  };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;
  // Background temp path only (e.g. reasoning_effort); every other call sends nothing extra.
  if (extraBody) Object.assign(body, extraBody);

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw { status: 429, message: 'Rate limit exceeded. Please try again later.' };
    }
    if (response.status === 402) {
      throw { status: 402, message: 'AI credits exhausted. Please add credits.' };
    }
    // Read and discard the body: it is never logged.
    await response.text().catch(() => '');
    console.error('AI gateway error:', response.status);
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

// Every thermometer read (both parallel reads and the tie-break) uses this model, all stores.
const TEMP_READ_MODEL = 'google/gemini-3.1-flash-lite';

type CallAIFn = typeof callAI;

// The one line that differs between today's read prompt and the benchmark's
// 'already turned' prompt (used only after the digital orient pass turned the photo).
const TAKEN_AS_IS_LINE = '- The photo is exactly as the crew took it: the display may be rotated 90°, 180° or 270°, tilted, or mirrored by the angle. Before reading, work out which way is UP.';
const ALREADY_TURNED_LINE = '- The photo has usually already been turned and straightened so the display is upright, but check: it may still be rotated or tilted. Before reading, work out which way is UP.';

async function handleExtractTemperature(payload: any) {
  if (!payload?.imageUrl) return errorResponse('Image URL is required', 400);
  // digital_orient_reads_enabled (default off). Missing locationId (old
  // clients), a failed lookup or the switch off → exactly today's read.
  const locationId = typeof payload?.locationId === 'string' && UUID_RE.test(payload.locationId) ? payload.locationId : null;
  let digitalOrient = false;
  if (locationId) {
    try {
      const { data: ls } = await getSupabaseClient().from('location_settings').select('digital_orient_reads_enabled').eq('location_id', locationId).maybeSingle();
      digitalOrient = (ls as any)?.digital_orient_reads_enabled === true;
    } catch { digitalOrient = false; }
  }
  if (!digitalOrient) return jsonResponse(await readTemperature(payload));
  const t0 = Date.now();
  const usage: BgUsage[] = [];
  const result = await readTemperature(payload, { digitalOrient: true, ai: recordingCallAI(usage) });
  console.log('[extract-temperature] usage', JSON.stringify({ path: 'live_orient', route: result?.readerRoute ?? null, ms: Date.now() - t0, calls: usage }));
  return jsonResponse(result);
}

/** Live digital-orient path only: same callAI (no retry), records per-call usage for the cost log. */
function recordingCallAI(usage: BgUsage[]): CallAIFn {
  return async (messages, tools, toolChoice, modelOverride, signal, extraBody) => {
    const { __stage, ...rest } = (extraBody ?? {}) as Record<string, unknown>;
    const body = Object.keys(rest).length ? rest : undefined;
    const model = modelOverride || 'google/gemini-2.5-flash';
    const stage = model === LUNA_DIAL_MODEL ? 'dial' : typeof __stage === 'string' ? __stage : 'read';
    const t = Date.now();
    try {
      const data = await callAI(messages, tools, toolChoice, modelOverride, signal, body);
      usage.push(usageEntry(model, stage, data, true, Date.now() - t));
      return data;
    } catch (e) {
      usage.push(usageEntry(model, stage, null, false, Date.now() - t));
      throw e;
    }
  };
}

function usageEntry(model: string, stage: string, data: any, ok: boolean, ms: number): BgUsage {
  const u = data?.usage;
  return {
    model, stage, ok, ms,
    prompt_tokens: typeof u?.prompt_tokens === 'number' ? u.prompt_tokens : null,
    completion_tokens: typeof u?.completion_tokens === 'number' ? u.completion_tokens : null,
    reasoning_tokens: typeof u?.completion_tokens_details?.reasoning_tokens === 'number' ? u.completion_tokens_details.reasoning_tokens : null,
  };
}

/**
 * The thermometer read itself. The live action (extract-temperature) calls it
 * with no options, exactly as before. The background action passes
 * { background: true, ai }: dials go to Luna's background mode (low effort,
 * no orient, 2 reads + one tie-break). digitalOrient (its own store switch,
 * either path): Flash-Lite 4-copy orient + straighten before the triage reads;
 * dials always go to the dial reader with the ORIGINAL photo.
 */
async function readTemperature(payload: any, opts: { background?: boolean; digitalOrient?: boolean; ai?: CallAIFn; onDial?: () => void } = {}): Promise<any> {
  const { imageUrl, itemName } = payload;
  const equipmentType = asEquipmentType(payload?.equipmentType);
  const ai: CallAIFn = opts.ai ?? callAI;

  // Thermometer reader: Gemini 3.1 Flash-Lite (TEMP_READ_MODEL), read TWICE in
  // parallel on the photo as taken (no rotation pre-pass). Agreeing reads are
  // saved. A disagreement or one failed read gets ONE third tie-break read; if
  // that makes an agreeing pair it is saved, otherwise no number comes back and
  // the crew retakes or types it (photo kept). Unclear photos (too far, dark,
  // blurry, glare) come back as reason 'unclear' with a coaching value and the
  // client rejects the photo with a tip. A defrost/error screen (dEF, HI, LO,
  // Err) never counts as a number. Decision lives in temperatureDecision.ts.
  const systemPrompt = `You read photos of restaurant thermometers: digital probe thermometers (food temps) and cooler/freezer dial thermometers. Stores use different brands, so read what is printed on THIS thermometer — never assume a layout, and never guess a temperature from the food, the item name or what would be "normal".

DIGITAL / 7-SEGMENT DISPLAYS (probe thermometers):
- The photo is exactly as the crew took it: the display may be rotated 90°, 180° or 270°, tilted, or mirrored by the angle. Before reading, work out which way is UP.
- Orient ONLY with: the °F / °C legend (right of, or above, the digits when upright), the decimal point (at the BOTTOM of the digits, before the last digit, e.g. 38.6), the small printed words next to the screen and buttons (DIGITAL THERMOMETER, HOLD, MAX/MIN, °C/°F), and the probe body.
- IGNORE brand logos on the handle (e.g. ANDAXIN): some are printed upside down relative to the digits.
- If the decimal point appears at the TOP of the digits, the display is upside down: rotate it 180° in your head (the digit order reverses too) and read again.
- After orienting, read each digit by which of its 7 segments are lit, relative to the UPRIGHT digit:
  * 3 = top, upper-right, middle, lower-right, bottom — NO left-side segments.
  * 9 = like 3 plus the upper-left segment. 8 = all seven. 5 = top, upper-left, middle, lower-right, bottom. 6 = like 5 plus lower-left. 7 = top plus the right side only. 0 = all but the middle. 1 = right side only (no top bar). 4 = upper-left, middle, and the right side — NO top bar.
  * 7 vs 1: a 7 has a lit horizontal TOP bar; a 1 does not. Before you read a 1, look hard for that top bar (37.8 is often misread as 31.8, 47.3 as 41.3). Some meters draw the 7 with a short or thin top bar — it is still a 7.
  * 4 vs 7: a 4 has the upper-left and middle segments and NO top bar; a 7 has the top bar and NO middle or left segments.
  * 5 vs 9: a 5 has NO upper-right segment; a 9 has BOTH upper-right and upper-left plus the top, middle and lower-right.
  * Rotated displays are easy to misread as 9, 5, 7 or 8 when the digit is really 3. Before choosing 9, 8, 6 or 5, confirm the left-side segment is really lit.
- Copy the upright digits exactly, including the decimal. Use the Fahrenheit value; if the display shows °C only, convert to °F.
- TENTHS: say whether you are sure of the LAST digit after the decimal point (sure), not sure (unsure), or there is no decimal digit (none). Never guess a tenths digit you can't see clearly.
- If the display shows letters instead of a temperature — dEF (defrost), HI, LO, Err, E1, --- — there is NO temperature: answer NONE with ISSUE: defrost_or_error. Never guess a number.

DIAL THERMOMETERS (coolers, freezers, walk-ins):
- POINTER: the needle has a THIN pointed tip and a WIDE flat tail on the other side of the centre pin. Only the thin tip shows the temperature. The wide dark end is NOT the reading, even though it is easier to see. Many dials' tips are thin and faint — look for them.
- SCALES: there are usually two rings of numbers. The OUTER ring is Fahrenheit (marked F, numbers like -40 … 0 … 30 … 50 … 65). The inner ring is Celsius (marked C) — ignore it. Read the outer F numbers the tip points at.
- COLOURS (same pattern on almost every dial): the coloured arc beside the F numbers has exactly two BLUE sections and everything else is RED.
  * Long blue section on the LEFT/lower-left: from about 0°F down to -40°F (freezer safe).
  * Short blue section on the UPPER-RIGHT: about 35–40°F (refrigerator safe).
  * Red everywhere else: roughly 0–35°F (between the two blues, at the top) and above 40°F (right side down to 65).
  So: tip over left blue → 0 or below. Tip over red at the top-left/top between them → 1–34°F. Tip over the short blue → 35–40°F. Tip over red on the right → 41°F or warmer.
  Remember the wide tail often points down-right toward the 20/65 area — ignore it and follow the thin tip.

CLARITY:
- The photo is UNCLEAR only if you truly cannot read the number with confidence: the digits or dial numbers are tiny (roughly under 5% of the photo height), out of focus, too dark, or hidden by glare/reflection. A small but sharp, readable display is CLEAR.
- If unclear, say why with one word: too_far, too_dark, blurry or glare, and answer NONE. Do not guess.

Steps:
1. Display type: digital, dial or bar.
2. Digital: find which way is up (legend, decimal point, button text — not logos), then copy the upright digits exactly, double-checking 7/1, 4/7 and 5/9.
3. Dial: find the thin tip. Name the two OUTER Fahrenheit numbers either side of it, count the small ticks, estimate a whole number. Check it against the colour band under the tip; if they disagree, re-check that you used the thin tip and the outer ring.
4. Cold storage reads between -30 and 80°F; hot food can read up to about 212°F.

Reply with a short explanation, then these final lines exactly:
DISPLAY: digital|dial|bar
CLEAR: yes|no
ISSUE: none|too_far|too_dark|blurry|glare|defrost_or_error
CONFIDENCE: <0 to 1>
TENTHS: sure|unsure|none
ANSWER: <number> (or ANSWER: NONE if it can't be read)`;
  const itemContext = itemName ? ` The item being measured is: "${String(itemName).slice(0, 200)}" (context only — read the thermometer, not the food).` : '';
  const userPrompt = `Read the temperature on this thermometer.${itemContext}`;

  // Download the photo ourselves and send it inline: the AI provider often
  // can't fetch storage links directly ("Cannot fetch content from URL").
  let imagePayload = imageUrl;
  let photoType = 'image/jpeg';
  let photoBytes: Uint8Array | null = null;
  try {
    const imgRes = await fetch(imageUrl);
    if (imgRes.ok) {
      photoBytes = new Uint8Array(await imgRes.arrayBuffer());
      photoType = imgRes.headers.get('content-type') || 'image/jpeg';
      let bin = '';
      for (let i = 0; i < photoBytes.length; i += 0x8000) bin += String.fromCharCode(...photoBytes.subarray(i, i + 0x8000));
      imagePayload = `data:${photoType};base64,${btoa(bin)}`;
    } else {
      console.error('[extract-temperature] photo download failed', imgRes.status);
      return { temperature: null, isValid: null, unconfirmed: false, extractedText: 'NONE', unreadable: true, reason: 'read_failed', coaching: null };
    }
  } catch (e) {
    console.error('[extract-temperature] photo download error', String(e));
  }

  // digital_orient_reads_enabled only: Flash-Lite four-copy orient pick + tilt,
  // then the triage reads run on the turned/straightened copy with the
  // 'already turned' prompt. Decode/orient failure or no pick → as taken with
  // today's prompt. Dials always use the original photo (below).
  const originalPayload = imagePayload;
  let readPayload = imagePayload;
  let readSystemPrompt = systemPrompt;
  let orientRotation: number | null = null;
  if (opts.digitalOrient && photoBytes) {
    try {
      const st = await straightener(photoBytes);
      if (st) {
        const range = possibleRange(equipmentType);
        const band = equipmentType ? TEMP_BANDS[equipmentType] : null;
        const rangeHint = band
          ? ` This is a ${band.label.toLowerCase()} unit; its thermometer should read somewhere between ${range.min} and ${range.max}°F. Use that only to break a tie between orientations.`
          : '';
        const content: any[] = [{ type: 'text', text: ORIENT_TILT_PROMPT(rangeHint) }];
        st.thumbs.forEach((url, i) => { content.push({ type: 'text', text: `Image ${i + 1}:` }); content.push({ type: 'image_url', image_url: { url } }); });
        const data = await ai([{ role: 'user', content }], undefined, undefined, TEMP_READ_MODEL, undefined, { __stage: 'orient' });
        const p = parseOrientTilt(data?.choices?.[0]?.message?.content || '');
        if (p.base != null) {
          const ccw = totalCcw(p.base, p.tiltCw);
          readPayload = await st.turned(ccw);
          readSystemPrompt = systemPrompt.replace(TAKEN_AS_IS_LINE, ALREADY_TURNED_LINE);
          orientRotation = ccw;
        }
      }
    } catch (e: any) {
      console.warn('[extract-temperature] orient failed; reading as taken', e?.status ?? null);
      readPayload = originalPayload;
      readSystemPrompt = systemPrompt;
      orientRotation = null;
    }
  }
  const msgs = [
    { role: 'system', content: readSystemPrompt },
    { role: 'user', content: [ { type: 'text', text: userPrompt }, { type: 'image_url', image_url: { url: readPayload } } ] },
  ];
  type DisplayRaw = 'digital' | 'dial' | 'bar' | null;
  type DisplayType = 'digital' | 'analog' | null;
  type ReadOut = TempRead & { defrost?: boolean; displayRaw?: DisplayRaw };
  const toDisplayType = (raw: DisplayRaw): DisplayType =>
    raw === 'digital' ? 'digital' : raw === 'dial' || raw === 'bar' ? 'analog' : null;
  const readOnce = async (stage: 'read' | 'tiebreak' = 'read'): Promise<ReadOut> => {
    try {
      const data = await ai(msgs, undefined, undefined, TEMP_READ_MODEL, undefined, opts.background || opts.digitalOrient ? { __stage: stage } : undefined);
      const text: string = data?.choices?.[0]?.message?.content || '';
      const parsed = parseTempReply(text);
      // parseTempReply only knows digital/dial; keep a glass-tube "bar" tag too.
      const displayRaw: DisplayRaw = parsed.display ?? (/^\s*\**DISPLAY\**:\s*\**\s*bar/im.test(text) ? 'bar' : null);
      // Defrost / error screen: never a number. `unclear` stays as parsed.
      if (/ISSUE:\s*\**\s*defrost_or_error/i.test(text)) return { ...parsed, value: null, defrost: true, displayRaw };
      return { ...parsed, displayRaw };
    } catch (e: any) {
      console.error('[extract-temperature] read failed', e?.status, e?.message);
      return { value: null };
    }
  };
  const [a, b] = await Promise.all([readOnce(), readOnce()]);
  // At most one tie-break read per photo.
  const c = needsTiebreak(a, b) ? await readOnce('tiebreak') : null;
  const reads = c ? [a, b, c] : [a, b];
  const d = applyBands(decideReads(a, b, c), equipmentType);
  const displayRaw: DisplayRaw = (c && d.tiebreak ? c.displayRaw : null) ?? a.displayRaw ?? b.displayRaw ?? null;
  const displayType = toDisplayType(displayRaw);
  const defrostOrError = reads.some(r => r.defrost === true);
  const toDetail = (model: string, stage: 'triage' | 'dial') =>
    ({ displayRaw: raw, errored: _e, ...r }: LunaRead) => ({ ...r, displayType: toDisplayType(raw ?? null), model, stage });
  const triageDetails = reads.map(toDetail(TEMP_READ_MODEL, 'triage'));

  // Ship 4 hybrid router: any triage read tagged DISPLAY: dial → re-read by
  // GPT-6 Luna (lunaDial.ts). Luna decides dials; if Luna fails, no number —
  // never the Flash-Lite dial number. Glass tubes (bar) and no-thermometer
  // photos stay on Flash-Lite. Rescan passes dialRouter:false.
  const dialRouter = payload?.dialRouter !== false;
  const isDial = reads.some(r => r.displayRaw === 'dial');
  type Final = { decision: typeof d; model: string; readerRoute: string; rotation: number | null; finalReads: LunaRead[]; readDetails: any[]; dialMs: number | null };
  let fin: Final;
  if (dialRouter && isDial) {
    const tDial = Date.now();
    let luna: Awaited<ReturnType<typeof readDialWithLuna>> | null = null;
    if (opts.background) { try { opts.onDial?.(); } catch { /* display hint only */ } }
    try {
      luna = await readDialWithLuna({ photoBytes, imagePayload: originalPayload, equipmentType, userPrompt, callAI: ai, ...(opts.background ? { mode: 'background' as const } : {}) });
    } catch (e: any) {
      console.error('[extract-temperature] dial reader threw', e?.status ?? null);
      luna = null;
    }
    const dialMs = luna?.ms ?? (Date.now() - tDial);
    const lunaReads: LunaRead[] = luna ? (luna.single ? [luna.a] : luna.c ? [luna.a, luna.b, luna.c] : [luna.a, luna.b]) : [];
    const readDetails = [...triageDetails, ...lunaReads.map(toDetail(LUNA_DIAL_MODEL, 'dial'))];
    if (luna && !luna.failed) {
      fin = { decision: applyBands(decideReads(luna.a, luna.b, luna.c), equipmentType), model: LUNA_DIAL_MODEL, readerRoute: 'dial_luna', rotation: luna.rotation, finalReads: lunaReads, readDetails, dialMs };
    } else {
      fin = {
        decision: { temperature: null, isValid: null, unconfirmed: false, reason: 'read_failed', coaching: null, tiebreak: false, verdict: null } as typeof d,
        model: LUNA_DIAL_MODEL, readerRoute: 'dial_luna_failed', rotation: luna?.rotation ?? null,
        finalReads: lunaReads.length ? lunaReads : [{ value: null }, { value: null }], readDetails, dialMs,
      };
    }
  } else {
    fin = { decision: d, model: TEMP_READ_MODEL, readerRoute: displayRaw === 'digital' ? 'digital_fast' : 'other_fast', rotation: orientRotation, finalReads: reads, readDetails: triageDetails, dialMs: null };
  }
  const fd = fin.decision;
  console.log('[extract-temperature] reads', JSON.stringify({ route: fin.readerRoute, model: fin.model, displayType, dialMs: fin.dialMs, reads: fin.finalReads.map(r => r.value) }));
  if (fd.reason || fd.tiebreak) console.warn('[extract-temperature] not a clean pair', fd.reason, fd.tiebreak, JSON.stringify(fin.readDetails));
  return {
    temperature: fd.temperature,
    isValid: fd.isValid,
    unconfirmed: false,
    reason: fd.reason,
    coaching: fd.coaching,
    tiebreak: fd.tiebreak,
    // pass | fail | borderline (hot tags: one retake) | null; implausible → reason 'implausible'.
    verdict: fd.verdict,
    implausibleValue: fd.implausibleValue ?? null,
    equipmentType,
    // Flash-Lite never rotates (null); Luna dial reads report their CCW turn.
    rotation: fin.rotation,
    // Display tags always come from the Flash-Lite triage.
    displayType,
    displayRaw,
    defrostOrError,
    // The model that made the final decision.
    model: fin.model,
    unreadable: fd.temperature == null,
    extractedText: fd.temperature == null ? 'NONE' : String(fd.temperature),
    // Raw numbers stay in `reads` (old shape, final decider's reads); readDetails has triage + dial evidence.
    reads: fin.finalReads.map(r => r.value),
    readDetails: fin.readDetails,
    readerRoute: fin.readerRoute,
    dialMs: fin.dialMs,
  };
}

// ============================================================================
// BACKGROUND TEMPERATURE READ (per-store switch, default off)
// The phone saves the photo row as 'reading' with a fresh token and does not
// wait. We read it here and write the result with the service role, only while
// the row still carries the same token (newest photo wins).
// ============================================================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gateway call with one short retry on 429 / 5xx, bounded by the overall budget signal. */
type BgUsage = { model: string; stage: string; prompt_tokens: number | null; completion_tokens: number | null; reasoning_tokens: number | null; ok: boolean; ms: number };
function bgCallAI(overall: AbortSignal, usage: BgUsage[]): CallAIFn {
  return async (messages, tools, toolChoice, modelOverride, signal, extraBody) => {
    const sig = signal ? AbortSignal.any([signal, overall]) : overall;
    // __stage is a local label for the cost log; it is never sent to the gateway.
    const { __stage, ...rest } = (extraBody ?? {}) as Record<string, unknown>;
    const body = Object.keys(rest).length ? rest : undefined;
    let stage = typeof __stage === 'string' ? __stage : 'read';
    const model = modelOverride || 'google/gemini-2.5-flash';
    if (model === LUNA_DIAL_MODEL) stage = 'dial';
    let t = Date.now();
    const record = (data: any, ok: boolean) => { usage.push(usageEntry(model, stage, data, ok, Date.now() - t)); return data; };
    try {
      return record(await callAI(messages, tools, toolChoice, modelOverride, sig, body), true);
    } catch (e: any) {
      const s = Number(e?.status);
      if (sig.aborted || !(s === 429 || s >= 500)) { record(null, false); throw e; }
      await sleep(1500);
      if (sig.aborted) { record(null, false); throw e; }
      t = Date.now();
      try { return record(await callAI(messages, tools, toolChoice, modelOverride, sig, body), true); }
      catch (e2) { record(null, false); throw e2; }
    }
  };
}

function photoFromRow(row: any, wanted?: unknown): string | null {
  const list: string[] = [];
  if (typeof row?.response_image_url === 'string' && row.response_image_url) list.push(row.response_image_url);
  const t = typeof row?.response_text === 'string' ? row.response_text.trim() : '';
  if (t.startsWith('[')) {
    try { const a = JSON.parse(t); if (Array.isArray(a)) for (const u of a) if (typeof u === 'string' && u) list.push(u); } catch { /* ignore */ }
  }
  if (typeof wanted === 'string' && list.includes(wanted)) return wanted;
  return list.length ? list[list.length - 1] : null;
}

/** Same manager alert the phone sends today for an out-of-range reading. */
async function alertUnsafeTemperatureServer(svc: any, locationId: string, itemId: string, question: string, temp: number) {
  const { data: managerUsers } = await svc
    .from('user_locations')
    .select('user_id, user_roles!inner(role)')
    .eq('location_id', locationId)
    .in('user_roles.role', ['super_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager', 'shift_manager_in_training']);
  const managerIds = [...new Set((managerUsers ?? []).map((u: any) => u.user_id))];
  if (managerIds.length === 0) return;
  const { error } = await svc.from('alert_queue').insert({
    alert_type: 'unsafe_temperature',
    dedup_key: `temp_alert_${locationId}_${itemId}_${new Date().toISOString().split('T')[0]}_${Date.now()}`,
    location_id: locationId,
    payload: {
      user_ids: managerIds,
      title: `🌡️ Unsafe Temp: ${question}`,
      body: `${temp}°F is out of safe zone. Verify and take corrective action.`,
      notification_type: 'unsafe_temperature',
      data: { type: 'unsafe_temperature', location_id: locationId, checklist_item: question, temperature: temp, unconfirmed: false },
    },
  });
  if (error) console.warn('[extract-temperature-bg] alert insert failed', error.code ?? null);
}

async function handleExtractTemperatureBg(req: Request, payload: any) {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return errorResponse('Unauthorized', 401);
  const responseId = String(payload?.responseId ?? '');
  const token = String(payload?.token ?? '');
  if (!UUID_RE.test(responseId) || !UUID_RE.test(token)) return errorResponse('responseId and token are required', 400);

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: who, error: whoErr } = await userClient.auth.getUser();
  if (whoErr || !who?.user) return errorResponse('Unauthorized', 401);
  // The caller must be able to see this answer under their own access.
  const { data: visible } = await userClient.from('checklist_responses').select('id').eq('id', responseId).maybeSingle();
  if (!visible) return errorResponse('Not found', 404);

  const svc = getSupabaseClient();
  const { data: row } = await svc.from('checklist_responses')
    .select('id, item_id, submission_id, response_image_url, response_text, temperature_read_token')
    .eq('id', responseId).maybeSingle();
  if (!row) return errorResponse('Not found', 404);
  if (!isCurrentReadToken(row.temperature_read_token, token)) return errorResponse('stale_token', 409);

  const [{ data: sub }, { data: item }] = await Promise.all([
    svc.from('checklist_submissions').select('location_id').eq('id', row.submission_id).maybeSingle(),
    svc.from('checklist_items').select('id, question, equipment_type, checklist_id').eq('id', row.item_id).maybeSingle(),
  ]);
  let locationId: string | null = sub?.location_id ?? null;
  if (!locationId && item?.checklist_id) {
    const { data: cl } = await svc.from('checklists').select('location_id').eq('id', item.checklist_id).maybeSingle();
    locationId = cl?.location_id ?? null;
  }
  if (!locationId) return errorResponse('background_reads_off', 409);
  const { data: ls } = await svc.from('location_settings').select('background_temp_reads_enabled, digital_orient_reads_enabled').eq('location_id', locationId).maybeSingle();
  if (!(ls as any)?.background_temp_reads_enabled) return errorResponse('background_reads_off', 409);

  const imageUrl = photoFromRow(row, payload?.imageUrl);
  if (!imageUrl) return errorResponse('No photo on this answer', 400);
  const equipmentType = asEquipmentType(item?.equipment_type ?? payload?.equipmentType);
  const itemName = item?.question ?? (typeof payload?.itemName === 'string' ? payload.itemName : null);

  const job = runBackgroundRead({
    svc, responseId, token, imageUrl, itemName, equipmentType, locationId,
    itemId: row.item_id, submissionId: row.submission_id, userId: who.user.id,
    borderlineRetakeUsed: payload?.borderlineRetakeUsed === true,
    digitalOrient: (ls as any)?.digital_orient_reads_enabled === true,
  }).catch((e) => console.error('[extract-temperature-bg] job failed', e?.status ?? null));
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(job);
  return jsonResponse({ accepted: true }, 202);
}

async function runBackgroundRead(j: {
  svc: any; responseId: string; token: string; imageUrl: string; itemName: string | null;
  equipmentType: ReturnType<typeof asEquipmentType>; locationId: string; itemId: string;
  submissionId: string; userId: string; borderlineRetakeUsed: boolean; digitalOrient: boolean;
}) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), BG_READ_BUDGET_MS);
  let result: any = null;
  const usage: BgUsage[] = [];
  // Display hint while still reading: 'dial' lets the phone say "Reading dial…".
  const onDial = () => {
    void j.svc.from('checklist_responses').update({ temperature_read_reason: 'dial' })
      .eq('id', j.responseId).eq('temperature_read_token', j.token).eq('temperature_read_status', 'reading')
      .then(() => {}, () => {});
  };
  try {
    result = await Promise.race([
      readTemperature({ imageUrl: j.imageUrl, itemName: j.itemName, equipmentType: j.equipmentType }, { background: true, digitalOrient: j.digitalOrient, ai: bgCallAI(ctl.signal, usage), onDial }),
      new Promise<null>((r) => ctl.signal.addEventListener('abort', () => r(null))),
    ]);
  } catch (e: any) {
    console.error('[extract-temperature-bg] read threw', e?.status ?? null);
    result = null;
  } finally {
    clearTimeout(timer);
  }
  const timedOut = result == null && ctl.signal.aborted;
  // Cost log: one JSON line per photo (no image data, no reply text).
  console.log('[extract-temperature-bg] usage', JSON.stringify({ responseId: j.responseId, route: result?.readerRoute ?? null, ms: Date.now() - t0, calls: usage }));
  // Token-conditional write: a stale read never overwrites a newer photo.
  const write = async (fields: Record<string, unknown>) => {
    const { data, error } = await j.svc.from('checklist_responses').update(fields)
      .eq('id', j.responseId).eq('temperature_read_token', j.token).select('id');
    if (error) console.error('[extract-temperature-bg] write failed', error.code ?? null);
    return !error && Array.isArray(data) && data.length > 0;
  };
  const logIssue = (reason: string, saved: number | null) =>
    j.svc.from('temperature_read_issues').insert({
      reason,
      reads: result?.readDetails ?? result?.reads ?? (typeof result?.temperature === 'number' ? [result.temperature] : null),
      saved_temperature: saved,
      image_url: j.imageUrl,
      item_id: j.itemId,
      submission_id: j.submissionId,
      location_id: j.locationId,
      user_id: j.userId,
    }).then(({ error }: any) => { if (error) console.warn('[extract-temperature-bg] issue log failed', error.code ?? null); });

  if (!result) {
    const reason = timedOut ? 'timeout' : 'read_failed';
    if (await write({ temperature_read_status: 'failed', temperature_read_reason: reason, temperature_read_coaching: null })) await logIssue(reason, null);
    console.log('[extract-temperature-bg] done', JSON.stringify({ status: 'failed', reason, ms: Date.now() - t0 }));
    return;
  }

  const outcome = planBackgroundOutcome({
    temperature: result.temperature, reason: result.reason, coaching: result.coaching,
    defrostOrError: result.defrostOrError === true, equipmentType: j.equipmentType,
    borderlineRetakeUsed: j.borderlineRetakeUsed,
  });
  const serverReason: string | null = result.reason ?? (result.tiebreak ? 'tiebreak_confirmed' : null);

  if (outcome.status === 'saved') {
    // 4°F jump: median of this item's last 5 valid readings at this store (14 days).
    let jump = { flag: false, baseline: null as number | null };
    try {
      const since = new Date(Date.now() - 14 * 86400_000).toISOString();
      const { data: prior } = await j.svc.from('checklist_responses')
        .select('extracted_temperature, submission_id, temperature_validated_at')
        .eq('item_id', j.itemId).eq('temperature_valid', true).not('extracted_temperature', 'is', null)
        .neq('id', j.responseId).gte('temperature_validated_at', since)
        .order('temperature_validated_at', { ascending: false }).limit(25);
      const subIds = [...new Set((prior ?? []).map((p: any) => p.submission_id))];
      const { data: subs } = subIds.length
        ? await j.svc.from('checklist_submissions').select('id, location_id').in('id', subIds)
        : { data: [] };
      const here = new Set((subs ?? []).filter((s: any) => s.location_id === j.locationId).map((s: any) => s.id));
      jump = jumpCheck(outcome.tempF, (prior ?? []).filter((p: any) => here.has(p.submission_id)).map((p: any) => Number(p.extracted_temperature)));
    } catch (e: any) {
      console.warn('[extract-temperature-bg] jump check skipped', e?.status ?? null);
    }
    const ok = await write({
      extracted_temperature: outcome.tempF,
      temperature_valid: outcome.valid,
      temperature_unconfirmed: false,
      temperature_validated_at: new Date().toISOString(),
      temperature_read_status: 'saved',
      temperature_read_reason: null,
      temperature_read_coaching: null,
      temperature_jump_flag: jump.flag,
      temperature_jump_baseline: jump.baseline,
    });
    if (ok) {
      if (serverReason) await logIssue(serverReason, outcome.tempF);
      if (!outcome.valid) await alertUnsafeTemperatureServer(j.svc, j.locationId, j.itemId, j.itemName ?? 'Temperature check', outcome.tempF);
    }
  } else {
    const ok = await write({ temperature_read_status: 'failed', temperature_read_reason: outcome.reason, temperature_read_coaching: outcome.coaching });
    if (ok) {
      const logReason = outcome.reason === 'borderline_retake' ? 'borderline_retake' : (serverReason ?? (outcome.reason === 'implausible' ? 'implausible' : outcome.reason));
      await logIssue(logReason, null);
    }
  }
  console.log('[extract-temperature-bg] done', JSON.stringify({ status: outcome.status, reason: outcome.status === 'failed' ? outcome.reason : null, route: result.readerRoute ?? null, ms: Date.now() - t0 }));
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
      checklist_items(question, equipment_type)
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

      // dialRouter:false keeps rescans fast (Flash-Lite only, inside the 150 s limit).
      const extractResult = await handleExtractTemperature({ imageUrl: response.response_image_url, itemName: question, equipmentType: item?.equipment_type ?? null, dialRouter: false });
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

      // Flash-Lite must never overwrite a dial reading (dials are decided by Luna).
      if (extractData.displayRaw === 'dial') {
        results.push({ id: response.id, question, success: false, error: 'Dial — kept the saved value', previousTemp: response.extracted_temperature });
        continue;
      }

      const { temperature, isValid } = extractData;
      // Never wipe a saved reading when the rescan can't agree on a number.
      if (temperature == null || extractData.unconfirmed) {
        results.push({ id: response.id, question, success: false, error: 'No confirmed reading — kept the saved value', previousTemp: response.extracted_temperature });
        continue;
      }

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


// Bulk Upload: read checklist task lines from a PDF or photo. Preview only; nothing is saved here.
const BULK_READS_PER_HOUR = 20;
async function handleExtractChecklistTasks(req: Request, payload: any) {
  const { fileBase64, mimeType, kind, locationId } = payload ?? {};
  const allowed = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'];
  if (typeof fileBase64 !== 'string' || !fileBase64) return errorResponse('No file was sent', 400);
  if (!allowed.includes(mimeType)) return errorResponse('Use a PDF, JPG, PNG or HEIC file', 400);
  const bytes = Math.floor(fileBase64.length * 3 / 4);
  if (bytes > 10 * 1024 * 1024) return errorResponse('That file is over 10 MB', 400);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const supabase = getSupabaseClient();
  const { data: auth } = await supabase.auth.getUser(token);
  const userId = auth?.user?.id;
  if (!userId) return errorResponse('Please sign in again', 401);

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase.from('checklist_bulk_read_log').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', since);
  if ((count ?? 0) >= BULK_READS_PER_HOUR) {
    return errorResponse('You have read 20 files in the last hour. Please wait a bit, or paste the list instead.', 429);
  }

  const log = async (success: boolean, taskCount: number, error?: string) => {
    await supabase.from('checklist_bulk_read_log').insert({
      user_id: userId, location_id: typeof locationId === 'string' ? locationId : null,
      file_kind: kind === 'pdf' ? 'pdf' : 'photo', mime_type: mimeType, file_bytes: bytes,
      task_count: taskCount, success, error: error ?? null,
    });
  };

  try {
    const data = await callAI(
      [
        { role: 'system', content: 'You read printed or handwritten restaurant checklists and return each task line exactly as written (fix only obvious OCR spacing). Keep the original order. Headings that group tasks are sections. Do not invent tasks. Skip titles, dates, signatures, column labels and checkbox marks. type is "photo" only if the line clearly asks for a photo or picture, "temperature" only if it clearly asks to take or log a temperature; otherwise "check".' },
        { role: 'user', content: [
          { type: 'text', text: 'List every task in this checklist.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
        ] },
      ],
      [{ type: 'function', function: {
        name: 'return_tasks',
        description: 'Checklist tasks in order',
        parameters: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: {
          name: { type: 'string' }, type: { type: 'string', enum: ['check', 'photo', 'temperature'] }, section: { type: 'boolean' },
        }, required: ['name', 'type', 'section'] } } }, required: ['tasks'] },
      } }],
      { type: 'function', function: { name: 'return_tasks' } },
    );
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let tasks: any[] = [];
    try { tasks = (JSON.parse(args ?? '{}').tasks ?? []).slice(0, 500); } catch { tasks = []; }
    tasks = tasks.filter((t) => t && typeof t.name === 'string' && t.name.trim()).map((t) => ({
      name: String(t.name).trim().slice(0, 500), type: ['photo', 'temperature'].includes(t.type) ? t.type : 'check', section: !!t.section,
    }));
    await log(true, tasks.filter((t) => !t.section).length);
    return jsonResponse({ tasks });
  } catch (e: any) {
    await log(false, 0, e?.message ?? 'error');
    throw e;
  }
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
      case 'extract-checklist-tasks':
        return await handleExtractChecklistTasks(req, payload);
      case 'parse-catering-order':
        return await handleParseCateringOrder(payload);
      case 'parse-inventory-audio':
        return await handleParseInventoryAudio(payload);
      case 'parse-inventory-voice':
        return await handleParseInventoryVoice(payload);
      case 'extract-temperature-bg':
        return await handleExtractTemperatureBg(req, payload);
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
