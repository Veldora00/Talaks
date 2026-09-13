/* Talaks — pre-launch gate.
 *
 * Runs on Cloudflare's edge in front of EVERY request to the site, before any
 * HTML is served. One shared username and password, handed out by text or
 * whatever, rather than a list of email addresses to maintain.
 *
 * THE SWITCH IS THE ENVIRONMENT VARIABLE:
 *
 *   SITE_PASSWORD set    → site is gated
 *   SITE_PASSWORD unset  → site is public
 *
 * So going live is deleting one variable in the Cloudflare dashboard. No code
 * change, no deploy. Set it under:
 *   Workers & Pages → your Pages project → Settings → Variables and Secrets
 *   → add SITE_PASSWORD (choose "Secret" so it is encrypted, not "Text")
 * Optionally SITE_USERNAME too; it defaults to "talaks".
 *
 * The password never appears in this file or the repo — it lives only in that
 * dashboard field, which is the whole point.
 *
 * Two things this is NOT:
 *
 *  1. Protection for your data. Anyone who gets past this still faces
 *     Supabase RLS and the is_admin() checks, which are the real controls.
 *     This just stops strangers browsing the shop before it is ready.
 *
 *  2. Un-shareable. Whoever you give it to can pass it on. That is the
 *     trade you are making for not maintaining a list of people, and for a
 *     pre-launch holding gate it is a fine trade.
 */

const USERNAME_FALLBACK = 'talaks';

/* Compare without leaking how much of the password matched through timing.
 * Overkill for a preview gate, but it costs four lines. */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function decodeBasic(header) {
  if (!header) return null;
  const [scheme, encoded] = header.split(' ');
  if (!encoded || scheme.toLowerCase() !== 'basic') return null;
  let decoded;
  try {
    // atob gives bytes; run them back through UTF-8 so a password with an
    // accent or emoji in it still compares equal to what was typed.
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
  const split = decoded.indexOf(':');
  if (split === -1) return null;
  return { user: decoded.slice(0, split), pass: decoded.slice(split + 1) };
}

const LOCKED_PAGE = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Talaks</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       background:#FBF9F6;color:#161A20;
       font:15px/1.6 Inter,-apple-system,BlinkMacSystemFont,sans-serif}
  .box{max-width:380px;padding:40px 24px;text-align:center}
  h1{font-family:Fraunces,Georgia,serif;font-weight:440;font-size:30px;margin:0 0 12px;
     letter-spacing:-.01em}
  h1 span{color:#E8471F}
  p{color:#5B6472;margin:0}
</style>
<div class="box">
  <h1>Tal<span>a</span>ks</h1>
  <p>Not open yet. If you were given a password, reload the page and enter it.</p>
</div>`;

export async function onRequest({ request, env, next }) {
  const expected = env.SITE_PASSWORD;

  // No password configured — the site is meant to be public. Serve normally.
  if (!expected) return next();

  const creds = decodeBasic(request.headers.get('Authorization'));
  const expectedUser = env.SITE_USERNAME || USERNAME_FALLBACK;

  if (creds && sameSecret(creds.user, expectedUser) && sameSecret(creds.pass, expected)) {
    return next();
  }

  return new Response(LOCKED_PAGE, {
    status: 401,
    headers: {
      // Triggers the browser's own username/password dialog. Plain, but it
      // works with no JavaScript and nothing to bypass.
      // ASCII only. Header values are byte strings, so a stray em-dash or
      // curly quote in the realm throws before the response is even built.
      'WWW-Authenticate': 'Basic realm="Talaks private preview", charset="UTF-8"',
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
