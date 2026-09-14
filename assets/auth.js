/* Talaks — shared auth layer.
 *
 * One Supabase client for the whole site, plus the session helpers, the route
 * guard and the nav account chip. Every page that needs to know who the
 * visitor is loads this instead of carrying its own copy.
 *
 * Load order matters:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/..."></script>
 *   <script src="assets/auth.js"></script>
 */

window.Talaks = (function () {
  'use strict';

  var SUPABASE_URL = 'https://asajwviusixmnoolawnb.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable__KTvqClMNFPO2ZHkueUJmA_101Fl1_D';

  /* The library comes off a CDN, which can be blocked by a network, an ad
   * blocker, or a bad day at jsDelivr. If it isn't there, this script must not
   * take the rest of the page down with it — a marketing page should still
   * read fine without an account chip. Pages that genuinely need auth check
   * `Talaks.ready` and say something useful instead. */
  var ready = !!(window.supabase && window.supabase.createClient);
  var client = ready ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  if (!ready) {
    console.error('Talaks: Supabase library failed to load — account features are unavailable.');
  }

  function offline() {
    return Promise.resolve(null);
  }

  /* --- redirect safety --------------------------------------------------
   * A `next` value arrives from the query string, so it is attacker-supplied.
   * Anything that isn't a plain relative path on this site is thrown away —
   * otherwise a crafted link could bounce a freshly signed-in customer to
   * someone else's lookalike page.
   */
  function safeNext(raw) {
    if (!raw) return null;
    var value = String(raw);
    if (value.indexOf('..') !== -1) return null;
    try {
      // Resolve against our own origin rather than pattern-matching the raw
      // string — browsers strip leading/trailing whitespace and control
      // characters, and normalise backslashes to forward slashes, before a
      // regex ever sees the value, so a blocklist regex can be bypassed by
      // strings that still resolve to somewhere else entirely. Resolving via
      // the URL constructor and comparing the final origin sidesteps all of
      // that: whatever the input looked like, it only passes if it actually
      // lands back on this site.
      var resolved = new URL(value, window.location.origin);
      if (resolved.origin !== window.location.origin) return null;
      // Hand back the exact URL whose origin we just checked. Rebuilding a
      // relative string from the parts re-opens the hole the origin check
      // closed: "/https://evil.com" and "/javascript:alert(1)" both resolve
      // to harmless paths on this origin, but stripping the leading slash
      // turns them back into an absolute URL and a javascript: URL, and
      // "//evil.com" stays protocol-relative even with the slash kept.
      return resolved.href;
    } catch (e) {
      return null;
    }
  }

  function currentPageAsNext() {
    return window.location.pathname.split('/').pop() + window.location.search;
  }

  function signInUrl(next) {
    var target = safeNext(next);
    return 'signin.html' + (target ? '?next=' + encodeURIComponent(target) : '');
  }

  /* --- session ---------------------------------------------------------- */

  function getSession() {
    if (!ready) return offline();
    return client.auth.getSession().then(function (res) {
      return res.data.session || null;
    });
  }

  function getUser() {
    return getSession().then(function (s) { return s ? s.user : null; });
  }

  /* Replace the page body with a plain explanation. Used when the auth
   * library never loaded — bouncing to sign-in would only fail there too. */
  function renderUnavailable() {
    document.body.innerHTML =
      '<div style="max-width:440px;margin:0 auto;padding:90px 24px;text-align:center;' +
      'font-family:Inter,-apple-system,sans-serif;color:#5B6472;">' +
      '<h1 style="font-family:Fraunces,Georgia,serif;font-weight:440;font-size:26px;' +
      'color:#161A20;margin:0 0 10px;">We can’t reach our servers</h1>' +
      '<p style="font-size:14.5px;line-height:1.6;margin:0 0 22px;">Something is blocking the ' +
      'connection — often an ad blocker, a strict network, or a brief outage. ' +
      'Try again in a moment.</p>' +
      '<a href="index.html" style="font-size:14px;color:#E8471F;">Back to the homepage</a>' +
      '</div>';
  }

  /* Redirect to the sign-in page unless someone is signed in.
   * Resolves with the session so callers can carry on with the page. */
  function requireAuth() {
    if (!ready) { renderUnavailable(); return offline(); }
    return getSession().then(function (session) {
      if (!session) {
        window.location.replace(signInUrl(currentPageAsNext()));
        return null;
      }
      return session;
    });
  }

  function signOut() {
    if (!ready) { window.location.href = 'index.html'; return offline(); }
    return client.auth.signOut().then(function () {
      window.location.href = 'index.html';
    });
  }

  /* --- profiles --------------------------------------------------------- */

  function getProfile(userId) {
    if (!ready) return offline();
    return client.from('profiles').select('*').eq('id', userId).maybeSingle()
      .then(function (res) { return res.data || null; });
  }

  /* Upsert so the first save creates the row and later saves update it —
   * the RLS policies allow both for auth.uid() = id. */
  function saveProfile(userId, fields) {
    if (!ready) return Promise.resolve({ error: { message: 'Not connected. Please reload and try again.' } });
    var row = Object.assign({ id: userId, updated_at: new Date().toISOString() }, fields);
    return client.from('profiles').upsert(row, { onConflict: 'id' });
  }

  /* --- verification ----------------------------------------------------- */

  /* Verification state for this user.
   *
   * An Approved row WINS over a newer unfinished one. Someone who verified in
   * March and then idly clicked the button again in June is still verified —
   * reading only the most recent row would tell them otherwise and send them
   * through an ID check they don't need. Verification here does not expire:
   * once we know who someone is, we know. */
  function latestVerification(userId) {
    if (!ready) return offline();
    return client.from('verifications')
      .select('session_id, status, created_at, manual_override')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(function (res) {
        var rows = res.data || [];
        if (!rows.length) return null;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].status === 'Approved') return rows[i];
        }
        return rows[0];
      });
  }

  var SUBSCRIPTION_FIELDS =
    'id, device_id, storage_gb, colour, term_months, monthly_amount_cents, status, ' +
    'current_period_end, cancel_at, created_at';

  /* Every plan this customer has, newest first.
   *
   * Nothing stops someone taking a second plan — a phone for a partner, an
   * upgrade started before the old term ends — and reading one row would
   * quietly hide the others, including a second order they are being charged
   * for. The account page renders whatever comes back. */
  function allSubscriptions(userId) {
    if (!ready) return Promise.resolve([]);
    return client.from('subscriptions')
      .select(SUBSCRIPTION_FIELDS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(25)
      .then(function (res) { return res.data || []; });
  }

  /* Most recent plan, whatever its state. */
  function latestSubscription(userId) {
    if (!ready) return offline();
    return client.from('subscriptions')
      .select(SUBSCRIPTION_FIELDS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(function (res) { return res.data || null; });
  }

  /* --- nav chip ---------------------------------------------------------
   * Injected rather than pasted into eight page templates. Pages only need a
   * <nav> with a .row inside; the chip lands at the end of it. The styles ship
   * with the script so the older pages can stay on their own CSS — variables
   * carry fallbacks for the same reason.
   */
  var CHIP_CSS =
    '.nav-account{font-size:14px;color:var(--ink-dim,#5B6472);text-decoration:none;' +
    'border:1px solid var(--line-strong,rgba(22,26,32,0.18));border-radius:999px;' +
    'padding:7px 16px;white-space:nowrap;transition:border-color .15s,color .15s;}' +
    '.nav-account:hover{color:var(--ink,#161A20);border-color:var(--ink-faint,#8B93A1);}' +
    '.nav-account.signed-in{border-color:var(--teal,#1E9E82);color:var(--teal,#1E9E82);}';

  function injectChipCss() {
    if (document.getElementById('talaks-chip-css')) return;
    var style = document.createElement('style');
    style.id = 'talaks-chip-css';
    style.textContent = CHIP_CSS;
    document.head.appendChild(style);
  }

  function mountNav() {
    // No auth library means no account chip — the rest of the page is fine.
    if (!ready) return;
    var row = document.querySelector('nav .row');
    if (!row || row.querySelector('.nav-account')) return;
    injectChipCss();

    var link = document.createElement('a');
    link.className = 'nav-account';
    link.textContent = 'Sign in';
    link.href = signInUrl(currentPageAsNext());

    // index.html ends its nav with a "Get started" CTA — sit before it so the
    // primary action stays rightmost.
    var cta = row.querySelector('.navcta');
    if (cta) row.insertBefore(link, cta); else row.appendChild(link);

    getSession().then(function (session) {
      if (!session) return;
      link.textContent = 'Account';
      link.href = 'account.html';
      link.classList.add('signed-in');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountNav);
  } else {
    mountNav();
  }

  return {
    ready: ready,
    renderUnavailable: renderUnavailable,
    client: client,
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    safeNext: safeNext,
    signInUrl: signInUrl,
    currentPageAsNext: currentPageAsNext,
    getSession: getSession,
    getUser: getUser,
    requireAuth: requireAuth,
    signOut: signOut,
    getProfile: getProfile,
    saveProfile: saveProfile,
    latestVerification: latestVerification,
    latestSubscription: latestSubscription,
    allSubscriptions: allSubscriptions,
  };
})();
