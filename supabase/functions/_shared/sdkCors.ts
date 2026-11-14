// Same CORS headers as `@supabase/supabase-js/cors` (v2.118/2.119), kept local
// so the functions type-check against the project's installed SDK version.
const SUPABASE_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-retry-count",
  "traceparent",
  "tracestate",
  "baggage",
].join(", ");

const SUPABASE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].join(", ");

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": SUPABASE_HEADERS,
  "Access-Control-Allow-Methods": SUPABASE_METHODS,
};
