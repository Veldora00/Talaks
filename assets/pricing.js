/* Talaks — one place that knows how a device is priced.
 *
 * Every storage tier carries its own explicit monthly price per term:
 *
 *   storages: [
 *     { gb: "256GB", rrp: 1399, monthly: { "12": 67, "24": 51 } },
 *     { gb: "512GB", rrp: 1949, monthly: { "12": 110, "24": 70, "36": 54 } }
 *   ]
 *
 * The number a customer sees is the number in that map — nothing is derived,
 * rounded or scaled on the page. The product page, the catalogue cards, the
 * homepage and the checkout summary all read through these helpers so they
 * cannot disagree with each other or with the server, which reads the same
 * map when it creates the order.
 *
 * Load after supabase-js if the page needs it; this file has no dependencies.
 */
window.TalaksPricing = (function () {
  'use strict';

  var TERM_ORDER = [12, 24, 36];

  /* Terms this storage tier is sold on, in ascending order. A tier with no
   * monthly map isn't for sale. */
  function termsFor(storage) {
    if (!storage || !storage.monthly) return [];
    return TERM_ORDER.filter(function (t) {
      var v = Number(storage.monthly[String(t)]);
      return Number.isFinite(v) && v > 0;
    });
  }

  /* Monthly price for a tier at a term, or null if not offered. */
  function monthly(storage, term) {
    if (!storage || !storage.monthly) return null;
    var v = Number(storage.monthly[String(term)]);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  function total(storage, term) {
    var m = monthly(storage, term);
    return m === null ? null : m * Number(term);
  }

  /* How far below RRP the plan sits. Positive means under the line. */
  function headroom(storage, term) {
    var t = total(storage, term);
    return t === null ? null : Number(storage.rrp) - t;
  }

  /* Storage tiers that are actually sellable. */
  function sellableStorages(device) {
    return (device && device.storages || []).filter(function (s) {
      return termsFor(s).length > 0;
    });
  }

  /* The union of terms across a device's tiers — what the term picker shows.
   * A term the chosen tier doesn't offer is rendered disabled, not hidden, so
   * a customer sees that 36 months exists and which tier it belongs to. */
  function termsForDevice(device) {
    var seen = {};
    sellableStorages(device).forEach(function (s) {
      termsFor(s).forEach(function (t) { seen[t] = true; });
    });
    return TERM_ORDER.filter(function (t) { return seen[t]; });
  }

  /* "From $X/mo" for a card: the lowest monthly across every tier and term,
   * preferring the longest common term so the figure matches what most
   * people end up paying. */
  function fromMonthly(device) {
    var best = null;
    sellableStorages(device).forEach(function (s) {
      termsFor(s).forEach(function (t) {
        var m = monthly(s, t);
        if (best === null || m < best) best = m;
      });
    });
    return best;
  }

  /* Whether a device has anything for sale at all. Replaces the old
   * `terms is not null` check. */
  function isLive(device) {
    return sellableStorages(device).length > 0;
  }

  function money(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Number(n).toLocaleString('en-AU', { maximumFractionDigits: 0 });
  }

  return {
    TERM_ORDER: TERM_ORDER,
    termsFor: termsFor,
    monthly: monthly,
    total: total,
    headroom: headroom,
    sellableStorages: sellableStorages,
    termsForDevice: termsForDevice,
    fromMonthly: fromMonthly,
    isLive: isLive,
    money: money,
  };
})();
