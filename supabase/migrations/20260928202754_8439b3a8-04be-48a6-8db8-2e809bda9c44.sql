DO $$ DECLARE c text; BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid='public.labor_cache'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%source%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.labor_cache DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE public.labor_cache ADD CONSTRAINT labor_cache_source_check CHECK (source IN ('qubeyond','punch_clock','aloha','clover','toast'));