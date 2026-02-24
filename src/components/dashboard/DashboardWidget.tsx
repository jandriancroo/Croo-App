import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, DollarSign, Users, Clock, Target, Pizza, Calendar, LucideIcon, Sparkles, GripVertical, CreditCard } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { format } from 'date-fns';
import { useIsOledTheme } from "@/hooks/useIsOledTheme";

// Widget size types
export type WidgetSize = 'small' | 'medium' | 'large';

// All available metric types - organized by time period
// Order: Sales, Pace, Projected, LW, LY, Guests, Pizzas, Avg Ticket, Labor%, Labor$, Hours
export type MetricType = 
  // Daily metrics
  | 'sales_today'
  | 'sales_pace'
  | 'sales_projected_today'
  | 'sales_last_week'      // Same day last week
  | 'sales_last_year_day'  // Actual last year same day
  | 'guest_count_today'
  | 'pizza_count_today'
  | 'avg_ticket'
  | 'labor_percent_today'
  | 'labor_cost_today'
  | 'labor_hours_today'
  // Weekly metrics (same order)
  | 'sales_wtd'
  | 'sales_pace_week'
  | 'sales_projected_week'
  | 'sales_prev_week'       // Previous full week
  | 'sales_last_year_week'  // Actual last year same week
  | 'guest_count_wtd'
  | 'pizza_count_wtd'
  | 'labor_percent_wtd'
  | 'labor_cost_wtd'
  | 'labor_hours_wtd'
  // Monthly metrics (same order)
  | 'sales_mtd'
  | 'sales_pace_month'
  | 'sales_projected_month'
  | 'sales_prev_month'       // Previous full month
  | 'sales_last_year_month'  // Actual last year same month
  | 'guest_count_mtd'
  | 'pizza_count_mtd'
  | 'labor_percent_mtd'
  | 'labor_cost_mtd'
  | 'labor_hours_mtd'
  // Personal metrics (available to all users)
  | 'personal_hours_week'
  | 'personal_hours_payroll'
  | 'personal_pay_week'
  | 'personal_pay_payroll'
  // Payment type metrics - Daily (amount and percent)
  | 'payment_cash_today' | 'payment_cash_today_pct'
  | 'payment_credit_card_today' | 'payment_credit_card_today_pct'
  | 'payment_olo_doordash_today' | 'payment_olo_doordash_today_pct'
  | 'payment_olo_ubereats_today' | 'payment_olo_ubereats_today_pct'
  | 'payment_olo_combined_today' | 'payment_olo_combined_today_pct'  // Combined OLO (Visa, MC, Prepaid, GC)
  | 'payment_olo_visa_today' | 'payment_olo_visa_today_pct'
  | 'payment_olo_mastercard_today' | 'payment_olo_mastercard_today_pct'
  | 'payment_olo_prepaid_today' | 'payment_olo_prepaid_today_pct'
  | 'payment_olo_giftcard_today' | 'payment_olo_giftcard_today_pct'
  | 'payment_svs_giftcard_today' | 'payment_svs_giftcard_today_pct'
  // Payment type metrics - Weekly
  | 'payment_cash_wtd' | 'payment_cash_wtd_pct'
  | 'payment_credit_card_wtd' | 'payment_credit_card_wtd_pct'
  | 'payment_olo_doordash_wtd' | 'payment_olo_doordash_wtd_pct'
  | 'payment_olo_ubereats_wtd' | 'payment_olo_ubereats_wtd_pct'
  | 'payment_olo_visa_wtd' | 'payment_olo_visa_wtd_pct'
  | 'payment_olo_mastercard_wtd' | 'payment_olo_mastercard_wtd_pct'
  | 'payment_olo_prepaid_wtd' | 'payment_olo_prepaid_wtd_pct'
  | 'payment_olo_giftcard_wtd' | 'payment_olo_giftcard_wtd_pct'
  | 'payment_svs_giftcard_wtd' | 'payment_svs_giftcard_wtd_pct'
  // Payment type metrics - Monthly
  | 'payment_cash_mtd' | 'payment_cash_mtd_pct'
  | 'payment_credit_card_mtd' | 'payment_credit_card_mtd_pct'
  | 'payment_olo_doordash_mtd' | 'payment_olo_doordash_mtd_pct'
  | 'payment_olo_ubereats_mtd' | 'payment_olo_ubereats_mtd_pct'
  | 'payment_olo_visa_mtd' | 'payment_olo_visa_mtd_pct'
  | 'payment_olo_mastercard_mtd' | 'payment_olo_mastercard_mtd_pct'
  | 'payment_olo_prepaid_mtd' | 'payment_olo_prepaid_mtd_pct'
  | 'payment_olo_giftcard_mtd' | 'payment_olo_giftcard_mtd_pct'
  | 'payment_svs_giftcard_mtd' | 'payment_svs_giftcard_mtd_pct'
  // Pace vs Last Year variance (computed %)
  | 'pace_vs_ly_day'
  | 'pace_vs_ly_week'
  | 'pace_vs_ly_month'
  // Legacy aliases (for backwards compatibility)
  | 'labor_percent'
  | 'labor_cost'
  | 'labor_hours'
  | 'sales_last_year';  // Legacy alias for sales_last_week

export interface MetricConfig {
  type: MetricType;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  format: 'currency' | 'percent' | 'percent_signed' | 'number' | 'hours';
  category: 'daily' | 'weekly' | 'monthly';
}

