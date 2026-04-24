// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { endpoint, method, body, token } = await req.json()
    
    const baseUrl = 'https://api.ovationup.com/app-services/v2'
    const url = `${baseUrl}${endpoint}`
    
    console.log(`[ovation-test] Calling: ${method} ${url}`)
    if (body) console.log(`[ovation-test] Body: ${JSON.stringify(body)}`)

    const fetchOptions: RequestInit = {
      method: method || 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://app-frame.ovationup.com',
      },
    }

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body)
    }

    const response = await fetch(url, fetchOptions)
    const responseText = await response.text()
    
    console.log(`[ovation-test] Status: ${response.status}`)
    console.log(`[ovation-test] Response: ${responseText.substring(0, 2000)}`)

    let parsed
    try {
      parsed = JSON.parse(responseText)
    } catch {
      parsed = { raw: responseText }
    }

    return new Response(JSON.stringify({
      status: response.status,
      data: parsed
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[ovation-test] Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
