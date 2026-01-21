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
    const { applicationId } = await req.json();
    
    if (!applicationId) {
      return new Response(JSON.stringify({ error: 'applicationId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch application with work history
    const { data: application, error: fetchError } = await supabase
      .from('job_applications')
      .select(`
        *,
        work_history:job_application_work_history(*)
      `)
      .eq('id', applicationId)
      .single();

    if (fetchError || !application) {
      console.error('Error fetching application:', fetchError);
      return new Response(JSON.stringify({ error: 'Application not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'AI service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If no work history but has resume, parse it first
    let workHistory = application.work_history || [];
    
    if (workHistory.length === 0 && application.resume_url) {
      console.log('No work history found, attempting to parse resume:', application.resume_url);
      
      try {
        // Fetch the resume file
        const resumeResponse = await fetch(application.resume_url);
        if (resumeResponse.ok) {
          const contentType = resumeResponse.headers.get('content-type') || 'application/pdf';
          const arrayBuffer = await resumeResponse.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
          
          console.log('Resume fetched, parsing with AI...');
          
          // Parse resume with AI
          const parseResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
                  content: 'You are a resume parser. Extract work history from resumes accurately.'
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: 'Parse this resume and extract work history. Return ONLY the extracted data using the provided function.'
                    },
                    {
                      type: 'image_url',
                      image_url: {
                        url: `data:${contentType};base64,${base64}`
                      }
                    }
                  ]
                }
              ],
              tools: [
                {
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
                              start_date: { type: 'string', description: 'YYYY-MM format' },
                              end_date: { type: 'string', description: 'YYYY-MM format or empty if current' },
                              is_current: { type: 'boolean' }
                            },
                            required: ['employer_name', 'job_title']
                          }
                        }
                      },
                      required: ['workHistory']
                    }
                  }
                }
              ],
              tool_choice: { type: 'function', function: { name: 'extract_work_history' } }
            }),
          });

          if (parseResponse.ok) {
            const parseData = await parseResponse.json();
            const toolCall = parseData.choices?.[0]?.message?.tool_calls?.[0];
            
            if (toolCall?.function?.arguments) {
              const parsed = JSON.parse(toolCall.function.arguments);
              
              if (parsed.workHistory && parsed.workHistory.length > 0) {
                console.log('Parsed work history:', parsed.workHistory);
                
                // Helper to convert YYYY-MM to YYYY-MM-01 for DATE column
                const formatDate = (dateStr: string | null | undefined): string | null => {
                  if (!dateStr) return null;
                  // If already in YYYY-MM-DD format, return as-is
                  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
                  // If in YYYY-MM format, add day
                  if (/^\d{4}-\d{2}$/.test(dateStr)) return `${dateStr}-01`;
                  // Try to parse other formats
                  return null;
                };
                
                // Save work history to database
                const workHistoryPayload = parsed.workHistory.map((w: any, i: number) => ({
                  application_id: applicationId,
                  employer_name: w.employer_name || 'Unknown',
                  job_title: w.job_title || 'Unknown',
                  start_date: formatDate(w.start_date),
                  end_date: w.is_current ? null : formatDate(w.end_date),
                  is_current: w.is_current || false,
                  display_order: i,
                }));

                const { data: insertedHistory, error: insertError } = await supabase
                  .from('job_application_work_history')
                  .insert(workHistoryPayload)
                  .select();

                if (insertError) {
                  console.error('Error saving work history:', insertError);
                } else {
                  console.log('Work history saved:', insertedHistory);
                  workHistory = insertedHistory || [];
                }
              }
            }
          } else {
            console.error('Resume parse failed:', parseResponse.status);
          }
        }
      } catch (parseError) {
        console.error('Error parsing resume:', parseError);
        // Continue with analysis even if parsing fails
      }
    }

    // Build context for AI analysis
    const workHistoryText = workHistory.length > 0
      ? workHistory.map((wh: any) => `${wh.job_title || 'Unknown role'} at ${wh.employer_name}`).join(', ')
      : 'No work history provided';

    // Parse availability data
    const availability = application.availability || {};
    const availabilityText = JSON.stringify(availability);

    const prompt = `Analyze this job applicant's work history and availability for a restaurant/food service position.

Work History: ${workHistoryText}

Availability: ${availabilityText}

Relevant experience includes:
- Restaurant work (any position: server, cook, host, manager, etc.)
- Food service (catering, food trucks, cafeterias, etc.)
- Customer service roles (retail, hospitality, call centers)
- Retail positions (cashier, sales associate, store manager)

Respond with ONLY a JSON object in this exact format:
{
  "isMatch": true/false,
  "matchReason": "Brief explanation of experience (max 30 words)",
  "availabilityNote": "Brief note about their availability - e.g. 'Full availability', 'Weekends only', 'Weeknights only', 'Limited availability', 'Mornings only', 'Evenings only', etc. (max 20 words)"
}

Set isMatch to true if the applicant has ANY relevant experience in the categories above.
For availabilityNote, summarize when they can work based on the availability data.`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an HR assistant analyzing job applications. Respond only with valid JSON.' },
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Please add credits.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      return new Response(JSON.stringify({ error: 'AI analysis failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || '';
    
    console.log('AI response:', content);

    // Parse AI response
    let analysisResult = { isMatch: false, matchReason: '', availabilityNote: '' };
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
    }

    // Combine match reason and availability note
    const combinedReason = [
      analysisResult.matchReason,
      analysisResult.availabilityNote ? `Availability: ${analysisResult.availabilityNote}` : ''
    ].filter(Boolean).join(' | ');

    // Update application with AI analysis
    const { error: updateError } = await supabase
      .from('job_applications')
      .update({
        ai_match: analysisResult.isMatch,
        ai_match_reason: combinedReason,
        ai_analyzed_at: new Date().toISOString(),
      })
      .eq('id', applicationId);

    if (updateError) {
      console.error('Error updating application:', updateError);
    }

    return new Response(JSON.stringify({
      success: true,
      isMatch: analysisResult.isMatch,
      matchReason: combinedReason,
      workHistoryExtracted: workHistory.length > 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-application:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
