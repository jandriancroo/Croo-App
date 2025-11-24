-- Create shift offers table
CREATE TABLE shift_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES scheduled_shifts(id) ON DELETE CASCADE,
  offered_by_user_id UUID NOT NULL REFERENCES profiles(id),
  claimed_by_user_id UUID REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'claimed', 'approved', 'denied', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS policies for shift_offers
ALTER TABLE shift_offers ENABLE ROW LEVEL SECURITY;

-- Anyone can view shift offers
CREATE POLICY "Anyone can view shift offers"
  ON shift_offers FOR SELECT
  USING (true);

-- Users can create offers for their own shifts
CREATE POLICY "Users can offer their own shifts"
  ON shift_offers FOR INSERT
  WITH CHECK (
    auth.uid() = offered_by_user_id AND
    EXISTS (
      SELECT 1 FROM scheduled_shifts
      WHERE scheduled_shifts.id = shift_offers.shift_id
      AND scheduled_shifts.user_id = auth.uid()
    )
  );

-- Users can claim available offers
CREATE POLICY "Users can claim available offers"
  ON shift_offers FOR UPDATE
  USING (status = 'available' AND claimed_by_user_id IS NULL)
  WITH CHECK (auth.uid() = claimed_by_user_id AND status = 'claimed');

-- Admins and managers can approve/deny claims
CREATE POLICY "Admins and managers can manage offers"
  ON shift_offers FOR UPDATE
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'manager'::app_role)
  );

-- Users can cancel their own offers if not claimed
CREATE POLICY "Users can cancel their own offers"
  ON shift_offers FOR UPDATE
  USING (
    auth.uid() = offered_by_user_id AND 
    status = 'available' AND 
    claimed_by_user_id IS NULL
  )
  WITH CHECK (status = 'cancelled');

-- Create indexes for performance
CREATE INDEX idx_shift_offers_status ON shift_offers(status);
CREATE INDEX idx_shift_offers_shift_id ON shift_offers(shift_id);