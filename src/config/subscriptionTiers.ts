// Stripe product & price IDs for CrooHQ subscription tiers
// Live mode IDs — synced from Stripe dashboard

export const SUBSCRIPTION_TIERS = {
  core: {
    name: 'Core',
    price: 49,
    price_id: 'price_1T610tCmnsCrRQe0PLjgsDMd',
    product_id: 'prod_U49JcuSK6gmwbv',
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
    price_id: 'price_1T610rCmnsCrRQe016bX9T68',
    product_id: 'prod_U49JpyY8YpSpZP',
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
    price_id: 'price_1T610wCmnsCrRQe0TcPDTjJy',
    product_id: 'prod_U49J9N7epjx3ZR',
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
    price_id: 'price_1T610wCmnsCrRQe007Lt1DIq',
    product_id: 'prod_U49JvCB8e49mts',
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
    price_id: 'price_1T610wCmnsCrRQe09BxeNztN',
    product_id: 'prod_U49JFe9TmbTYJw',
    description: 'Hiring module for Pro tier',
    availableFor: ['pro'] as const,
  },
} as const;

export type TierKey = keyof typeof SUBSCRIPTION_TIERS;

// Map Stripe product_id → tier key for quick lookups
export const PRODUCT_TO_TIER: Record<string, TierKey> = Object.fromEntries(
  Object.entries(SUBSCRIPTION_TIERS).map(([key, tier]) => [tier.product_id, key as TierKey])
) as Record<string, TierKey>;
