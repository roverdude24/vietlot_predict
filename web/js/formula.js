// The math behind the site. Pure functions, no DOM; checked by tools/check.mjs.
// Draws are uniform random: numbers never change the odds. They only change how many
// other people would share a jackpot with you (player popularity, alpha per number).

export const PRICE = 10000;

export function comb(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

export const GAMES = {
  655: {
    id: "655", name: "Power 6/55", n: 55, total: comb(55, 6), maxTickets: 9, days: "thứ Ba, Năm, Bảy",
    prizes: [
      { key: "jp1", name: "Jackpot 1", match: "6 số", count: 1 },
      { key: "jp2", name: "Jackpot 2", match: "5 số + số đặc biệt", count: 6 },
      { key: "p1", name: "Giải Nhất", match: "5 số", count: 288, value: 40e6 },
      { key: "p2", name: "Giải Nhì", match: "4 số", count: 17640, value: 5e5 },
      { key: "p3", name: "Giải Ba", match: "3 số", count: 368480, value: 5e4 },
    ],
  },
  645: {
    id: "645", name: "Mega 6/45", n: 45, total: comb(45, 6), maxTickets: 7, days: "thứ Tư, Sáu, Chủ nhật",
    prizes: [
      { key: "jp1", name: "Jackpot", match: "6 số", count: 1 },
      { key: "p1", name: "Giải Nhất", match: "5 số", count: 234, value: 10e6 },
      { key: "p2", name: "Giải Nhì", match: "4 số", count: 11115, value: 3e5 },
      { key: "p3", name: "Giải Ba", match: "3 số", count: 182780, value: 3e4 },
    ],
  },
};

// Personal income tax from 01/07/2026: 10% of the part of one winning ticket above 20 million.
export const net = (v) => v - 0.1 * Math.max(0, v - 20e6);

// E[1 / (1 + Poisson(lambda))]: your share of a jackpot when lambda other winners are expected.
export const share = (lam) => (lam < 1e-12 ? 1 : (1 - Math.exp(-lam)) / lam);

/** Expected payout of one ticket in dong, after tax and jackpot sharing. */
export function expectedValue(game, { jp1, jp2 = 0, sales, rho = 1 }) {
  const N = game.total;
  const others = (sales * rho) / N;
  let sum = net(jp1) * share(others);
  for (const p of game.prizes) {
    if (p.key === "jp2") sum += p.count * net(jp2) * share(p.count * others);
    else if (p.value) sum += p.count * net(p.value);
  }
  return sum / N;
}

/** Jackpot 1 at which one ticket returns its price on average, other inputs fixed; null if never. */
export function breakEvenJackpot(game, opts) {
  let lo = 0, hi = 5e13;
  if (expectedValue(game, { ...opts, jp1: hi }) < PRICE) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (expectedValue(game, { ...opts, jp1: mid }) < PRICE) lo = mid; else hi = mid;
  }
  return hi;
}

const e6Cache = new WeakMap();
/** Ticket popularity: how many tickets share this exact combination, relative to an average one (1.0). */
export function popularity(ticket, alpha) {
  let e6 = e6Cache.get(alpha);
  if (e6 === undefined) {
    const e = [1, 0, 0, 0, 0, 0, 0]; // elementary symmetric polynomials of exp(alpha)
    for (const a of alpha) {
      const w = Math.exp(a);
      for (let j = 6; j >= 1; j--) e[j] += e[j - 1] * w;
    }
    e6 = e[6];
    e6Cache.set(alpha, e6);
  }
  const w = ticket.reduce((s, x) => s + alpha[x - 1], 0);
  return (comb(alpha.length, 6) * Math.exp(w)) / e6;
}

/** Rules that keep a ticket away from patterns people like to play. */
export function passesFilters(t, drawnKeys) {
  const s = [...t].sort((a, b) => a - b);
  for (let i = 2; i < 6; i++) if (s[i] - s[i - 2] === 2) return false; // 3 consecutive
  const digit = new Map(), tens = new Map();
  for (const x of s) {
    digit.set(x % 10, (digit.get(x % 10) || 0) + 1);
    tens.set(Math.floor(x / 10), (tens.get(Math.floor(x / 10)) || 0) + 1);
  }
  if (Math.max(...digit.values()) > 3 || Math.max(...tens.values()) > 3) return false;
  const has = new Set(s);
  for (let i = 0; i < 6; i++)
    for (let j = i + 1; j < 6; j++) {
      const d = s[j] - s[i];
      if (has.has(s[j] + d) && has.has(s[j] + 2 * d)) return false; // 4-term arithmetic progression
    }
  return !(drawnKeys && drawnKeys.has(s.join("-")));
}

/**
 * k pairwise-disjoint tickets from the least popular numbers.
 * Disjoint tickets maximise P(any prize); least popular numbers maximise the jackpot share.
 */
