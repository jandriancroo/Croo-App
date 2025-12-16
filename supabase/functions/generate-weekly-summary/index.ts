import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { location_id, week_start, week_end, user_id } = await req.json();
    
    console.log('Generating weekly summary for location:', location_id, 'week:', week_start, 'to', week_end);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get all drawer counts for the week to calculate over/short
    const { data: drawerEntries } = await supabase
      .from('logbook_entries')
      .select(`
        *,
        logbook_entry_values(*),
        logbook_categories(name)
      `)
      .eq('location_id', location_id)
      .gte('entry_date', week_start)
      .lte('entry_date', week_end);

    let totalOverShort = 0;
    let drawerCountDays = 0;
    const dailyOverShort: { date: string; amount: number }[] = [];

    drawerEntries?.forEach((entry: any) => {
      if (entry.logbook_categories?.name?.toLowerCase() === 'drawer count') {
        entry.logbook_entry_values?.forEach((val: any) => {
          try {
            const data = JSON.parse(val.value_text || '{}');
            if (data.overUnder !== undefined) {
              totalOverShort += data.overUnder;
              drawerCountDays++;
              dailyOverShort.push({ date: entry.entry_date, amount: data.overUnder });
            }
          } catch {}
        });
      }
    });

    // 2. Get sales data for the week from location_integrations (QuBeyond)
    const { data: integration } = await supabase
      .from('location_integrations')
      .select('credentials')
      .eq('location_id', location_id)
      .eq('integration_type', 'qubeyond')
      .eq('is_active', true)
      .maybeSingle();

    let totalSales = 0;
    let dailySales: { date: string; sales: number }[] = [];
    let salesByDayOfWeek: Record<string, number> = {};

    if (integration?.credentials) {
      // Fetch sales from QuBeyond for each day of the week
      const credentials = integration.credentials as { sid: string; cid: string; username: string; password: string };
      
      const startDate = new Date(week_start);
      const endDate = new Date(week_end);
      
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
        
        try {
          const authHeader = 'Basic ' + btoa(`${credentials.username}:${credentials.password}`);
          const url = `https://api.qubeyond.com/v2/data/net-sales?sid=${credentials.sid}&cid=${credentials.cid}&date=${dateStr}`;
          
          const response = await fetch(url, {
            headers: { 'Authorization': authHeader }
          });
          
          if (response.ok) {
            const data = await response.json();
            const daySales = data?.data?.[0]?.net_sales || 0;
            totalSales += daySales;
            dailySales.push({ date: dateStr, sales: daySales });
            salesByDayOfWeek[dayName] = daySales;
          }
        } catch (e) {
          console.error('Error fetching sales for', dateStr, e);
        }
      }
    }

    // 3. Get task completion stats for the week
    const { data: submissions } = await supabase
      .from('checklist_submissions')
      .select(`
        *,
        checklist_responses(*),
        checklists(title, checklist_items(id))
      `)
      .eq('location_id', location_id)
      .gte('submitted_at', week_start)
      .lte('submitted_at', week_end + 'T23:59:59');

    let totalTasksExpected = 0;
    let totalTasksCompleted = 0;

    submissions?.forEach((sub: any) => {
      const expectedItems = sub.checklists?.checklist_items?.length || 0;
      const completedItems = sub.checklist_responses?.length || 0;
      totalTasksExpected += expectedItems;
      totalTasksCompleted += completedItems;
    });

    const taskCompletionRate = totalTasksExpected > 0 
      ? Math.round((totalTasksCompleted / totalTasksExpected) * 100) 
      : 0;

    // 4. Generate AI summary of sales trends
    let aiSummary = "Weekly sales data unavailable.";
    
    if (dailySales.length > 0) {
      const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
      
      if (LOVABLE_API_KEY) {
        const weekendSales = (salesByDayOfWeek['Saturday'] || 0) + (salesByDayOfWeek['Sunday'] || 0);
        const weekdaySales = totalSales - weekendSales;
        const avgDailySales = totalSales / dailySales.length;
        
        const prompt = `Analyze this week's restaurant sales data and provide ONE short sentence summary (under 15 words):
- Total sales: $${totalSales.toFixed(2)}
- Daily breakdown: ${dailySales.map(d => `${d.date}: $${d.sales.toFixed(2)}`).join(', ')}
- Weekend (Sat+Sun): $${weekendSales.toFixed(2)}
- Weekdays: $${weekdaySales.toFixed(2)}
- Average daily: $${avgDailySales.toFixed(2)}

Describe the trend: was it a busy/slow week, strong/weak weekend, etc. Be concise.`;

        try {
          const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: 'You are a concise restaurant business analyst. Respond with exactly one short sentence.' },
                { role: 'user', content: prompt }
              ],
            }),
          });

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            aiSummary = aiData.choices?.[0]?.message?.content?.trim() || aiSummary;
          }
        } catch (e) {
          console.error('AI summary error:', e);
        }
      }
    }

    // 5. Create the weekly summary log entry
    // First, find or create the "Weekly Summary" category
    let { data: summaryCategory } = await supabase
      .from('logbook_categories')
      .select('id')
      .eq('location_id', location_id)
      .eq('name', 'Weekly Summary')
      .maybeSingle();

    if (!summaryCategory) {
      const { data: newCategory } = await supabase
        .from('logbook_categories')
        .insert({
          name: 'Weekly Summary',
          location_id: location_id,
          is_active: true,
          alert_enabled: false,
          display_order: 999,
        })
        .select()
        .single();
      summaryCategory = newCategory;
    }

    if (!summaryCategory) {
      throw new Error('Failed to create Weekly Summary category');
    }

    // Find or create the field for the summary data
    let { data: summaryField } = await supabase
      .from('logbook_fields')
      .select('id')
      .eq('category_id', summaryCategory.id)
      .eq('field_name', 'summary_data')
      .maybeSingle();

    if (!summaryField) {
      const { data: newField, error: fieldError } = await supabase
        .from('logbook_fields')
        .insert({
          category_id: summaryCategory.id,
          field_name: 'summary_data',
          field_type: 'text',
          is_required: false,
          display_order: 0,
        })
        .select()
        .single();
      if (fieldError) throw fieldError;
      summaryField = newField;
    }

    if (!summaryField) {
      throw new Error('Failed to create summary field');
    }

    // Delete any existing weekly summary for this week
    const { data: existingSummaries } = await supabase
      .from('logbook_entries')
      .select('id')
      .eq('category_id', summaryCategory.id)
      .eq('entry_date', week_end)
      .eq('location_id', location_id);

    if (existingSummaries && existingSummaries.length > 0) {
      for (const existing of existingSummaries) {
        await supabase.from('logbook_entry_values').delete().eq('entry_id', existing.id);
        await supabase.from('logbook_entries').delete().eq('id', existing.id);
      }
    }

    // Create the entry
    const { data: entryData, error: entryError } = await supabase
      .from('logbook_entries')
      .insert({
        category_id: summaryCategory.id,
        entry_date: week_end,
        created_by: user_id,
        location_id: location_id,
      })
      .select()
      .single();

    if (entryError) throw entryError;

    // Create the summary data
    const summaryData = {
      type: 'weekly_summary',
      week_start,
      week_end,
      total_sales: totalSales,
      daily_sales: dailySales,
      total_over_short: totalOverShort,
      daily_over_short: dailyOverShort,
      task_completion_rate: taskCompletionRate,
      tasks_completed: totalTasksCompleted,
      tasks_expected: totalTasksExpected,
      ai_summary: aiSummary,
      generated_at: new Date().toISOString(),
    };

    const { error: valueError } = await supabase
      .from('logbook_entry_values')
      .insert({
        entry_id: entryData.id,
        field_id: summaryField.id,
        value_text: JSON.stringify(summaryData),
      });

    if (valueError) throw valueError;

    console.log('Weekly summary generated successfully');

    return new Response(JSON.stringify({ success: true, data: summaryData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error generating weekly summary:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
