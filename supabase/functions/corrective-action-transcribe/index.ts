// Corrective Action recording pipeline.
// Hop 1: verbatim transcription of one audio chunk (openai/gpt-4o-mini-transcribe,
//        fallback openai/gpt-4o-transcribe).
// Hop 2: ONE bullet-notes pass over the FULL concatenated transcript
//        (google/gemini-3.7-flash). Raw audio is never sent to Flash.
// Audio is never written to storage; it lives only in this request's memory.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GATEWAY = 'https://ai.gateway.lovable.dev/v1';
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.split(',')[1] : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function transcribeOnce(bytes: Uint8Array, mimeType: string, model: string) {
  const base = (mimeType || 'audio/webm').split(';')[0];
  const ext = EXT_BY_MIME[base] ?? 'webm';
  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([bytes], { type: base }), `chunk.${ext}`);

  const res = await fetch(`${GATEWAY}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: form,
  });

  const raw = await res.text();
  if (!res.ok) return { ok: false as const, status: res.status, error: raw };
  try {
    const parsed = JSON.parse(raw);
    return { ok: true as const, text: (parsed.text ?? '').trim() };
  } catch {
    return { ok: true as const, text: raw.trim() };
  }
}

async function handleTranscribeChunk(payload: any) {
  const { audioBase64, mimeType } = payload ?? {};
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    return json({ error: 'audioBase64 is required' }, 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(audioBase64);
  } catch {
    return json({ error: 'audioBase64 is not valid base64' }, 400);
  }
  if (bytes.byteLength < 2048) {
    // Header-only / silent chunk: nothing to transcribe, not an error.
    return json({ text: '', model_used: 'mini', empty: true });
  }
  if (bytes.byteLength > 20 * 1024 * 1024) {
    return json({ error: 'Audio chunk too large' }, 400);
  }

  // Hop 1 default: mini
  let attempt = await transcribeOnce(bytes, mimeType, 'openai/gpt-4o-mini-transcribe');
  let modelUsed: 'mini' | 'standard' = 'mini';

  // Fallback to the higher-accuracy model on retryable/transient failures.
  if (!attempt.ok && (attempt.status === 429 || attempt.status >= 500 || attempt.status === 400)) {
    console.warn('[corrective-action] mini transcribe failed', attempt.status, attempt.error?.slice(0, 300));
    attempt = await transcribeOnce(bytes, mimeType, 'openai/gpt-4o-transcribe');
    modelUsed = 'standard';
  }

  if (!attempt.ok) {
    return json({ error: `Transcription failed (${attempt.status})`, detail: attempt.error?.slice(0, 500) }, attempt.status);
  }

  return json({ text: attempt.text, model_used: modelUsed });
}

async function handleSummarize(payload: any) {
  const { transcript, managerName, employeeName } = payload ?? {};
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 10) {
    return json({ error: 'transcript is required' }, 400);
  }

  const mgr = (managerName || 'Manager').toString().slice(0, 120);
  const emp = (employeeName || 'Employee').toString().slice(0, 120);

  const systemPrompt = `You turn a recorded workplace coaching conversation into clean bullet notes for a restaurant Corrective Action record.

There are two known people:
- Manager: ${mgr}
- Employee: ${emp}

Rules:
- Attribute each bullet to a speaker: "Manager ${mgr}", "Employee ${emp}", or "Other" for any third voice you cannot confidently attribute to those two.
- Bullets must be factual and drawn only from the transcript. Never invent details, dates, or commitments.
- Keep each bullet to one short sentence. 4 to 12 bullets total.
- Keep the chronological order of the conversation.
- Neutral, professional tone. No advice, no verdicts, no HR opinions.`;

  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-3.7-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Transcript of the conversation:\n\n${transcript.slice(0, 200000)}` },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'record_conversation_notes',
          description: 'Return speaker-labeled bullet notes for the conversation',
          parameters: {
            type: 'object',
            properties: {
              notes_bullets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    speaker: { type: 'string', description: `"Manager ${mgr}", "Employee ${emp}", or "Other"` },
                    text: { type: 'string' },
                  },
                  required: ['speaker', 'text'],
                  additionalProperties: false,
                },
              },
            },
            required: ['notes_bullets'],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: 'function', function: { name: 'record_conversation_notes' } },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[corrective-action] summarize failed', res.status, errText.slice(0, 400));
    return json({ error: `Notes generation failed (${res.status})`, detail: errText.slice(0, 500) }, res.status);
  }

  const data = await res.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) {
    return json({ error: 'Notes generation returned no result' }, 502);
  }

  let bullets: any[] = [];
  try {
    bullets = JSON.parse(call.function.arguments)?.notes_bullets ?? [];
  } catch (e) {
    console.error('[corrective-action] bullet parse error', e);
    return json({ error: 'Notes generation returned malformed result' }, 502);
  }

  const cleaned = bullets
    .filter((b) => b && typeof b.text === 'string' && b.text.trim())
    .map((b) => ({ speaker: String(b.speaker || 'Other').slice(0, 160), text: String(b.text).trim().slice(0, 600) }))
    .slice(0, 20);

  return json({ notes_bullets: cleaned });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!LOVABLE_API_KEY) {
    return json({ error: 'AI is not configured on the server' }, 500);
  }

  // Auth: signed-in manager tier only.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401);

  const { data: allowed, error: roleErr } = await supabase.rpc('has_role_or_higher', {
    _user_id: userData.user.id,
    _minimum_role: 'manager',
  });
  if (roleErr) console.error('[corrective-action] role check error', roleErr);
  if (!allowed) return json({ error: 'Forbidden' }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    switch (body?.action) {
      case 'transcribe_chunk':
        return await handleTranscribeChunk(body);
      case 'summarize':
        return await handleSummarize(body);
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e: any) {
    console.error('[corrective-action] unhandled error', e);
    return json({ error: e?.message || 'Unexpected error' }, 500);
  }
});
