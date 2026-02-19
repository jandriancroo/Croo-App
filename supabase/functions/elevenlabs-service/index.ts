import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");

// Alarm TTS: Generate alarm announcement audio
async function generateAlarmTts(text: string): Promise<Response> {
  if (!text) {
    throw new Error("Text is required");
  }

  const voiceId = "nPczCjzI2devNBz1zQrb"; // Brian voice - clear announcer style

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.8,
          similarity_boost: 0.75,
          speed: 1.1,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("ElevenLabs API error:", response.status, errorText);
    // Return a 503 so client can gracefully fallback to browser TTS
    return new Response(
      JSON.stringify({ error: "TTS service unavailable", fallback: true }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const audioBuffer = await response.arrayBuffer();
  const base64Audio = base64Encode(audioBuffer);

  return new Response(
    JSON.stringify({ audioContent: base64Audio }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

// Music Generation: Create background music or ambient audio
async function generateMusic(prompt: string, duration?: number): Promise<Response> {
  if (!prompt) {
    throw new Error("Prompt is required");
  }

  console.log(
    `Generating music for prompt: "${prompt}" (${duration || 30}s)`
  );

  const response = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      duration_seconds: duration || 30,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("ElevenLabs API error:", errorText);
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  const audioBuffer = await response.arrayBuffer();
  console.log(`Generated ${audioBuffer.byteLength} bytes of audio`);

  return new Response(audioBuffer, {
    headers: {
      ...corsHeaders,
      "Content-Type": "audio/mpeg",
    },
  });
}

// Inventory TTS: Short spoken confirmation for voice counting
async function generateInventoryConfirmTts(text: string): Promise<Response> {
  if (!text) {
    throw new Error("Text is required");
  }

  const voiceId = "EXAVITQu4vr4xnSDxMaL"; // Sarah - clear, fast female voice

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.9,
          similarity_boost: 0.8,
          speed: 1.2, // Slightly faster for quick confirmations
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("ElevenLabs inventory TTS error:", response.status, errorText);
    return new Response(
      JSON.stringify({ error: "TTS unavailable", fallback: true }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const audioBuffer = await response.arrayBuffer();
  const base64Audio = base64Encode(audioBuffer);

  return new Response(
    JSON.stringify({ audioContent: base64Audio }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}


async function getScribeToken(): Promise<Response> {
  const response = await fetch(
    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY!,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("ElevenLabs API error:", error);
    throw new Error(`Failed to get scribe token: ${response.status}`);
  }

  const { token } = await response.json();

  return new Response(JSON.stringify({ token }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Main handler with action-based routing
const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (!action) {
      throw new Error("Missing action parameter");
    }

    const body = req.method === "POST" ? await req.json() : {};

    switch (action) {
      case "alarm-tts":
        return await generateAlarmTts(body.text);

      case "music":
        return await generateMusic(body.prompt, body.duration);

      case "scribe-token":
        return await getScribeToken();

      case "inventory-confirm-tts":
        return await generateInventoryConfirmTts(body.text);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error("Error in elevenlabs-service:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
