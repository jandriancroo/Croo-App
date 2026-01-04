-- Drop the bank_deposit_entries table first (has foreign key to bank_deposits)
DROP TABLE IF EXISTS public.bank_deposit_entries;

-- Drop the bank_deposits table
DROP TABLE IF EXISTS public.bank_deposits;