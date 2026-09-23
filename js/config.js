// ---------------------------------------------------------------------------
// The one file a self-hoster edits (see "Get your own" in the README): your
// Supabase project URL and publishable key. The publishable/anon key is SAFE in
// client code — Row Level Security in Postgres is what protects the data. The
// same project URL also sits in a preconnect hint in control.html, overlay.html
// and recap.html; scripts/check.mjs fails if they disagree.
// ---------------------------------------------------------------------------
export const SUPABASE_URL = 'https://zhucylsplepnghgybktt.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Vh78iZ3hbb3fO6VF6H4FAQ_8RoQy6Im';

// All app tables live in this Postgres schema.
export const DB_SCHEMA = 'scoreboard';

// Usernames map to a synthetic email internally (never shown to the user).
export const USER_EMAIL_DOMAIN = 'users.scoreboard.app';
