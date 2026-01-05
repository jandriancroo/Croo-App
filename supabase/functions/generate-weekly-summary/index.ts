import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to get array of date strings between two dates
function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  const current = new Date(start);
  
  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

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
            // Check for variance field (current format) or overUnder (legacy)
            const varianceAmount = data.variance ?? data.overUnder ?? null;
            if (varianceAmount !== null && varianceAmount !== undefined) {
              totalOverShort += varianceAmount;
              drawerCountDays++;
              dailyOverShort.push({ date: entry.entry_date, amount: varianceAmount });
            }
          } catch {}
        });
      }
    });

    // 2. Get sales data for the week via fetch-qubeyond-sales edge function
    let totalSales = 0;
    let dailySales: { date: string; sales: number }[] = [];
    let salesByDayOfWeek: Record<string, number> = {};

    try {
      // Use camelCase parameter names as expected by fetch-qubeyond-sales
      const salesResponse = await supabase.functions.invoke('fetch-qubeyond-sales', {
        body: {
          locationId: location_id,
          targetDate: week_end,
        }
      });

      if (salesResponse.data && !salesResponse.error) {
        const salesData = salesResponse.data;
        console.log('Sales data from fetch-qubeyond-sales:', JSON.stringify(salesData).substring(0, 500));
        
        // The response structure has weekly, monthly, daily, comparison fields
        totalSales = salesData.weekly || 0;
        
        // Build daily breakdown from the week's data
        // Fetch daily sales for each day of the week
        const weekDates = getDateRange(week_start, week_end);
        for (const dateStr of weekDates) {
          const dayName = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
          // We'll estimate daily sales from comparison data if available
          salesByDayOfWeek[dayName] = 0; // Will be populated if we have daily data
        }
      } else {
        console.log('No sales data returned or error:', salesResponse.error);
      }
    } catch (e) {
      console.error('Error fetching sales from edge function:', e);
    }

    // 3. Get task completion stats for the week
    // First, get all active non-monthly checklists for this location
    const { data: checklists } = await supabase
      .from('checklists')
      .select(`
        id,
        title,
        frequency,
        assigned_day_of_week,
        checklist_items(id, days_of_week)
      `)
      .eq('location_id', location_id)
      .eq('is_active', true)
      .neq('frequency', 'monthly');

    // Get all submissions for the week
    const { data: submissions } = await supabase
      .from('checklist_submissions')
      .select(`
        *,
        checklist_responses(*),
        checklists(id, title, frequency)
      `)
      .eq('location_id', location_id)
      .gte('submitted_at', week_start)
      .lte('submitted_at', week_end + 'T23:59:59');

    let totalTasksExpected = 0;
    let totalTasksCompleted = 0;

    // Get all dates in the week
    const weekDates = getDateRange(week_start, week_end);
    
    // For each day, check each checklist
    for (const dateStr of weekDates) {
      const date = new Date(dateStr + 'T12:00:00');
      const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
      
      for (const checklist of (checklists || [])) {
        // Determine if this checklist is expected on this day
        let isExpected = false;
        
        if (checklist.frequency === 'daily') {
          isExpected = true;
        } else if (checklist.frequency === 'weekly') {
          // Weekly checklists - check if assigned_day_of_week matches, or if it's a dynamic list (always expected)
          if (checklist.assigned_day_of_week === null || checklist.assigned_day_of_week === dayOfWeek) {
            isExpected = true;
          }
        }
        
        if (!isExpected) continue;
        
        // Count applicable items for this day
        const applicableItems = checklist.checklist_items?.filter((item: any) => {
          // For daily checklists: items with null days_of_week apply to all days
          // For weekly/dynamic checklists: items with null days_of_week are unassigned and should be ignored
          if (!item.days_of_week || item.days_of_week.length === 0) {
            return checklist.frequency === 'daily';
          }
          return item.days_of_week.includes(dayOfWeek);
        }) || [];
        
        const expectedItems = applicableItems.length;
        if (expectedItems === 0) continue; // Skip if no items applicable today
        
        totalTasksExpected += expectedItems;
        
        // Find the best submission for this checklist on this day
        const daySubmissions = submissions?.filter((sub: any) => {
          const subDate = new Date(sub.submitted_at).toISOString().split('T')[0];
          return sub.checklists?.id === checklist.id && subDate === dateStr;
        }) || [];
        
        if (daySubmissions.length > 0) {
          // Get the submission with most responses
          const bestSubmission = daySubmissions.reduce((best: any, current: any) => {
            const bestCount = best?.checklist_responses?.length || 0;
            const currentCount = current?.checklist_responses?.length || 0;
            return currentCount > bestCount ? current : best;
          }, daySubmissions[0]);
          
          totalTasksCompleted += bestSubmission.checklist_responses?.length || 0;
        }
        // If no submission exists, completed stays at 0 for this checklist/day
      }
    }

    const taskCompletionRate = totalTasksExpected > 0 
      ? Math.round((totalTasksCompleted / totalTasksExpected) * 100) 
      : 0;

    // 4. Generate AI summary of sales trends
    let aiSummary = "Weekly sales data unavailable.";
    
    // Get same week last year for YoY comparison
    let lastYearWeekSales = 0;
    let yoyChange = 0;
    
    try {
      // Calculate same week last year (52 weeks back to align on same day of week)
      const lastYearStart = new Date(week_start + 'T12:00:00');
      lastYearStart.setDate(lastYearStart.getDate() - 364); // 52 weeks = 364 days
      const lastYearEnd = new Date(week_end + 'T12:00:00');
      lastYearEnd.setDate(lastYearEnd.getDate() - 364);
      
      const lyStartStr = lastYearStart.toISOString().split('T')[0];
      const lyEndStr = lastYearEnd.toISOString().split('T')[0];
      
      console.log(`Fetching same week last year: ${lyStartStr} to ${lyEndStr}`);
      
      // Fetch each day of last year's week and sum
      const lyDates: string[] = [];
      const current = new Date(lastYearStart);
      while (current <= lastYearEnd) {
        lyDates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }
      
      for (const dateStr of lyDates) {
        try {
          const dayResponse = await supabase.functions.invoke('fetch-qubeyond-sales', {
            body: {
              locationId: location_id,
              targetDate: dateStr,
              skipProjections: true,
            }
          });
          if (dayResponse.data?.daily) {
            lastYearWeekSales += dayResponse.data.daily;
          }
        } catch (e) {
          console.log(`No data for ${dateStr}`);
        }
      }
      
      console.log(`Last year same week total: $${lastYearWeekSales}`);
      
      if (lastYearWeekSales > 0) {
        yoyChange = ((totalSales - lastYearWeekSales) / lastYearWeekSales) * 100;
      }
    } catch (e) {
      console.error('Error fetching YoY comparison data:', e);
    }
    
    if (totalSales > 0) {
      // Build a simple, data-driven summary
      const yoyDirection = yoyChange >= 0 ? 'up' : 'down';
      const yoyAbs = Math.abs(yoyChange).toFixed(1);
      
      if (lastYearWeekSales > 0) {
        aiSummary = `Weekly sales ${yoyDirection} ${yoyAbs}% YoY ($${totalSales.toLocaleString()} vs $${lastYearWeekSales.toLocaleString()} same week last year).`;
      } else {
        aiSummary = `Total weekly sales: $${totalSales.toLocaleString()}.`;
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

    const summaryDataString = JSON.stringify(summaryData);
    console.log('Inserting summary data with length:', summaryDataString.length);
    console.log('Entry ID:', entryData.id, 'Field ID:', summaryField.id);
    
    const { data: insertedValue, error: valueError } = await supabase
      .from('logbook_entry_values')
      .insert({
        entry_id: entryData.id,
        field_id: summaryField.id,
        value_text: summaryDataString,
      })
      .select()
      .single();

    if (valueError) {
      console.error('Error inserting value:', valueError);
      throw valueError;
    }
    
    console.log('Inserted value_text length:', insertedValue?.value_text?.length || 0);

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
