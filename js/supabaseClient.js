// Supabase browser client configuration.
// Publishable keys are intended for public browser code; never put a secret/service key here.
export const SUPABASE_URL = "https://udfdpqthmkxmrcjsmfvk.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_LtMvpQKwRfJWDyQNjsmWWQ_sY0mprzU";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const isConfigured =
  SUPABASE_URL.startsWith("http") &&
  SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_");

export const supabase = createClient(
  isConfigured ? SUPABASE_URL : "https://placeholder.supabase.co",
  isConfigured ? SUPABASE_PUBLISHABLE_KEY : "placeholder-publishable-key"
);

export function createOwnerClient(ownerToken) {
  return createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    { global: { headers: { "x-nightcast-owner-token": ownerToken } } }
  );
}
