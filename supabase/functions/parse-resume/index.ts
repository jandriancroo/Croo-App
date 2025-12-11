import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText, resumeBase64, mimeType } = await req.json();

    if (!resumeText && !resumeBase64) {
      return new Response(
        JSON.stringify({ success: false, error: 'Resume content is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Parsing resume with AI...', resumeBase64 ? 'PDF/Image mode' : 'Text mode');

    // Build the message content
    let userContent: any;
    
    if (resumeBase64) {
      // For PDFs/images, use vision capabilities
      userContent = [
        {
          type: 'text',
          text: `Parse this resume and extract the applicant's information. Return ONLY the extracted data using the provided function.`
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType || 'application/pdf'};base64,${resumeBase64}`
          }
        }
      ];
    } else {
      userContent = `Parse this resume and extract the following information. Return ONLY the extracted data using the provided function.

Resume text:
${resumeText}`;
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a resume parser. Extract applicant information from resumes accurately. Look for name, email, phone, and work history.`
          },
          {
            role: 'user',
            content: userContent
          }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_resume_data',
              description: 'Extract structured data from a resume',
              parameters: {
                type: 'object',
                properties: {
                  firstName: { type: 'string', description: 'First name of the applicant' },
                  lastName: { type: 'string', description: 'Last name of the applicant' },
                  email: { type: 'string', description: 'Email address' },
                  phone: { type: 'string', description: 'Phone number' },
                  workHistory: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        employer_name: { type: 'string' },
                        job_title: { type: 'string' },
                        start_date: { type: 'string', description: 'YYYY-MM format' },
                        end_date: { type: 'string', description: 'YYYY-MM format or empty if current' },
                        is_current: { type: 'boolean' }
                      },
                      required: ['employer_name', 'job_title', 'start_date', 'end_date', 'is_current']
                    }
                  }
                },
                required: ['firstName', 'lastName', 'email', 'phone', 'workHistory']
              }
            }
          }
        ],
        tool_choice: { type: 'function', function: { name: 'extract_resume_data' } }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit exceeded, please try again later' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'AI credits exhausted' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ success: false, error: 'AI service error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('AI response received');

    // Extract the tool call arguments
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const parsedData = JSON.parse(toolCall.function.arguments);
      console.log('Parsed resume data:', parsedData);
      return new Response(
        JSON.stringify({ success: true, data: parsedData }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fallback: try to parse from message content
    const content = data.choices?.[0]?.message?.content;
    if (content) {
      try {
        const parsedData = JSON.parse(content);
        return new Response(
          JSON.stringify({ success: true, data: parsedData }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch {
        console.error('Failed to parse AI response as JSON');
      }
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Failed to parse resume' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error parsing resume:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
