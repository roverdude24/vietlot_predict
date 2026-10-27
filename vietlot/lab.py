"""Prediction lab: walk-forward backtest of number-picking strategies against chance.

Each strategy sees only the draws before the one it is scored on. Under the null hypothesis
(draws are uniform and independent) the matches of any such ticket are Hypergeometric(n, 6, 6)
every draw, so a z-test on the mean is exact enough at ~1,400 draws.
To add a strategy: write f(history, n, ctx) -> 6 numbers and append it to STRATEGIES.
"""
from math import comb

import numpy as np
from scipy import stats

from . import db, plan


def _counts(hist, n):
    return np.bincount(hist.ravel(), minlength=n + 1)[1:]


def _top(scores, k=6, reverse=True):
    order = sorted(range(len(scores)), key=lambda i: (-scores[i] if reverse else scores[i], i))
    return [i + 1 for i in order[:k]]


def random_pick(hist, n, ctx):
    return list(ctx["rng"].choice(np.arange(1, n + 1), 6, replace=False))


def hot(hist, n, ctx):
    return _top(_counts(hist[-ctx["window"]:], n))


def cold(hist, n, ctx):
    return _top(_counts(hist[-ctx["window"]:], n), reverse=False)


def all_time_hot(hist, n, ctx):
    return _top(_counts(hist, n))


def overdue(hist, n, ctx):
    last_seen = np.full(n, -1)
    for t, row in enumerate(hist):
        last_seen[row - 1] = t
    return _top(list(len(hist) - last_seen))


def repeat_last(hist, n, ctx):
    return list(hist[-1])


def unpopular(hist, n, ctx):
    return _top(ctx["alpha"], reverse=False)


def markdo_combo(hist, n, ctx):
    """Mark Do's 'today' pick: 3 hottest by Beta(6,49) posterior (= by count) + 3 most overdue."""
    c = _counts(hist, n)
    hot6 = _top(c)
    last = np.full(n, -1)
    for t, row in enumerate(hist):
        last[row - 1] = t
    gap = len(hist) - last
    overdue = [b for b in sorted(range(1, n + 1), key=lambda b: (-gap[b - 1], b)) if b not in hot6]
    return hot6[:3] + overdue[:3]


STRATEGIES = [
    ("random", "Ngẫu nhiên", "6 số bốc thăm mỗi kỳ (đối chứng)", random_pick),
    ("hot", "Số nóng", "6 số ra nhiều nhất trong {window} kỳ gần nhất", hot),
    ("cold", "Số lạnh", "6 số ra ít nhất trong {window} kỳ gần nhất", cold),
    ("alltime", "Nóng từ đầu", "6 số ra nhiều nhất từ kỳ đầu tiên", all_time_hot),
    ("overdue", "Số gan", "6 số lâu chưa ra nhất", overdue),
    ("repeat", "Lặp kỳ trước", "đúng 6 số của kỳ vừa quay", repeat_last),
    ("markdo", "Mark Do", "3 số nóng nhất + 3 số gan nhất (công thức gốc của trang markdo27)", markdo_combo),
    ("unpopular", "Ít người chọn", "6 số ít người chơi nhất (công thức chia giải)", unpopular),
]


def backtest(f, mains, n, ctx, start):
    """Walk-forward: matches of f's pick on every draw from `start`, against the hypergeometric null."""
    mu = 36 / n
    var = 6 * (6 / n) * ((n - 6) / n) * ((n - 6) / (n - 1))  # hypergeometric matches per draw
    matches = np.array([len(set(f(mains[:t], n, ctx)) & set(mains[t])) for t in range(start, len(mains))])
    mean = float(matches.mean())
    z = (mean - mu) / np.sqrt(var / len(matches))
    p = float(2 * stats.norm.sf(abs(z)))
    return {"mean_matches": round(mean, 4), "expected": round(mu, 4), "hit_rate": round(float((matches >= 3).mean()), 4),
            "z": round(float(z), 2), "p": round(p, 3), "draws": len(matches)}


def run(con, game, window=30):
    n = db.GAMES[game]["n"]
    mains = np.array([d["main"] for d in db.draws(con, game)])
    m = db.model(con, game)
    ctx = {"window": window, "rng": np.random.default_rng(int(game)), "alpha": m["alpha"] if m else [0.0] * n}
    start = max(window, 1)
    mu = 36 / n
    T = len(mains) - start
    out = []
    for key, name, desc, f in STRATEGIES:
        r = backtest(f, mains, n, ctx, start)
        out.append({"key": key, "name": name, "desc": desc.format(window=window), "mean_matches": r["mean_matches"],
                    "hit_rate": r["hit_rate"], "z": r["z"], "p": r["p"],
                    "verdict": "như ngẫu nhiên" if r["p"] >= 0.05 else "khác ngẫu nhiên (p<0.05; cứ 20 cách thử thì 1 cách đạt mức này do may rủi)"})
    counts = _counts(mains, n)
    expected = 6 * len(mains) / n
    # 6 distinct numbers per draw: per-number variance is (n-6)/(n-1) of the multinomial one
    chi2 = float(((counts - expected) ** 2 / expected).sum()) * (n - 1) / (n - 6)
    return {"draws_scored": int(T), "expected_matches": round(mu, 4),
            "expected_hit_rate": round(sum(stats.hypergeom.pmf(k, n, 6, 6) for k in range(3, 7)), 4),
            "frequency": {"counts": counts.tolist(), "expected": round(expected, 2), "chi2": round(chi2, 2),
                          "df": n - 1, "p": round(float(stats.chi2.sf(chi2, n - 1)), 3)},
            "strategies": out, "plan": _plan(game, mains)}


def _plan(game, mains):
    """The user's fixed set over every past draw: share of draws with >= 1 prize vs its exact probability."""
    p = plan.load()
    if p["game"] != game:
        return None
    tickets = [set(t) for t in p["tickets"]]
    hits = sum(any(len(t & set(d)) >= 3 for t in tickets) for d in mains)
    cov = coverage(p["tickets"], db.GAMES[game]["n"])
    pval = float(stats.binomtest(hits, len(mains), cov).pvalue)
    return {"name": p["name"], "draws": len(mains), "hits": int(hits), "hit_rate": round(hits / len(mains), 4),
            "expected_hit_rate": round(cov, 5), "p": round(pval, 3),
            "note": "Quá khứ không đổi xác suất kỳ tới: mỗi kỳ bộ này vẫn trúng ít nhất 1 giải với đúng {:.3%}.".format(cov)
                    + (" Chênh lệch trong quá khứ là may rủi." if pval < 0.05 else "")}


def coverage(tickets, n):
    """Exact P(some ticket matches >= 3). Numbers are grouped by which tickets hold them (as in formula.js)."""
    sig = {}
    for i, t in enumerate(tickets):
        for x in t:
            sig[x] = sig.get(x, 0) | (1 << i)
    groups = {}
    for m in sig.values():
        groups[m] = groups.get(m, 0) + 1
    masks, sizes = list(groups), list(groups.values())
    rest, k = n - len(sig), len(tickets)

    def walk(g, left, mult, counts):
        if g == len(masks):
            return mult * comb(rest, left) if max(counts) >= 3 else 0
        total = 0
        for j in range(min(sizes[g], left) + 1):
            c = [counts[t] + (j if masks[g] >> t & 1 else 0) for t in range(k)]
            total += walk(g + 1, left - j, mult * comb(sizes[g], j), c)
        return total

    return walk(0, 6, 1, [0] * k) / comb(n, 6)
