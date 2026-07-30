DROP POLICY IF EXISTS "Service role can create transactions" ON public.croo_cash_transactions;

CREATE POLICY "Service role can create transactions"
ON public.croo_cash_transactions
FOR INSERT
TO service_role
WITH CHECK (true);

-- App path: the entry must be tied to a real shift offer, and the caller must be
-- a participant in that offer (offerer, claimer) or a manager+.
CREATE POLICY "Shift offer participants can create transactions"
ON public.croo_cash_transactions
FOR INSERT
TO authenticated
WITH CHECK (
  shift_offer_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.shift_offers so
    WHERE so.id = croo_cash_transactions.shift_offer_id
      AND (
        so.offered_by_user_id = auth.uid()
        OR so.claimed_by_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.shift_offer_claims soc
          WHERE soc.shift_offer_id = so.id AND soc.user_id = auth.uid()
        )
        OR public.has_role_or_higher(auth.uid(), 'manager')
      )
  )
);

GRANT INSERT ON public.croo_cash_transactions TO authenticated;