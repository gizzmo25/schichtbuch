/*
 * Schichtbuch — Konfiguration.
 * Beide Werte stehen im Supabase-Dashboard unter Project Settings -> API Keys / Data API.
 * Der Publishable Key (frueher "anon key") darf oeffentlich im Repository stehen:
 * der Zugriff auf die Daten wird durch Login + Row Level Security geschuetzt.
 * NIEMALS den Secret Key / service_role Key hier eintragen.
 */
globalThis.SCHICHTBUCH_CONFIG = {
  supabaseUrl: "https://amyolekxbowttdsxunbm.supabase.co",
  supabaseKey: "sb_publishable_RIsMEbFLr_NWjfeqEnlCsg_hTWRbcBp",
};
