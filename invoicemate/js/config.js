/* InvoiceMate config. Everything is local for now: no Google Drive backup, no cloud sync, no API keys.
 * (Allyce's app has a Google OAuth client ID and a Supabase project here; InvoiceMate deliberately leaves them blank,
 * which hides those features. Data stays in this browser: IndexedDB + localStorage.) */
'use strict';
const GOOGLE_CLIENT_ID = '';
const SUPABASE_URL = '';
const SUPABASE_KEY = '';