export const METRIC_CONFIGS: Record<MetricType, MetricConfig> = {
  // Daily metrics - Order: Sales, Pace, Projected, Last Wk, Last Yr, Guests, Pizzas, Avg Ticket, Labor%, Labor$, Hours
  sales_today: { type: 'sales_today', label: 'Sales', shortLabel: 'Sales', icon: DollarSign, format: 'currency', category: 'daily' },
  sales_pace: { type: 'sales_pace', label: 'Pace', shortLabel: 'Pace', icon: TrendingUp, format: 'currency', category: 'daily' },
  sales_projected_today: { type: 'sales_projected_today', label: 'Live AI Goal', shortLabel: 'AI Goal', icon: Target, format: 'currency', category: 'daily' },
  sales_last_week: { type: 'sales_last_week', label: 'Last Week', shortLabel: 'SDLW', icon: Calendar, format: 'currency', category: 'daily' },
  sales_last_year_day: { type: 'sales_last_year_day', label: 'Last Year', shortLabel: 'SDLY', icon: Calendar, format: 'currency', category: 'daily' }, // Dynamic: SDLY + date
  guest_count_today: { type: 'guest_count_today', label: 'Guests', shortLabel: 'Guests', icon: Users, format: 'number', category: 'daily' },
  pizza_count_today: { type: 'pizza_count_today', label: 'Pizzas', shortLabel: 'Pizzas', icon: Pizza, format: 'number', category: 'daily' },
  avg_ticket: { type: 'avg_ticket', label: 'Avg Ticket', shortLabel: 'Avg Check', icon: DollarSign, format: 'currency', category: 'daily' },
  labor_percent_today: { type: 'labor_percent_today', label: 'Labor %', shortLabel: 'Lab%', icon: Users, format: 'percent', category: 'daily' },
  labor_cost_today: { type: 'labor_cost_today', label: 'Labor Cost', shortLabel: 'Labor$', icon: DollarSign, format: 'currency', category: 'daily' }, // Hidden (x)
  labor_hours_today: { type: 'labor_hours_today', label: 'Hours', shortLabel: 'Lab Hrs', icon: Clock, format: 'hours', category: 'daily' },
  
  // Weekly metrics - Same order: Sales, Pace, Projected, Last Wk, Last Yr, Guests, Pizzas, Labor%, Labor$, Hours
  sales_wtd: { type: 'sales_wtd', label: 'Sales WTD', shortLabel: 'WTD', icon: DollarSign, format: 'currency', category: 'weekly' },
  sales_pace_week: { type: 'sales_pace_week', label: 'Week Pace', shortLabel: 'Wkly Pace', icon: TrendingUp, format: 'currency', category: 'weekly' },
  sales_projected_week: { type: 'sales_projected_week', label: 'AI Goal EOW', shortLabel: 'EOW Goal', icon: Target, format: 'currency', category: 'weekly' },
  sales_prev_week: { type: 'sales_prev_week', label: 'Last Week', shortLabel: 'LW', icon: Calendar, format: 'currency', category: 'weekly' },
  sales_last_year_week: { type: 'sales_last_year_week', label: 'Last Year', shortLabel: 'SWLY', icon: Calendar, format: 'currency', category: 'weekly' }, // Dynamic: SWLY + Wk#
  guest_count_wtd: { type: 'guest_count_wtd', label: 'Guests WTD', shortLabel: 'WTD Guests', icon: Users, format: 'number', category: 'weekly' },
  pizza_count_wtd: { type: 'pizza_count_wtd', label: 'Pizzas WTD', shortLabel: 'WTD Pizzas', icon: Pizza, format: 'number', category: 'weekly' },
  labor_percent_wtd: { type: 'labor_percent_wtd', label: 'Labor % WTD', shortLabel: 'WTD Lab%', icon: Users, format: 'percent', category: 'weekly' },
  labor_cost_wtd: { type: 'labor_cost_wtd', label: 'Labor Cost WTD', shortLabel: 'Labor$', icon: DollarSign, format: 'currency', category: 'weekly' }, // Hidden (x)
  labor_hours_wtd: { type: 'labor_hours_wtd', label: 'Hours WTD', shortLabel: 'Hrs', icon: Clock, format: 'hours', category: 'weekly' }, // Hidden (x)
  
  // Monthly metrics - Same order: Sales, Pace, Projected, Last Mo, Last Yr, Guests, Pizzas, Labor%, Labor$, Hours
  sales_mtd: { type: 'sales_mtd', label: 'Sales MTD', shortLabel: 'MTD', icon: DollarSign, format: 'currency', category: 'monthly' },
  sales_pace_month: { type: 'sales_pace_month', label: 'Month Pace', shortLabel: 'Pace', icon: TrendingUp, format: 'currency', category: 'monthly' }, // Dynamic: Month + Pace
  sales_projected_month: { type: 'sales_projected_month', label: 'AI Goal EOM', shortLabel: 'EOM Goal', icon: Target, format: 'currency', category: 'monthly' },
  sales_prev_month: { type: 'sales_prev_month', label: 'Last Month', shortLabel: 'LM', icon: Calendar, format: 'currency', category: 'monthly' },
  sales_last_year_month: { type: 'sales_last_year_month', label: 'Last Year', shortLabel: 'SMLY', icon: Calendar, format: 'currency', category: 'monthly' },
  guest_count_mtd: { type: 'guest_count_mtd', label: 'Guests MTD', shortLabel: 'MTD Guests', icon: Users, format: 'number', category: 'monthly' },
  pizza_count_mtd: { type: 'pizza_count_mtd', label: 'Pizzas MTD', shortLabel: 'MTD Pizzas', icon: Pizza, format: 'number', category: 'monthly' },
  labor_percent_mtd: { type: 'labor_percent_mtd', label: 'Labor % MTD', shortLabel: 'MTD Lab%', icon: Users, format: 'percent', category: 'monthly' },
  labor_cost_mtd: { type: 'labor_cost_mtd', label: 'Labor Cost MTD', shortLabel: 'Labor$', icon: DollarSign, format: 'currency', category: 'monthly' }, // Hidden (x)
  labor_hours_mtd: { type: 'labor_hours_mtd', label: 'Hours MTD', shortLabel: 'Hrs', icon: Clock, format: 'hours', category: 'monthly' }, // Hidden (x)
  
  // Personal metrics - available to all users (some hidden)
  personal_hours_week: { type: 'personal_hours_week', label: 'My Hours (Week)', shortLabel: 'My Hrs', icon: Clock, format: 'hours', category: 'weekly' }, // Hidden (x)
  personal_hours_payroll: { type: 'personal_hours_payroll', label: 'My Hours (Payroll)', shortLabel: 'Pay Hrs', icon: Clock, format: 'hours', category: 'weekly' },
  personal_pay_week: { type: 'personal_pay_week', label: 'Est. Pay (Week)', shortLabel: 'My Pay', icon: DollarSign, format: 'currency', category: 'weekly' }, // Hidden (x)
  personal_pay_payroll: { type: 'personal_pay_payroll', label: 'Est. Pay (Payroll)', shortLabel: 'Pay $', icon: DollarSign, format: 'currency', category: 'weekly' },
  
  // Payment type metrics - Daily (amount) - only Cash, CC, DD, UE visible
  payment_cash_today: { type: 'payment_cash_today', label: 'Cash', shortLabel: 'Cash', icon: DollarSign, format: 'currency', category: 'daily' },
  payment_credit_card_today: { type: 'payment_credit_card_today', label: 'Credit Card', shortLabel: 'CC', icon: CreditCard, format: 'currency', category: 'daily' },
  payment_olo_doordash_today: { type: 'payment_olo_doordash_today', label: 'DoorDash', shortLabel: 'DD', icon: CreditCard, format: 'currency', category: 'daily' },
  payment_olo_ubereats_today: { type: 'payment_olo_ubereats_today', label: 'UberEats', shortLabel: 'UE', icon: CreditCard, format: 'currency', category: 'daily' },
  payment_olo_combined_today: { type: 'payment_olo_combined_today', label: 'OLO Total', shortLabel: 'OLO$', icon: CreditCard, format: 'currency', category: 'daily' }, // Combined: Visa + MC + Prepaid + GC
  payment_olo_visa_today: { type: 'payment_olo_visa_today', label: 'OLO Visa', shortLabel: 'OLO V', icon: CreditCard, format: 'currency', category: 'daily' }, // Hidden (x)
  payment_olo_mastercard_today: { type: 'payment_olo_mastercard_today', label: 'OLO MC', shortLabel: 'OLO MC', icon: CreditCard, format: 'currency', category: 'daily' }, // Hidden (x)
  payment_olo_prepaid_today: { type: 'payment_olo_prepaid_today', label: 'OLO Prepaid', shortLabel: 'Prepaid', icon: CreditCard, format: 'currency', category: 'daily' }, // Hidden (x)
  payment_olo_giftcard_today: { type: 'payment_olo_giftcard_today', label: 'OLO Gift Card', shortLabel: 'OLO GC', icon: CreditCard, format: 'currency', category: 'daily' }, // Hidden (x)
  payment_svs_giftcard_today: { type: 'payment_svs_giftcard_today', label: 'SVS Gift Card', shortLabel: 'SVS GC', icon: CreditCard, format: 'currency', category: 'daily' }, // Hidden (x)
  // Payment type metrics - Daily (percent) - all hidden (x)
  payment_cash_today_pct: { type: 'payment_cash_today_pct', label: 'Cash %', shortLabel: 'Cash%', icon: DollarSign, format: 'percent', category: 'daily' },
  payment_credit_card_today_pct: { type: 'payment_credit_card_today_pct', label: 'Credit Card %', shortLabel: 'CC%', icon: CreditCard, format: 'percent', category: 'daily' },
  payment_olo_doordash_today_pct: { type: 'payment_olo_doordash_today_pct', label: 'DoorDash %', shortLabel: 'DD%', icon: CreditCard, format: 'percent', category: 'daily' },
  payment_olo_ubereats_today_pct: { type: 'payment_olo_ubereats_today_pct', label: 'UberEats %', shortLabel: 'UE%', icon: CreditCard, format: 'percent', category: 'daily' },
  payment_olo_combined_today_pct: { type: 'payment_olo_combined_today_pct', label: 'OLO Total %', shortLabel: 'OLO%', icon: CreditCard, format: 'percent', category: 'daily' }, // Combined: Visa + MC + Prepaid + GC
  payment_olo_visa_today_pct: { type: 'payment_olo_visa_today_pct', label: 'OLO Visa %', shortLabel: 'V%', icon: CreditCard, format: 'percent', category: 'daily' },
  payment_olo_mastercard_today_pct: { type: 'payment_olo_mastercard_today_pct', label: 'OLO MC %', shortLabel: 'MC%', icon: CreditCard, format: 'percent', category: 'daily' },
  payment_olo_prepaid_today_pct: { type: 'payment_olo_prepaid_today_pct', label: 'OLO Prepaid %', shortLabel: 'Pre%', icon: CreditCard, format: 'percent', category: 'daily' },
  payment_olo_giftcard_today_pct: { type: 'payment_olo_giftcard_today_pct', label: 'OLO GC %', shortLabel: 'OGC%', icon: CreditCard, format: 'percent', category: 'daily' },
  payment_svs_giftcard_today_pct: { type: 'payment_svs_giftcard_today_pct', label: 'SVS GC %', shortLabel: 'SGC%', icon: CreditCard, format: 'percent', category: 'daily' },
  
  // Payment type metrics - Weekly (amount) - all hidden (x)
  payment_cash_wtd: { type: 'payment_cash_wtd', label: 'Cash WTD', shortLabel: 'Cash', icon: DollarSign, format: 'currency', category: 'weekly' },
  payment_credit_card_wtd: { type: 'payment_credit_card_wtd', label: 'Credit Card WTD', shortLabel: 'CC', icon: CreditCard, format: 'currency', category: 'weekly' },
  payment_olo_doordash_wtd: { type: 'payment_olo_doordash_wtd', label: 'DoorDash WTD', shortLabel: 'DD', icon: CreditCard, format: 'currency', category: 'weekly' },
  payment_olo_ubereats_wtd: { type: 'payment_olo_ubereats_wtd', label: 'UberEats WTD', shortLabel: 'UE', icon: CreditCard, format: 'currency', category: 'weekly' },
  payment_olo_visa_wtd: { type: 'payment_olo_visa_wtd', label: 'OLO Visa WTD', shortLabel: 'OLO V', icon: CreditCard, format: 'currency', category: 'weekly' },
  payment_olo_mastercard_wtd: { type: 'payment_olo_mastercard_wtd', label: 'OLO MC WTD', shortLabel: 'OLO MC', icon: CreditCard, format: 'currency', category: 'weekly' },
  payment_olo_prepaid_wtd: { type: 'payment_olo_prepaid_wtd', label: 'OLO Prepaid WTD', shortLabel: 'Prepaid', icon: CreditCard, format: 'currency', category: 'weekly' },
  payment_olo_giftcard_wtd: { type: 'payment_olo_giftcard_wtd', label: 'OLO GC WTD', shortLabel: 'OLO GC', icon: CreditCard, format: 'currency', category: 'weekly' },
  payment_svs_giftcard_wtd: { type: 'payment_svs_giftcard_wtd', label: 'SVS GC WTD', shortLabel: 'SVS GC', icon: CreditCard, format: 'currency', category: 'weekly' },
  // Payment type metrics - Weekly (percent) - all hidden (x)
  payment_cash_wtd_pct: { type: 'payment_cash_wtd_pct', label: 'Cash % WTD', shortLabel: 'Cash%', icon: DollarSign, format: 'percent', category: 'weekly' },
  payment_credit_card_wtd_pct: { type: 'payment_credit_card_wtd_pct', label: 'CC % WTD', shortLabel: 'CC%', icon: CreditCard, format: 'percent', category: 'weekly' },
  payment_olo_doordash_wtd_pct: { type: 'payment_olo_doordash_wtd_pct', label: 'DD % WTD', shortLabel: 'DD%', icon: CreditCard, format: 'percent', category: 'weekly' },
  payment_olo_ubereats_wtd_pct: { type: 'payment_olo_ubereats_wtd_pct', label: 'UE % WTD', shortLabel: 'UE%', icon: CreditCard, format: 'percent', category: 'weekly' },
  payment_olo_visa_wtd_pct: { type: 'payment_olo_visa_wtd_pct', label: 'OLO V % WTD', shortLabel: 'V%', icon: CreditCard, format: 'percent', category: 'weekly' },
  payment_olo_mastercard_wtd_pct: { type: 'payment_olo_mastercard_wtd_pct', label: 'OLO MC % WTD', shortLabel: 'MC%', icon: CreditCard, format: 'percent', category: 'weekly' },
  payment_olo_prepaid_wtd_pct: { type: 'payment_olo_prepaid_wtd_pct', label: 'Prepaid % WTD', shortLabel: 'Pre%', icon: CreditCard, format: 'percent', category: 'weekly' },
  payment_olo_giftcard_wtd_pct: { type: 'payment_olo_giftcard_wtd_pct', label: 'OLO GC % WTD', shortLabel: 'OGC%', icon: CreditCard, format: 'percent', category: 'weekly' },
  payment_svs_giftcard_wtd_pct: { type: 'payment_svs_giftcard_wtd_pct', label: 'SVS GC % WTD', shortLabel: 'SGC%', icon: CreditCard, format: 'percent', category: 'weekly' },
  
  // Payment type metrics - Monthly (amount) - all hidden (x)
  payment_cash_mtd: { type: 'payment_cash_mtd', label: 'Cash MTD', shortLabel: 'Cash', icon: DollarSign, format: 'currency', category: 'monthly' },
  payment_credit_card_mtd: { type: 'payment_credit_card_mtd', label: 'Credit Card MTD', shortLabel: 'CC', icon: CreditCard, format: 'currency', category: 'monthly' },
  payment_olo_doordash_mtd: { type: 'payment_olo_doordash_mtd', label: 'DoorDash MTD', shortLabel: 'DD', icon: CreditCard, format: 'currency', category: 'monthly' },
  payment_olo_ubereats_mtd: { type: 'payment_olo_ubereats_mtd', label: 'UberEats MTD', shortLabel: 'UE', icon: CreditCard, format: 'currency', category: 'monthly' },
  payment_olo_visa_mtd: { type: 'payment_olo_visa_mtd', label: 'OLO Visa MTD', shortLabel: 'OLO V', icon: CreditCard, format: 'currency', category: 'monthly' },
  payment_olo_mastercard_mtd: { type: 'payment_olo_mastercard_mtd', label: 'OLO MC MTD', shortLabel: 'OLO MC', icon: CreditCard, format: 'currency', category: 'monthly' },
  payment_olo_prepaid_mtd: { type: 'payment_olo_prepaid_mtd', label: 'OLO Prepaid MTD', shortLabel: 'Prepaid', icon: CreditCard, format: 'currency', category: 'monthly' },
  payment_olo_giftcard_mtd: { type: 'payment_olo_giftcard_mtd', label: 'OLO GC MTD', shortLabel: 'OLO GC', icon: CreditCard, format: 'currency', category: 'monthly' },
  payment_svs_giftcard_mtd: { type: 'payment_svs_giftcard_mtd', label: 'SVS GC MTD', shortLabel: 'SVS GC', icon: CreditCard, format: 'currency', category: 'monthly' },
  // Payment type metrics - Monthly (percent) - all hidden (x)
  payment_cash_mtd_pct: { type: 'payment_cash_mtd_pct', label: 'Cash % MTD', shortLabel: 'Cash%', icon: DollarSign, format: 'percent', category: 'monthly' },
  payment_credit_card_mtd_pct: { type: 'payment_credit_card_mtd_pct', label: 'CC % MTD', shortLabel: 'CC%', icon: CreditCard, format: 'percent', category: 'monthly' },
  payment_olo_doordash_mtd_pct: { type: 'payment_olo_doordash_mtd_pct', label: 'DD % MTD', shortLabel: 'DD%', icon: CreditCard, format: 'percent', category: 'monthly' },
  payment_olo_ubereats_mtd_pct: { type: 'payment_olo_ubereats_mtd_pct', label: 'UE % MTD', shortLabel: 'UE%', icon: CreditCard, format: 'percent', category: 'monthly' },
  payment_olo_visa_mtd_pct: { type: 'payment_olo_visa_mtd_pct', label: 'OLO V % MTD', shortLabel: 'V%', icon: CreditCard, format: 'percent', category: 'monthly' },
  payment_olo_mastercard_mtd_pct: { type: 'payment_olo_mastercard_mtd_pct', label: 'OLO MC % MTD', shortLabel: 'MC%', icon: CreditCard, format: 'percent', category: 'monthly' },
  payment_olo_prepaid_mtd_pct: { type: 'payment_olo_prepaid_mtd_pct', label: 'Prepaid % MTD', shortLabel: 'Pre%', icon: CreditCard, format: 'percent', category: 'monthly' },
  payment_olo_giftcard_mtd_pct: { type: 'payment_olo_giftcard_mtd_pct', label: 'OLO GC % MTD', shortLabel: 'OGC%', icon: CreditCard, format: 'percent', category: 'monthly' },
  payment_svs_giftcard_mtd_pct: { type: 'payment_svs_giftcard_mtd_pct', label: 'SVS GC % MTD', shortLabel: 'SGC%', icon: CreditCard, format: 'percent', category: 'monthly' },
  
  // Legacy aliases (map to equivalents for backwards compatibility) - hidden from UI
  labor_percent: { type: 'labor_percent', label: 'Labor %', shortLabel: 'Labor%', icon: Users, format: 'percent', category: 'daily' },
  labor_cost: { type: 'labor_cost', label: 'Labor Cost', shortLabel: 'Labor$', icon: DollarSign, format: 'currency', category: 'daily' },
  labor_hours: { type: 'labor_hours', label: 'Hours', shortLabel: 'Hours', icon: Clock, format: 'hours', category: 'daily' },
  sales_last_year: { type: 'sales_last_year', label: 'Last Week', shortLabel: 'Last Wk', icon: Calendar, format: 'currency', category: 'daily' }, // Legacy alias
};

