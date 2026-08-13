// ---------------------------------------------------------------------------
// Live config. The publishable/anon key is SAFE in client code — Row Level
// Security in Postgres is what actually protects your data.
// ---------------------------------------------------------------------------
export const SUPABASE_URL = 'https://yeykyutsbeqjcgdxlucn.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_SLM96UPQ3Rgrf6MTpXRZUQ_LklkFhPH';

// All app tables live in this Postgres schema.
export const DB_SCHEMA = 'scoreboard';

// Usernames map to a synthetic email internally (never shown to the user).
export const USER_EMAIL_DOMAIN = 'users.scoreboard.app';
