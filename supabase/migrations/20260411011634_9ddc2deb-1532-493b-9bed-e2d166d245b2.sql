INSERT INTO storage.buckets (id, name, public) 
VALUES ('seo-pages', 'seo-pages', true)
ON CONFLICT (id) DO NOTHING;