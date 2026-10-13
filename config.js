// Public settings only. Safe to commit to GitHub.
// NEVER put the VAPID private key, CRON_SECRET, or service role key here.
window.APP_CONFIG = {
  // Supabase Dashboard > Project Settings > API > Project URL, plus "/functions/v1"
  FUNCTIONS_URL: "https://YOUR_PROJECT_REF.supabase.co/functions/v1",
  // The VAPID PUBLIC key (the one that is safe to share)
  VAPID_PUBLIC_KEY: "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE"
};
