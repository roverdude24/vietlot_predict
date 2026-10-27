"""Mark Do's original formula (markdo27/vietlot_predict, js/scorer.js + frequency-model.js), ported.

  S = 0.40 * S_bayes + 0.30 * S_gap + 0.20 * S_pair + 0.10 * S_spread      (0..100)
  S_bayes : mean rank percentile of the balls by Beta(6, 49) posterior mean of their all-time count
  S_gap   : mean Phi(Z_gap), Z_gap = (draws since last seen - 1/p0) / sqrt((1-p0)/p0^2)
  S_pair  : mean pair lift (observed co-occurrence / expected) * 50, capped at 100
  S_spread: (max - min) / (n - 1) * 100
His "today" pick: 3 hottest by posterior + 3 most overdue.
His own note: a high score does not mean a higher chance; every ticket is 1 / C(n, 6).
"""
from math import erf, sqrt

A0, B0 = 6, 49


class Model:
    def __init__(self, mains, n):
        self.n = n
        draws = len(mains)
        counts = [0] * (n + 1)
        last = [-1] * (n + 1)
        pairs = {}
        for t, row in enumerate(mains):
            row = sorted(row)
            for i, a in enumerate(row):
                counts[a] += 1
                last[a] = t
                for b in row[i + 1:]:
                    pairs[(a, b)] = pairs.get((a, b), 0) + 1
        post = [(A0 + counts[b]) / (A0 + B0 + draws) for b in range(n + 1)]
        order = sorted(range(1, n + 1), key=lambda b: (-post[b], b))
        self.rank_pct = {b: (1 - i / (n - 1)) * 100 for i, b in enumerate(order)}
        p0 = 6 / n
        self.gap = {b: draws - last[b] for b in range(1, n + 1)}
        mu, sd = 1 / p0, sqrt((1 - p0) / p0 ** 2)
        self.gap_pct = {b: 50 * (1 + erf((self.gap[b] - mu) / sd / sqrt(2))) for b in range(1, n + 1)}
        self.pairs, self.exp_pair = pairs, draws * 30 / (n * (n - 1))
        self.hot = order[:6]
        self.overdue = sorted((b for b in range(1, n + 1) if b not in self.hot), key=lambda b: (-self.gap[b], b))[:6]

    def score(self, ticket):
        t = sorted(ticket)
        bayes = sum(self.rank_pct[b] for b in t) / 6
        gap = sum(self.gap_pct[b] for b in t) / 6
        lifts = [self.pairs.get((a, b), 0) / self.exp_pair for i, a in enumerate(t) for b in t[i + 1:]]
        pair = min(100, max(0, sum(lifts) / len(lifts) * 50))
        spread = (t[-1] - t[0]) / (self.n - 1) * 100
        return round(0.4 * bayes + 0.3 * gap + 0.2 * pair + 0.1 * spread)

    def combo(self):
        return sorted(self.hot[:3] + self.overdue[:3])