// Map legacy metric types to current ones for backwards compatibility
export const LEGACY_METRIC_MAP: Record<string, MetricType> = {
  'sales_last_year': 'sales_last_week', // Old name was confusing - was actually same day last week
};

export function migrateMetricType(metric: string): MetricType {
  return (LEGACY_METRIC_MAP[metric] as MetricType) || (metric as MetricType);
}

// Consistent order across all time periods - only includes non-hidden metrics (no "x" from CSV)
export const METRIC_GROUPS = [
  { 
    label: 'Personal', 
    metrics: [
      'personal_hours_payroll', 'personal_pay_payroll'
    ] as MetricType[] 
  },
  { 
    label: 'Daily', 
    metrics: [
      'sales_today', 'sales_pace', 'sales_projected_today', 'sales_last_week', 'sales_last_year_day',
      'guest_count_today', 'pizza_count_today', 'avg_ticket',
      'labor_percent_today', 'labor_hours_today'
    ] as MetricType[] 
  },
  { 
    label: 'Weekly', 
    metrics: [
      'sales_wtd', 'sales_pace_week', 'sales_projected_week', 'sales_prev_week', 'sales_last_year_week',
      'guest_count_wtd', 'pizza_count_wtd',
      'labor_percent_wtd'
    ] as MetricType[] 
  },
  { 
    label: 'Monthly', 
    metrics: [
      'sales_mtd', 'sales_pace_month', 'sales_projected_month', 'sales_prev_month', 'sales_last_year_month',
      'guest_count_mtd', 'pizza_count_mtd',
      'labor_percent_mtd'
    ] as MetricType[] 
  },
  {
    label: 'Payments - Daily',
    metrics: [
      'payment_cash_today', 'payment_cash_today_pct',
      'payment_credit_card_today', 'payment_credit_card_today_pct',
      'payment_olo_doordash_today', 'payment_olo_doordash_today_pct',
      'payment_olo_ubereats_today', 'payment_olo_ubereats_today_pct',
      'payment_olo_combined_today', 'payment_olo_combined_today_pct'
    ] as MetricType[]
  },
];

