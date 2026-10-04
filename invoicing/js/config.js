/* Invoicing: deploy-time config. Safe to commit (an OAuth client ID is public, not a secret).
 * GOOGLE_CLIENT_ID: OAuth 2.0 "Web application" client ID from Google Cloud Console
 * (looks like 1234567890-abc...apps.googleusercontent.com). Leave '' to hide Google Drive backup. */
'use strict';
const GOOGLE_CLIENT_ID = '295146519087-4r1usln4vtc5asq56gttk0jcevlqg2fc.apps.googleusercontent.com';
/* Cloud sync (Supabase, Sydney). Both values are public by design: data is protected by row-level security.
 * Never put the service_role / secret key or the database password here. Leave '' to hide cloud sync. */
const SUPABASE_URL = 'https://opekqrldytqvjziowbqo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Kx9Q3ammN998eEFj6uJ8Sw_QZ8bl99w';
/* Outlook drafts (Microsoft Graph). Application (client) ID of the Azure app registration: personal Microsoft accounts,
 * Single-page application platform, redirect URI .../invoicing/auth.html, delegated Mail.ReadWrite. Public, not a secret.
 * Leave '' to hide Connect Outlook. */
const OUTLOOK_CLIENT_ID = '0511f0d6-dba8-4f57-90e6-b4d0db507a1f';
