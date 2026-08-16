// ── Fill these in from your Supabase project ──
export const SUPABASE_URL = "https://udfdpqthmkxmrcjsmfvk.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzIiwicmVmIjoidWRmZHBxdGhta3htcmNqc21mdmsiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc4Njg3NDk4MCwiZXhwIjoyMTAyNDUwOTgwfQ.SGj2LNk_t5U4IrVx18DIWxPz8Gab2V0BJVF65nrehcs";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const isConfigured =
  SUPABASE_URL.startsWith("http") && !SUPABASE_ANON_KEY.startsWith("YOUR_");

export const supabase = createClient(
  isConfigured ? SUPABASE_URL : "https://placeholder.supabase.co",
  isConfigured ? SUPABASE_ANON_KEY : "placeholder-anon-key"
);

export function createOwnerClient(ownerToken) {
  return createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    { global: { headers: { "x-nightcast-owner-token": ownerToken } } }
  );
}
