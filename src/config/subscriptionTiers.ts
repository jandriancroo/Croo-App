// Stripe product & price IDs for CrooHQ subscription tiers
// These are TEST mode IDs — replace with live IDs before going to production

export const SUBSCRIPTION_TIERS = {
  core: {
    name: 'Core',
    price: 49,
    price_id: 'price_1T5y0kCwy9IPvWAwNTXMtymJ',
    product_id: 'prod_U46Dmk39Frukyp',
    description: 'Checklists, Tasks, Chat, and Basic Scheduling',
    features: [
      'Checklists & Tasks',
      'Team Chat',
      'Basic Scheduling (CRUD/Templates)',
    ],
  },
  pro: {
    name: 'Pro',
    price: 99,
    price_id: 'price_1T5y1BCwy9IPvWAwU5H4ino8',
    product_id: 'prod_U46Ddqljx7PFxF',
    description: 'Core plus operational tools',
    features: [
      'Everything in Core',
      'Punch Clock & Time Tracking',
      'Sales & Labor Dashboards',
      'Logbook',
      'Availability Management',
      'POS & KDS Integrations',
    ],
  },
  ludicrous: {
    name: 'Ludicrous',
    price: 159,
    price_id: 'price_1T5y1SCwy9IPvWAwa1y6AQKG',
    product_id: 'prod_U46DAyN6JMyz7a',
    description: 'Pro plus Inventory and Hiring',
    features: [
      'Everything in Pro',
      'Inventory Management',
      'Hiring Module',
      'PFG & Produce Alliance Integrations',
    ],
  },
  founder: {
    name: 'Founder',
    price: 99,
    price_id: 'price_1T5y2DCwy9IPvWAwPHxOjOz5',
    product_id: 'prod_U46EAswavZoGIE',
    description: 'Full Ludicrous features at a locked-in early adopter rate',
    features: [
      'Everything in Ludicrous',
      'Locked-in $99/mo rate',
      'Priority support',
    ],
  },
} as const;

export const ADDONS = {
  hiring: {
    name: 'Hiring Add-on',
    price: 20,
    price_id: 'price_1T5y2VCwy9IPvWAwyli4wsGW',
    product_id: 'prod_U46EQLeFd9lkUN',
    description: 'Hiring module for Pro tier',
    availableFor: ['pro'] as const,
  },
} as const;

export type TierKey = keyof typeof SUBSCRIPTION_TIERS;

// Map Stripe product_id → tier key for quick lookups
export const PRODUCT_TO_TIER: Record<string, TierKey> = Object.fromEntries(
  Object.entries(SUBSCRIPTION_TIERS).map(([key, tier]) => [tier.product_id, key as TierKey])
) as Record<string, TierKey>;