export function buildTickets({ k, alpha, drawnKeys, rng = Math.random, tries = 20000 }) {
  const n = alpha.length;
  const order = alpha.map((a, i) => [a, i + 1]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  for (let extra = 0; 6 * k + extra <= n; extra += 3) {
    const pool = order.slice(0, 6 * k + extra);
    let best = null, bestScore = Infinity;
    for (let t = 0; t < tries; t++) {
      for (let i = 0; i < 6 * k; i++) { // partial Fisher-Yates: first 6k slots random
        const j = i + Math.floor(rng() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const tickets = [];
      let score = 0, ok = true;
      for (let g = 0; g < k && ok; g++) {
        const tk = pool.slice(6 * g, 6 * g + 6).sort((a, b) => a - b);
        ok = passesFilters(tk, drawnKeys);
        score += Math.exp(tk.reduce((s, x) => s + alpha[x - 1], 0));
        tickets.push(tk);
      }
      if (ok && score < bestScore) { best = tickets; bestScore = score; }
      if (pool.length === 6 && best) break; // one ticket from exactly six numbers: no other choice
    }
    if (best) return best;
  }
  return null;
}

/**
 * Exact P(at least one ticket wins a prize) over all C(n,6) draws.
 * Numbers are grouped by which tickets contain them, so any set of tickets enumerates quickly.
 * Returns counts of draws: any = some ticket matches >= 3, ge4 = some ticket matches >= 4.
 */
export function coverage(tickets, n) {
  const k = tickets.length;
  const sig = new Map();
  for (let t = 0; t < k; t++) for (const x of tickets[t]) sig.set(x, (sig.get(x) || 0) | (1 << t));
  const groups = new Map();
  for (const m of sig.values()) groups.set(m, (groups.get(m) || 0) + 1);
  const masks = [...groups.keys()], sizes = [...groups.values()];
  const outside = n - sig.size;
  const counts = new Int8Array(k);
  let any = 0, ge4 = 0;
  (function walk(g, left, mult) {
    if (g === masks.length) {
      const ways = mult * comb(outside, left);
      if (!ways) return;
      let best = 0;
      for (let t = 0; t < k; t++) if (counts[t] > best) best = counts[t];
      if (best >= 3) any += ways;
      if (best >= 4) ge4 += ways;
      return;
    }
    for (let j = 0; j <= Math.min(sizes[g], left); j++) {
      for (let t = 0; t < k; t++) if (masks[g] & (1 << t)) counts[t] += j;
      walk(g + 1, left - j, mult * comb(sizes[g], j));
      for (let t = 0; t < k; t++) if (masks[g] & (1 << t)) counts[t] -= j;
    }
  })(0, 6, 1);
  return { any, ge4, total: comb(n, 6) };
}

// Regularised lower incomplete gamma P(a, x) (Numerical Recipes gser/gcf).
function gammaP(a, x) {
  const gln = lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let i = 0; i < 500; i++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
}

function lnGamma(z) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** How often each number came up, and whether that is more uneven than chance. */
export function frequencyTest(draws, n) {
  const counts = new Array(n).fill(0);
  for (const d of draws) for (const x of d.main) counts[x - 1]++;
  const expected = (6 * draws.length) / n;
  const chi2 = counts.reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
  const df = n - 1;
  return { counts, expected, chi2, df, p: 1 - gammaP(df / 2, chi2 / 2) };
}

/** Average matches if you had always played the 6 hottest (or coldest) numbers of the last `window` draws. */
export function hotColdTest(draws, n, window) {
  let hot = 0, cold = 0, m = 0;
  for (let t = window; t < draws.length; t++) {
    const c = new Array(n).fill(0);
    for (let s = t - window; s < t; s++) for (const x of draws[s].main) c[x - 1]++;
    const rank = c.map((v, i) => [v, i + 1]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[1]);
    const drawn = new Set(draws[t].main);
    hot += rank.slice(0, 6).filter((x) => drawn.has(x)).length;
    cold += rank.slice(-6).filter((x) => drawn.has(x)).length;
    m++;
  }
  return { hot: hot / m, cold: cold / m, random: 36 / n, draws: m };
}

/** What a fixed set of tickets would have won on every past draw (fixed prizes; jackpots counted, not valued). */
export function replay(tickets, draws, game) {
  const tally = Object.fromEntries(game.prizes.map((p) => [p.key, 0]));
  let money = 0, best = null;
  for (const d of draws) {
    const drawn = new Set(d.main);
    for (const t of tickets) {
      const m = t.filter((x) => drawn.has(x)).length;
      let key = null;
      if (m === 6) key = "jp1";
      else if (m === 5) key = game.id === "655" && t.includes(d.bonus) ? "jp2" : "p1";
      else if (m === 4) key = "p2";
      else if (m === 3) key = "p3";
      if (!key) continue;
      tally[key]++;
      const prize = game.prizes.find((p) => p.key === key);
      if (prize.value) money += net(prize.value);
      if (!best || m > best.m) best = { m, id: d.id, date: d.date };
    }
  }
  return { tally, money, spent: draws.length * tickets.length * PRICE, best };
}

/** Vietlott SMS (ZaloPay, 9969): up to 5 tickets per message. */
export function smsLines(game, tickets) {
  const lines = [];
  for (let i = 0; i < tickets.length; i += 5)
    lines.push(`ZLP ${game.id} K1 ` + tickets.slice(i, i + 5).map((t) => "S " + t.map((x) => String(x).padStart(2, "0")).join(" ")).join(" "));
  return lines;
}
