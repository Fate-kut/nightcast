// ── Fill these in from your Supabase project ──
// Settings → API → Project URL / anon public key
export const SUPABASE_URL = "https://udfdpqthmkxmrcjsmfvk.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkZmRwcXRobWt4bXJjanNtZnZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NzQ5ODAsImV4cCI6MjEwMjQ1MDk4MH0.SGj2LNk_t5U4IrVx18DIWxPz8Gab2V0BJVF65nrehcs";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// True once the two values above have actually been replaced.
// Left unfilled, createClient() below would throw on an invalid URL and
// silently kill every script on the page — this keeps the app alive so it
// can show a clear message instead.
export const isConfigured =
  SUPABASE_URL.startsWith("http") && !SUPABASE_ANON_KEY.startsWith("YOUR_");

export const supabase = createClient(
  isConfigured ? SUPABASE_URL : "https://placeholder.supabase.co",
  isConfigured ? SUPABASE_ANON_KEY : "placeholder-anon-key"
);
