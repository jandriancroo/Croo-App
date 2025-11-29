
-- Update croo_cash_transactions to allow checklist transaction types
ALTER TABLE croo_cash_transactions 
DROP CONSTRAINT IF EXISTS croo_cash_transactions_transaction_type_check;

ALTER TABLE croo_cash_transactions 
ADD CONSTRAINT croo_cash_transactions_transaction_type_check 
CHECK (transaction_type IN ('offer_shift', 'take_shift', 'checklist_completion', 'incomplete_checklist'));
