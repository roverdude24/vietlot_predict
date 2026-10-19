"""Prize rules and expected value. Mirrors web/js/formula.js (checked against the same reference numbers)."""
from math import comb, exp

PRICE = 10000
TOTAL = {"655": comb(55, 6), "645": comb(45, 6)}
FIXED = {  # prize key -> (winning combinations per ticket, prize before tax)
    "655": {"p1": (288, 40e6), "p2": (17640, 5e5), "p3": (368480, 5e4)},
    "645": {"p1": (234, 10e6), "p2": (11115, 3e5), "p3": (182780, 3e4)},
}
RESET = {"655": (30e9, 3e9), "645": (12e9, None)}


def net(v):
    """Personal income tax from 01/07/2026: 10% of the part of one winning ticket above 20 million."""
    return v - 0.1 * max(0.0, v - 20e6)


def share(lam):
    """E[1 / (1 + Poisson(lam))]: your share of a jackpot when lam other winners are expected."""
    return 1.0 if lam < 1e-12 else (1 - exp(-lam)) / lam


def expected_value(game, jp1, jp2, sales, rho=1.0):
    N = TOTAL[game]
    others = sales * rho / N
    s = net(jp1) * share(others)
    if game == "655":
        s += 6 * net(jp2) * share(6 * others)
    s += sum(c * net(v) for c, v in FIXED[game].values())
    return s / N


def prize_key(game, ticket, main, bonus):
    m = len(set(ticket) & set(main))
    if m == 6:
        return "jp1"
    if m == 5:
        return "jp2" if game == "655" and bonus in ticket else "p1"
    return {4: "p2", 3: "p3"}.get(m)


def prize_value(game, key, prizes):
    """Value after tax of one winning ticket; jackpots use the draw's value when known (shared winners split it)."""
    if key in FIXED[game]:
        return net(FIXED[game][key][1])
    if not prizes:
        return 0
    value, winners = (prizes["jp1"], prizes["n_jp1"]) if key == "jp1" else (prizes["jp2"], prizes["n_jp2"])
    return net((value or 0) / max(1, winners or 1))


def popularity(ticket, alpha):
    """How many players share this exact combination, relative to an average ticket (1.0). Mirrors formula.js."""
    e = [1.0] + [0.0] * 6  # elementary symmetric polynomials of exp(alpha)
    for a in alpha:
        w = exp(a)
        for j in range(6, 0, -1):
            e[j] += e[j - 1] * w
    return comb(len(alpha), 6) * exp(sum(alpha[x - 1] for x in ticket)) / e[6]


def passes_filters(t):
    """Same pattern filters as formula.js: no 3 consecutive, <=3 per last digit or tens, no 4-term progression."""
    s = sorted(t)
    if any(s[i] - s[i - 2] == 2 for i in range(2, 6)):
        return False
    for key in (lambda x: x % 10, lambda x: x // 10):
        vals = [key(x) for x in s]
        if max(vals.count(v) for v in vals) > 3:
            return False
    has = set(s)
    return not any(s[j] + d in has and s[j] + 2 * d in has for i in range(6) for j in range(i + 1, 6) for d in [s[j] - s[i]])


def formula_set(alpha, k=5, tries=4000, seed=0):
    """The user's formula applied to any game: k disjoint tickets from the 6k least popular numbers,
    passing the pattern filters, split so the tickets are as unpopular as possible."""
    import random
    rng = random.Random(seed)
    pool = sorted(range(1, len(alpha) + 1), key=lambda b: alpha[b - 1])[:6 * k]
    best, best_s = None, None
    for _ in range(tries):
        rng.shuffle(pool)
        ts = [sorted(pool[6 * i:6 * i + 6]) for i in range(k)]
        if all(passes_filters(t) for t in ts):
            s = sum(exp(sum(alpha[x - 1] for x in t)) for t in ts)
            if best_s is None or s < best_s:
                best, best_s = ts, s
    return best
