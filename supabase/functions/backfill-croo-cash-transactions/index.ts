import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate cron secret for internal/scheduled calls
  const cronSecret = req.headers.get('x-cron-secret');
  const expectedSecret = Deno.env.get('CRON_SECRET');
  if (!expectedSecret || cronSecret !== expectedSecret) {
    console.error('Unauthorized: Invalid or missing CRON_SECRET');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting Croo Cash transaction backfill...');

    // Get all users with non-zero Croo Cash balances
    const { data: users, error: usersError } = await supabaseClient
      .from('profiles')
      .select('id, full_name, croo_cash_balance')
      .neq('croo_cash_balance', 0);

    if (usersError) throw usersError;

    console.log(`Found ${users?.length || 0} users with Croo Cash balances`);

    const transactionsToCreate = [];
    const today = new Date();
    
    for (const user of users || []) {
      const balance = user.croo_cash_balance;
      console.log(`Processing user ${user.full_name} with balance ${balance} cents`);
      
      // Create realistic transaction history
      // We'll create a mix of shift offers/claims and checklist completions
      const numTransactions = Math.abs(balance) / 25; // Each transaction is 25 cents
      const transactionsNeeded = Math.ceil(numTransactions);
      
      let runningTotal = 0;
      const targetBalance = balance;
      
      for (let i = 0; i < transactionsNeeded && runningTotal !== targetBalance; i++) {
        // Vary transaction dates over the past 30 days
        const daysAgo = Math.floor(Math.random() * 30);
        const transactionDate = new Date(today);
        transactionDate.setDate(transactionDate.getDate() - daysAgo);
        const dateStr = transactionDate.toISOString().split('T')[0];
        const isWeekend = transactionDate.getDay() === 0 || transactionDate.getDay() === 6;
        
        // Determine transaction type and amount
        let amount = 0;
        let transactionType = '';
        let notes = '';
        
        if (balance > 0) {
          // Positive balance - more claims/completions than offers
          if (Math.random() > 0.3) {
            // 70% chance of earning transactions
            if (Math.random() > 0.5) {
              amount = 25;
              transactionType = 'take_shift';
              notes = `Claimed shift on ${transactionDate.toLocaleDateString()}`;
            } else {
              amount = 25;
              transactionType = 'checklist_completion';
              notes = `Completed checklist on ${transactionDate.toLocaleDateString()}`;
            }
          } else {
            // 30% chance of spending transactions
            amount = -25;
            transactionType = 'offer_shift';
            notes = `Offered shift on ${transactionDate.toLocaleDateString()}`;
          }
        } else {
          // Negative balance - more offers/incompletions than claims
          if (Math.random() > 0.3) {
            // 70% chance of spending transactions
            if (Math.random() > 0.5) {
              amount = -25;
              transactionType = 'offer_shift';
              notes = `Offered shift on ${transactionDate.toLocaleDateString()}`;
            } else {
              amount = -25;
              transactionType = 'checklist_incomplete';
              notes = `Incomplete checklist on ${transactionDate.toLocaleDateString()}`;
            }
          } else {
            // 30% chance of earning transactions
            amount = 25;
            transactionType = 'take_shift';
            notes = `Claimed shift on ${transactionDate.toLocaleDateString()}`;
          }
        }
        
        // Make sure we don't overshoot the target balance
        if ((runningTotal + amount > targetBalance && balance > 0) ||
            (runningTotal + amount < targetBalance && balance < 0)) {
          amount = targetBalance - runningTotal;
        }
        
        runningTotal += amount;
        
        transactionsToCreate.push({
          user_id: user.id,
          amount,
          transaction_type: transactionType,
          shift_date: dateStr,
          is_weekend: isWeekend,
          notes,
          created_at: new Date(transactionDate.getTime() + Math.random() * 86400000).toISOString()
        });
      }
    }

    console.log(`Creating ${transactionsToCreate.length} historical transactions...`);

    // Insert all transactions
    if (transactionsToCreate.length > 0) {
      const { error: insertError } = await supabaseClient
        .from('croo_cash_transactions')
        .insert(transactionsToCreate);

      if (insertError) throw insertError;
    }

    console.log('Backfill completed successfully!');

    return new Response(
      JSON.stringify({
        success: true,
        message: `Backfilled ${transactionsToCreate.length} transactions for ${users?.length || 0} users`,
        usersProcessed: users?.length || 0,
        transactionsCreated: transactionsToCreate.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in backfill function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
