// Public signup endpoint: creates a pre-confirmed account from { username, pin }.
// Deployed with verify_jwt=false because new users have no JWT yet. It does its
// own strict validation and uses the auto-injected service role — no secret in
// the browser, and the project's global email settings are never touched.
//
// The PIN is the whole credential and usernames are short and human, so the
// floor is six digits: four is 10,000 combinations against a guessable name,
// which for an app holding children's rosters is not enough. Existing four-digit
// accounts keep working — only creation is checked here.
//
// verify_jwt=false plus CORS * also made this a free account-creation endpoint
// for anyone who found it, so attempts are counted per address.
//
// A public repo makes that worse: the publishable key is in js/config.js, so
// anyone reading it can reach this endpoint. Set the SIGNUP_INVITE secret and
// only people you gave the code to can make an account:
//
//   supabase secrets set SIGNUP_INVITE=your-code
//
// Leave it unset and signup stays open, which is what a self-hoster running
// this for one team wants.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EMAIL_DOMAIN = 'users.scoreboard.app';
const MAX_PER_HOUR = 5;
const INVITE = (Deno.env.get('SIGNUP_INVITE') ?? '').trim();
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Behind Supabase's proxy the peer address is the proxy, so trust the forwarded
// chain's first hop. Spoofable, which is why this is a speed bump and not a wall.
const clientIp = (req: Request) =>
  (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
  req.headers.get('cf-connecting-ip') ||
  'unknown';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let username = '', pin = '', invite = '';
  try { ({ username = '', pin = '', invite = '' } = await req.json()); } catch { return json({ error: 'Bad request body.' }, 400); }

  const u = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(u)) return json({ error: 'Username must be 3–20 chars: letters, numbers, underscore.' }, 400);
  if (!/^\d{6,8}$/.test(String(pin))) return json({ error: 'PIN must be 6–8 digits.' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    db: { schema: 'scoreboard' },
  });

  // Count this attempt before doing any work, so a refused one still counts.
  const { data: attempts, error: rlErr } = await admin.rpc('note_signup_attempt', {
    p_ip: clientIp(req), p_limit: MAX_PER_HOUR,
  });
  if (!rlErr && typeof attempts === 'number' && attempts > MAX_PER_HOUR) {
    return json({ error: 'Too many sign-ups from here. Try again in an hour.' }, 429);
  }

  // After the throttle on purpose. A wrong code has to count as an attempt,
  // or the code itself is guessable at whatever rate the network allows —
  // five tries an hour is the only thing making a short code worth using.
  if (INVITE && String(invite).trim() !== INVITE) {
    return json({ error: 'This scoreboard is invite-only. Ask the owner for the invite code.' }, 403);
  }

  const { error } = await admin.auth.admin.createUser({
    email: `${u}@${EMAIL_DOMAIN}`,
    password: String(pin),
    email_confirm: true,
    user_metadata: { username: u },
  });
  if (error) return json({ error: /already|registered|exists/i.test(error.message) ? 'That username is taken.' : error.message }, 400);
  return json({ ok: true });
});
