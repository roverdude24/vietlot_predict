// Self-check for web/js/formula.js against known exact values.  Run: node tools/check.mjs
import assert from "node:assert/strict";
import { GAMES, comb, coverage, expectedValue, breakEvenJackpot, buildTickets, passesFilters, popularity, frequencyTest, smsLines } from "../web/js/formula.js";

const g655 = GAMES[655], g645 = GAMES[645];
assert.equal(g655.total, 28989675);
assert.equal(g645.total, 8145060);
// prize-count table is exact combinatorics
assert.equal(g655.prizes.reduce((s, p) => s + p.count, 0), comb(6, 3) * comb(49, 3) + comb(6, 4) * comb(49, 2) + comb(6, 5) * comb(49, 1) + 1);
assert.equal(g645.prizes.reduce((s, p) => s + p.count, 0), [3, 4, 5, 6].reduce((s, m) => s + comb(6, m) * comb(39, 6 - m), 0));

// one ticket: any prize = 386,415 draws; five disjoint tickets: 1,928,075 (any) and 89,675 (>= 4 matches)
assert.equal(coverage([[1, 2, 3, 4, 5, 6]], 55).any, 386415);
const five = [0, 1, 2, 3, 4].map((t) => [1, 2, 3, 4, 5, 6].map((x) => x + 6 * t));
const c5 = coverage(five, 55);
assert.equal(c5.any, 1928075);
assert.equal(c5.ge4, 89675);
// overlapping tickets win less often than disjoint ones
assert.ok(coverage([[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 7]], 55).any < coverage(five.slice(0, 2), 55).any);

// filters
assert.equal(passesFilters([3, 4, 5, 20, 33, 47]), false); // 3 consecutive
assert.equal(passesFilters([5, 10, 15, 20, 33, 47]), false); // 4-term progression
assert.equal(passesFilters([1, 11, 21, 31, 40, 52]), false); // four ending in 1
assert.equal(passesFilters([40, 42, 44, 46, 51, 3]), false); // four in the 40s
assert.equal(passesFilters([3, 17, 26, 38, 44, 52]), true);

// popularity: the average ticket is 1, an all-unpopular one is below 1
// fitted shape (1-12 birthdays popular, 32-55 avoided), centred; real values live in the SQLite model table
const shape = (n) => { const a = Array.from({ length: n }, (_, i) => (i < 12 ? 0.08 : i < 31 ? 0.02 : -0.06) + 0.001 * (i % 7)); const m = a.reduce((s, x) => s + x, 0) / n; return a.map((x) => x - m); };
const alpha = shape(55);
assert.equal(alpha.length, 55);
let avg = 0;
for (let i = 0; i < 3000; i++) {
  const s = new Set();
  while (s.size < 6) s.add(1 + Math.floor(Math.random() * 55));
  avg += popularity([...s], alpha) / 3000;
}
assert.ok(Math.abs(avg - 1) < 0.08, "mean popularity " + avg);
const tickets = buildTickets({ k: 5, alpha });
assert.equal(new Set(tickets.flat()).size, 30, "disjoint");
assert.ok(tickets.every((t) => passesFilters(t)));
assert.ok(tickets.every((t) => popularity(t, alpha) < 0.85), "picked tickets are unpopular");
assert.equal(coverage(tickets, 55).any, 1928075);
assert.equal(buildTickets({ k: 9, alpha }).flat().length, 54);
assert.equal(buildTickets({ k: 7, alpha: shape(45) }).flat().length, 42);

// EV: reference case (JP1 155 ty, JP2 5 ty, 2.7M tickets, rho .71) about 6,740 per 10,000; break-even JP1 ~ 263 ty
const ev = expectedValue(g655, { jp1: 155e9, jp2: 5e9, sales: 2.7e6, rho: 0.71 });
assert.ok(Math.abs(ev - 6740) < 150, "EV " + ev);
const be = breakEvenJackpot(g655, { jp2: 5e9, sales: 2.7e6, rho: 0.71 });
assert.ok(be > 240e9 && be < 290e9, "break-even " + be);

// uniform draws: chi-square of a perfectly flat history is 0, p = 1
const flat = [];
for (let i = 0; i < 55; i++) flat.push({ main: [1, 2, 3, 4, 5, 6].map((x) => ((x + 6 * i - 1) % 55) + 1) });
const ft = frequencyTest(flat, 55);
assert.ok(ft.chi2 < 1e-9 && ft.p > 0.999);
assert.ok(Math.abs(frequencyTest(flat, 55).p - 1) < 1e-9);

assert.deepEqual(smsLines(g655, [[1, 2, 3, 4, 5, 6]]), ["ZLP 655 K1 S 01 02 03 04 05 06"]);
assert.equal(smsLines(g655, five.concat([[50, 51, 52, 53, 54, 55]])).length, 2);
console.log("formula.js: all checks pass", { ev: Math.round(ev), breakEvenTy: +(be / 1e9).toFixed(1), tickets });
