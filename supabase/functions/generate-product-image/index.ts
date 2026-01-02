import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { productName, brand } = await req.json();
    
    if (!productName) {
      return new Response(JSON.stringify({ error: 'productName is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('[ImageGen] LOVABLE_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'Image generation not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create a descriptive prompt for the product
    const brandText = brand ? `${brand} brand ` : '';
    const prompt = `Professional product photography of ${brandText}${productName}. Clean white background, studio lighting, high quality commercial food/restaurant supply product image. Centered, no text or logos.`;

    console.log('[ImageGen] Generating image for:', productName);
    console.log('[ImageGen] Prompt:', prompt);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image-preview',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        modalities: ['image', 'text']
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ImageGen] API error:', response.status, errorText);
      return new Response(JSON.stringify({ error: 'Image generation failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageUrl) {
      console.error('[ImageGen] No image in response:', JSON.stringify(data).slice(0, 500));
      return new Response(JSON.stringify({ error: 'No image generated' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upload to Supabase storage
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Extract base64 data
    const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
      console.error('[ImageGen] Invalid base64 format');
      return new Response(JSON.stringify({ error: 'Invalid image format' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [, imageType, base64Data] = base64Match;
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    
    // Generate a unique filename
    const fileName = `product-images/${crypto.randomUUID()}.${imageType}`;

    // Ensure bucket exists
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === 'inventory');
    
    if (!bucketExists) {
      await supabase.storage.createBucket('inventory', { public: true });
      console.log('[ImageGen] Created inventory bucket');
    }

    const { error: uploadError } = await supabase.storage
      .from('inventory')
      .upload(fileName, binaryData, {
        contentType: `image/${imageType}`,
        upsert: true
      });

    if (uploadError) {
      console.error('[ImageGen] Upload error:', uploadError);
      return new Response(JSON.stringify({ error: 'Failed to upload image' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: publicUrl } = supabase.storage
      .from('inventory')
      .getPublicUrl(fileName);

    console.log('[ImageGen] Generated and uploaded:', publicUrl.publicUrl);

    return new Response(JSON.stringify({ 
      imageUrl: publicUrl.publicUrl 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[ImageGen] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