export interface SalesDataForWidgets {
  daily?: number;
  weekly?: number;
  monthly?: number;
  guestCount?: { daily: number; weekly: number; monthly: number };
  pizzaCount?: number | { daily: number; weekly: number; monthly: number };
  avgTicket?: number;
  comparison?: { prevDay: number; prevDayFullDay?: number; prevWeek: number; prevWeekFullWeek?: number; prevMonth: number; prevMonthFullMonth?: number };
  lastYear?: { sameDay?: number; sameWeek?: number; sameMonth?: number };
  projections?: { todayProjected: number; todayPaceAdjusted?: number; weekProjected: number; weekPaceAdjusted?: number; monthProjected: number; monthPaceAdjusted?: number };
  labor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours?: number; overtimeHours?: number } | null;
  weeklyLabor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours?: number; overtimeHours?: number } | null;
  monthlyLabor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours?: number; overtimeHours?: number } | null;
  hourly?: Array<{ hour: string; sales: number; projected?: number }>;
  weeklyBreakdown?: Array<{ date: string; sales: number; projected?: number }>;
  // Personal metrics data
  personalData?: {
    hoursWeek: number;
    hoursPayroll: number;
    payWeek: number;
    payPayroll: number;
  } | null;
  // Payment types data
  payments?: {
    daily: Array<{ paymentType: string; amount: number }>;
    weekly: Array<{ paymentType: string; amount: number }>;
    monthly: Array<{ paymentType: string; amount: number }>;
  } | null;
}

