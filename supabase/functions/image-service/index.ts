import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'generate-marketplace-icon'

  try {
    switch (action) {
      case 'generate-marketplace-icon':
        return await handleMarketplaceIcon(req)
      case 'generate-product-image':
        return await handleProductImage(req)
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
  } catch (error: any) {
    console.error(`[image-service] Error (action=${action}):`, error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ==================== MARKETPLACE ICON ====================

async function handleMarketplaceIcon(req: Request): Promise<Response> {
  const { variant } = await req.json()

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
  if (!LOVABLE_API_KEY) {
    console.error('[image-service] LOVABLE_API_KEY not configured')
    return new Response(
      JSON.stringify({ error: 'Image generation not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let prompt = ""
  switch (variant) {
    case 1:
      prompt = "A clean, modern app icon for a shift marketplace. Features a minimalist calendar grid with a dollar sign symbol elegantly overlaid in the center. Use a professional color palette of teal blue and gold. Square icon with rounded corners, flat design style, icon design, simple and memorable."
      break
    case 2:
      prompt = "A vibrant app icon for a shift marketplace. Shows a stylized calendar page with coins cascading from it, representing money and scheduling. Use bright colors like orange and green. Square icon with rounded corners, modern flat design, professional, icon design."
      break
    case 3:
      prompt = "A sleek app icon for a shift marketplace. Features an abstract representation of a calendar square transforming into a dollar bill or coin. Use cool colors like navy blue and silver/white. Minimalist design, square icon with rounded corners, professional icon design."
      break
    default:
      throw new Error('Invalid variant')
  }

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      modalities: ['image', 'text']
    })
  })

  const data = await response.json()
  const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url

  if (!imageUrl) {
    throw new Error('Failed to generate image')
  }

  return new Response(
    JSON.stringify({ imageUrl }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ==================== PRODUCT IMAGE ====================

async function handleProductImage(req: Request): Promise<Response> {
  const { productName, brand } = await req.json()
  
  if (!productName) {
    return new Response(
      JSON.stringify({ error: 'productName is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
  if (!LOVABLE_API_KEY) {
    console.error('[image-service] LOVABLE_API_KEY not configured')
    return new Response(
      JSON.stringify({ error: 'Image generation not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const brandText = brand ? `${brand} brand ` : ''
  const prompt = `Professional product photography of ${brandText}${productName}. Clean white background, studio lighting, high quality commercial food/restaurant supply product image. Centered, no text or logos.`

  console.log('[image-service] Generating product image for:', productName)

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      modalities: ['image', 'text']
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[image-service] API error:', response.status, errorText)
    return new Response(
      JSON.stringify({ error: 'Image generation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const data = await response.json()
  const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url

  if (!imageUrl) {
    console.error('[image-service] No image in response:', JSON.stringify(data).slice(0, 500))
    return new Response(
      JSON.stringify({ error: 'No image generated' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Upload to Supabase storage
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Extract base64 data
  const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!base64Match) {
    console.error('[image-service] Invalid base64 format')
    return new Response(
      JSON.stringify({ error: 'Invalid image format' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const [, imageType, base64Data] = base64Match
  const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
  
  // Generate a unique filename
  const fileName = `product-images/${crypto.randomUUID()}.${imageType}`

  // Ensure bucket exists
  const { data: buckets } = await supabase.storage.listBuckets()
  const bucketExists = buckets?.some(b => b.name === 'inventory')
  
  if (!bucketExists) {
    await supabase.storage.createBucket('inventory', { public: true })
    console.log('[image-service] Created inventory bucket')
  }

  const { error: uploadError } = await supabase.storage
    .from('inventory')
    .upload(fileName, binaryData, {
      contentType: `image/${imageType}`,
      upsert: true
    })

  if (uploadError) {
    console.error('[image-service] Upload error:', uploadError)
    return new Response(
      JSON.stringify({ error: 'Failed to upload image' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data: publicUrl } = supabase.storage
    .from('inventory')
    .getPublicUrl(fileName)

  console.log('[image-service] Generated and uploaded:', publicUrl.publicUrl)

  return new Response(
    JSON.stringify({ imageUrl: publicUrl.publicUrl }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
