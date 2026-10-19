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