interface DashboardWidgetProps {
  title?: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor?: string;
  salesData: SalesDataForWidgets | null;
  isLoading?: boolean;
  onClick?: () => void;
  isDragging?: boolean;
  dragHandleProps?: any;
}

export function DashboardWidget({ 
  title, 
  size,
  metrics, 
  accentColor = '#8B5CF6', 
  salesData,
  isLoading = false,
  onClick,
  isDragging = false,
  dragHandleProps,
}: DashboardWidgetProps) {
  const isOled = useIsOledTheme();
  
  // Use primary color for OLED theme instead of custom accent colors
  const effectiveColor = isOled ? 'hsl(215, 30%, 18%)' : accentColor;
  const formatValue = (value: number | undefined, formatType: 'currency' | 'percent' | 'number' | 'hours'): string => {
    if (value === undefined || value === null) return '--';
    
    switch (formatType) {
      case 'currency':
        return `$${Math.round(value).toLocaleString()}`;
      case 'percent':
        return `${value.toFixed(1)}%`;
      case 'hours':
        return `${Math.round(value)}h`;
      case 'number':
        return Math.round(value).toLocaleString();
      default:
        return String(value);
    }
  };

  const getMetricValue = (metricType: MetricType): number | undefined => {
    if (!salesData) return undefined;
    
    switch (metricType) {
      // Daily sales
      case 'sales_today': return salesData.daily;
      case 'sales_pace': return salesData.projections?.todayPaceAdjusted;
      case 'sales_projected_today': return salesData.projections?.todayProjected;
      case 'sales_last_week':
      case 'sales_last_year': return salesData.comparison?.prevDayFullDay; // Legacy alias
      case 'sales_last_year_day': return salesData.lastYear?.sameDay;
      case 'avg_ticket': return salesData.avgTicket;
      
      // Daily guests/products
      case 'guest_count_today': return salesData.guestCount?.daily;
      case 'pizza_count_today': 
        return typeof salesData.pizzaCount === 'number' ? salesData.pizzaCount : salesData.pizzaCount?.daily;
      
      // Daily labor
      case 'labor_percent_today':
      case 'labor_percent': return salesData.labor?.laborPercent;
      case 'labor_cost_today':
      case 'labor_cost': return salesData.labor?.laborCost;
      case 'labor_hours_today':
      case 'labor_hours': return salesData.labor?.hoursWorked;
      
      // Weekly sales
      case 'sales_wtd': return salesData.weekly;
      case 'sales_pace_week': return salesData.projections?.weekPaceAdjusted ?? salesData.projections?.weekProjected;
      case 'sales_projected_week': return salesData.projections?.weekProjected;
      case 'sales_prev_week': return salesData.comparison?.prevWeekFullWeek ?? salesData.comparison?.prevWeek;
      case 'sales_last_year_week': return salesData.lastYear?.sameWeek;
      
      // Weekly guests/products  
      case 'guest_count_wtd': return salesData.guestCount?.weekly;
      case 'pizza_count_wtd':
        return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.weekly : undefined;
      
      // Weekly labor
      case 'labor_percent_wtd': return salesData.weeklyLabor?.laborPercent;
      case 'labor_cost_wtd': return salesData.weeklyLabor?.laborCost;
      case 'labor_hours_wtd': return salesData.weeklyLabor?.hoursWorked;
      
      // Monthly sales
      case 'sales_mtd': return salesData.monthly;
      case 'sales_pace_month': return salesData.projections?.monthPaceAdjusted ?? salesData.projections?.monthProjected;
      case 'sales_projected_month': return salesData.projections?.monthProjected;
      case 'sales_prev_month': return salesData.comparison?.prevMonthFullMonth ?? salesData.comparison?.prevMonth;
      case 'sales_last_year_month': return salesData.lastYear?.sameMonth;
      
      // Monthly guests/products
      case 'guest_count_mtd': return salesData.guestCount?.monthly;
      case 'pizza_count_mtd':
        return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.monthly : undefined;
      
      // Monthly labor
      case 'labor_percent_mtd': return salesData.monthlyLabor?.laborPercent;
      case 'labor_cost_mtd': return salesData.monthlyLabor?.laborCost;
      case 'labor_hours_mtd': return salesData.monthlyLabor?.hoursWorked;
      
      // Personal metrics
      case 'personal_hours_week': return salesData.personalData?.hoursWeek;
      case 'personal_hours_payroll': return salesData.personalData?.hoursPayroll;
      case 'personal_pay_week': return salesData.personalData?.payWeek;
      case 'personal_pay_payroll': return salesData.personalData?.payPayroll;
      
      default: return undefined;
    }
  };

  const displayMetrics = metrics.slice(0, size === 'small' ? 3 : size === 'medium' ? 4 : 6);
  const firstMetricConfig = displayMetrics[0] ? METRIC_CONFIGS[displayMetrics[0]] : null;
  const CornerIcon = firstMetricConfig?.icon;

  // Small widget - post-it note style with page curl
  if (size === 'small') {
    const isSingleMetric = displayMetrics.length === 1;
    const MainIcon = firstMetricConfig?.icon;
    
    // Post-it note pastel colors - expanded palette including app theme colors
    const postItColors: Record<string, { bg: string; bgDark: string; text: string }> = {
      // Original colors
      '#8B5CF6': { bg: '#E9D5FF', bgDark: '#D8B4FE', text: '#6B21A8' }, // Purple/Lavender
      '#0D9488': { bg: '#CCFBF1', bgDark: '#99F6E4', text: '#115E59' }, // Teal/Ocean
      '#F59E0B': { bg: '#FEF3C7', bgDark: '#FDE68A', text: '#92400E' }, // Amber/Yellow
      '#EF4444': { bg: '#FECACA', bgDark: '#FCA5A5', text: '#991B1B' }, // Red/Coral
      '#3B82F6': { bg: '#DBEAFE', bgDark: '#BFDBFE', text: '#1E40AF' }, // Blue
      '#22C55E': { bg: '#DCFCE7', bgDark: '#BBF7D0', text: '#166534' }, // Green/Sage
      '#EC4899': { bg: '#FCE7F3', bgDark: '#FBCFE8', text: '#9D174D' }, // Pink
      // App theme colors
      '#0891B2': { bg: '#CFFAFE', bgDark: '#A5F3FC', text: '#0E7490' }, // Primary teal (Croo)
      '#EA580C': { bg: '#FFEDD5', bgDark: '#FED7AA', text: '#9A3412' }, // Croo orange/accent
      '#92400E': { bg: '#FEF3C7', bgDark: '#FDE68A', text: '#78350F' }, // Earth brown
      '#0F766E': { bg: '#CCFBF1', bgDark: '#99F6E4', text: '#134E4A' }, // Ocean primary
      '#166534': { bg: '#DCFCE7', bgDark: '#BBF7D0', text: '#14532D' }, // Sage green
      '#7C3AED': { bg: '#EDE9FE', bgDark: '#DDD6FE', text: '#5B21B6' }, // Lavender primary
      '#F97316': { bg: '#FFF7ED', bgDark: '#FFEDD5', text: '#C2410C' }, // Blaze orange
      '#14B8A6': { bg: '#F0FDFA', bgDark: '#CCFBF1', text: '#0F766E' }, // Vibrant teal
      '#6366F1': { bg: '#E0E7FF', bgDark: '#C7D2FE', text: '#4338CA' }, // Indigo
      '#84CC16': { bg: '#ECFCCB', bgDark: '#D9F99D', text: '#3F6212' }, // Lime
      '#F472B6': { bg: '#FCE7F3', bgDark: '#FBCFE8', text: '#BE185D' }, // Rose
      '#06B6D4': { bg: '#CFFAFE', bgDark: '#A5F3FC', text: '#0891B2' }, // Cyan
    };
    
    const colorKey = Object.keys(postItColors).find(key => 
      effectiveColor.toLowerCase() === key.toLowerCase()
    ) || Object.keys(postItColors).find(key => 
      effectiveColor.toLowerCase().startsWith(key.toLowerCase().slice(0, 4))
    ) || '#F59E0B';
    const postItStyle = postItColors[colorKey] || { bg: '#FEF3C7', bgDark: '#FDE68A', text: '#92400E' };
    
    return (
      <div 
        className={`min-h-[140px] md:min-h-0 md:aspect-[2/1] cursor-pointer transition-all duration-300 relative group ${isDragging ? 'opacity-50 scale-105' : 'hover:scale-[1.02]'}`}
        onClick={onClick}
        style={{ perspective: '1000px' }}
      >
        {/* Main post-it card */}
        <div 
          className="absolute inset-0 rounded-sm overflow-hidden"
          style={{
            background: isOled 
              ? 'hsl(var(--card))' 
              : `linear-gradient(135deg, ${postItStyle.bg} 0%, ${postItStyle.bgDark} 100%)`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          {/* Subtle paper texture */}
          {!isOled && (
            <div 
              className="absolute inset-0 opacity-[0.03] pointer-events-none"
              style={{
                backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'4\' /%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\' /%3E%3C/svg%3E")',
              }}
            />
          )}
          
          {/* Header with icon */}
          <div className="relative px-3 py-2 md:py-2.5 flex items-center gap-2">
            {MainIcon && (
              <div 
                className="flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-lg"
                style={{ 
                  backgroundColor: isOled ? 'hsl(var(--primary) / 0.2)' : `${postItStyle.text}20`,
                }}
              >
                <MainIcon 
                  className="h-4 w-4 md:h-5 md:w-5" 
                  style={{ color: isOled ? 'hsl(var(--foreground))' : postItStyle.text }}
                />
              </div>
            )}
            <span 
              className="text-xs md:text-sm font-bold truncate flex-1"
              style={{ color: isOled ? 'hsl(var(--foreground))' : postItStyle.text }}
            >
              {title || 'Data'}
            </span>
            {dragHandleProps && (
              <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing">
                <GripVertical 
                  className="h-4 w-4" 
                  style={{ color: isOled ? 'hsl(var(--muted-foreground))' : `${postItStyle.text}60` }}
                />
              </div>
            )}
          </div>
          
          <CardContent className="relative px-3 pb-4 pt-0 md:px-4 md:pb-4">
            {isLoading ? (
              <div className="space-y-2">
                <div className="h-8 w-20 rounded animate-pulse" style={{ backgroundColor: `${postItStyle.text}20` }} />
                <div className="h-3 w-14 rounded animate-pulse" style={{ backgroundColor: `${postItStyle.text}10` }} />
              </div>
            ) : isSingleMetric ? (
              <div className="text-center">
                <span 
                  className="text-3xl md:text-4xl font-black tracking-tight block"
                  style={{ color: isOled ? 'hsl(var(--foreground))' : postItStyle.text }}
                >
                  {formatValue(getMetricValue(displayMetrics[0]), METRIC_CONFIGS[displayMetrics[0]].format)}
                </span>
                <p 
                  className="text-[10px] md:text-xs mt-1 font-medium"
                  style={{ color: isOled ? 'hsl(var(--muted-foreground))' : `${postItStyle.text}99` }}
                >
                  {METRIC_CONFIGS[displayMetrics[0]].label}
                </p>
              </div>
            ) : (
              <div className="space-y-1 md:space-y-1.5">
                {displayMetrics.map((metricType) => {
                  const config = METRIC_CONFIGS[metricType];
                  if (!config) return null;
                  const value = getMetricValue(metricType);
                  return (
                    <div key={metricType} className="flex items-baseline justify-between gap-2">
                      <span 
                        className="text-[10px] md:text-xs font-medium truncate"
                        style={{ color: isOled ? 'hsl(var(--muted-foreground))' : `${postItStyle.text}80` }}
                      >
                        {config.shortLabel}
                      </span>
                      <span 
                        className="text-sm md:text-lg font-bold"
                        style={{ color: isOled ? 'hsl(var(--foreground))' : postItStyle.text }}
                      >
                        {formatValue(value, config.format)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </div>

        {/* Simple page curl - corner peeling up with shadow */}
        {!isOled && (
          <div className="absolute bottom-0 right-0 w-6 h-6 md:w-8 md:h-8 pointer-events-none">
            {/* Shadow under the curl */}
            <div 
              className="absolute bottom-0 right-0 w-full h-full"
              style={{
                background: 'linear-gradient(315deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.06) 40%, transparent 60%)',
                borderTopLeftRadius: '2px',
              }}
            />
            {/* The peeling corner */}
            <div 
              className="absolute bottom-0 right-0 w-full h-full"
              style={{
                background: `linear-gradient(315deg, ${postItStyle.bg} 0%, ${postItStyle.bg} 48%, transparent 52%)`,
                borderTopLeftRadius: '3px',
                boxShadow: '-1px -1px 3px rgba(0,0,0,0.1)',
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // Medium widget (2x1) - wide card with metrics side by side
  if (size === 'medium') {
    return (
      <Card 
        className={`overflow-hidden cursor-pointer hover:shadow-lg transition-all relative ${isDragging ? 'opacity-50 shadow-2xl' : ''}`}
        onClick={onClick}
      >
        {/* Colored header */}
        <div className="px-4 py-2 flex items-center" style={{ backgroundColor: effectiveColor }}>
          <span className="text-sm font-semibold text-white truncate flex-1">{title || 'Data'}</span>
          {dragHandleProps && (
            <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing ml-2">
              <GripVertical className="h-4 w-4 text-white/70" />
            </div>
          )}
        </div>
        
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex-1 space-y-2">
                  <div className="h-6 bg-muted animate-pulse rounded" />
                  <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-4 justify-between">
              {displayMetrics.slice(0, 4).map((metricType) => {
                const config = METRIC_CONFIGS[metricType];
                if (!config) return null;
                const value = getMetricValue(metricType);
                const IconComponent = config.icon;
                
                return (
                  <div key={metricType} className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      <IconComponent className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground truncate">{config.shortLabel}</span>
                    </div>
                    <div className="text-xl font-bold truncate" style={{ color: effectiveColor }}>
                      {formatValue(value, config.format)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Large widget (2x2) - full card with chart (like Sales Overview)
  return (
    <Card 
      className={`overflow-hidden cursor-pointer hover:shadow-lg transition-all ${isDragging ? 'opacity-50 shadow-2xl' : ''}`}
      onClick={onClick}
    >
      {/* Colored header */}
      <div className="px-4 py-3 flex items-center" style={{ backgroundColor: effectiveColor }}>
        <span className="text-sm font-semibold text-white truncate flex-1">{title || 'Sales Overview'}</span>
        {dragHandleProps && (
          <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing ml-2">
            <GripVertical className="h-4 w-4 text-white/70" />
          </div>
        )}
      </div>
      
      <CardContent className="p-4 space-y-4">
        {isLoading ? (
          <>
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="space-y-2">
                  <div className="h-4 bg-muted animate-pulse rounded w-16" />
                  <div className="h-8 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
            <div className="h-[150px] bg-muted animate-pulse rounded" />
          </>
        ) : (
          <>
            {/* Main metrics row */}
            <div className="grid grid-cols-3 gap-4">
              {displayMetrics.slice(0, 3).map((metricType, index) => {
                const config = METRIC_CONFIGS[metricType];
                if (!config) return null;
                const value = getMetricValue(metricType);
                
                return (
                  <div key={metricType} className={index === 1 ? 'text-center' : index === 2 ? 'text-right' : ''}>
                    <p className="text-xs text-muted-foreground">{config.label}</p>
                    <p className="text-2xl font-bold" style={{ color: effectiveColor }}>
                      {formatValue(value, config.format)}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Projection badge if available */}
            {salesData?.projections?.todayProjected && salesData.projections.todayProjected > 0 && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-primary/10 via-purple-500/10 to-amber-500/10 border border-primary/20">
                <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex-shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-[10px] text-muted-foreground">Target EOD</p>
                  <p className="text-sm font-bold">${Math.round(salesData.projections.todayProjected).toLocaleString()}</p>
                </div>
                {salesData.projections.todayPaceAdjusted && (
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">Pacing</p>
                    <p className="text-sm font-bold">${Math.round(salesData.projections.todayPaceAdjusted).toLocaleString()}</p>
                  </div>
                )}
              </div>
            )}

            {/* Chart */}
            {salesData?.hourly && salesData.hourly.length > 0 && (
              <div className="h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={salesData.hourly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="hour" 
                      tick={{ fontSize: 10 }}
                      tickFormatter={(h) => h.replace(':00', '')}
                    />
                    <YAxis 
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip 
                      formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                    />
                    <Bar dataKey="sales" fill={effectiveColor} radius={[4, 4, 0, 0]} />
                    {salesData.hourly.some(h => h.projected) && (
                      <Line 
                        type="monotone" 
                        dataKey="projected" 
                        stroke="hsl(var(--muted-foreground))" 
                        strokeDasharray="5 5"
                        dot={false}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Size picker options for the add widget dialog
export const WIDGET_SIZE_OPTIONS = [
  { 
    size: 'small' as WidgetSize, 
    label: 'Small', 
    description: '1-3 metrics',
    gridClass: 'col-span-1',
    previewClass: 'aspect-square w-16 h-16',
  },
  { 
    size: 'medium' as WidgetSize, 
    label: 'Medium', 
    description: 'Wide with 4 metrics',
    gridClass: 'col-span-2',
    previewClass: 'w-32 h-16',
  },
  { 
    size: 'large' as WidgetSize, 
    label: 'Large', 
    description: 'Full card with chart',
    gridClass: 'col-span-2',
    previewClass: 'w-32 h-32',
  },
];
