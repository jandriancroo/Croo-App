/**
 * OvationUp Token Refresh Script
 * 
 * Uses the ovation-service edge function to refresh the Cognito token
 * via the stored refresh token. Much simpler than PFG since we don't
 * need Playwright — just HTTP calls to AWS Cognito.
 * 
 * Required environment variables (set as GitHub Secrets):
 *   SUPABASE_URL      - Supabase project URL
 *   SUPABASE_ANON_KEY - Supabase anon key
 */

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

async function main() {
  console.log('🔄 OvationUp Token Refresh starting...');

  // 1. Get all active OvationUp brands
  // For now, we know there's one brand — Blaze Pizza
  // In the future, we could query ovation_integrations for all active ones
  const brandId = '5f805404-cc7b-454b-a994-fe5901c32e6a';

  console.log(`📡 Refreshing token for brand: ${brandId}`);

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/ovation-service?action=refresh_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ brandId }),
      }
    );

    const result = await response.json();

    if (result.success) {
      if (result.refreshed) {
        console.log('✅ Token refreshed successfully!');
      } else {
        console.log(`ℹ️ ${result.message}`);
      }
    } else {
      console.error(`❌ Refresh failed: ${result.error}`);
      if (result.details) {
        console.error(`   Details: ${result.details}`);
      }

      // Report failure
      await fetch(
        `${SUPABASE_URL}/functions/v1/support-email-service`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            action: 'create_support_ticket',
            payload: {
              subject: 'OvationUp Token Refresh Failed',
              message: `Automated refresh failed: ${result.error}\n\nDetails: ${result.details || 'None'}`,
              priority: 'high',
            },
          }),
        }
      ).catch(() => {});

      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Fatal error: ${error.message}`);
    process.exit(1);
  }
}

main();
