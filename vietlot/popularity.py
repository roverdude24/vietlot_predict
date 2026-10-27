"""Which numbers other players pick, estimated from winner counts (Power 6/55).

Draws are uniform, so the number of winners of Giải Ba (3 matches) and Nhì (4 matches) only rises
above its expectation when the drawn numbers are ones many players picked. Two regressions:
  y1 = log n3  on number indicators + Tue/Thu + quarter effects + log JP1 + log(sales proxy of previous draw)
  y2 = log(n2 / n3) on number indicators + quarter effects   (sales cancel out)
Coefficients convert to per-number popularity alpha (ticket weight ~ exp(sum alpha)) and are combined
by inverse variance, then shrunk toward 0 (empirical Bayes: each number keeps tau2 / (tau2 + se^2) of its
estimate, tau2 = true spread of popularity) so noise is not mistaken for habit. Result: alpha (centred, sum 0)
and its standard error per number.
"""
import datetime
import warnings

import numpy as np

# numpy 2.0.2 on macOS prints spurious matmul RuntimeWarnings; results match scipy to 1e-15
warnings.filterwarnings("ignore", message=".*encountered in matmul")

K_N3 = 1 / (3 / 6 - 3 / 49)  # first-order conversion, Ba winners
K_N2 = 1 / (1 / 6 + 1 / 49)  # Nhì/Ba ratio


def _ols(y, X):
    beta = np.linalg.lstsq(X, y, rcond=None)[0]
    resid = y - X @ beta
    s2 = resid @ resid / (len(y) - X.shape[1])
    return beta, s2 * np.linalg.pinv(X.T @ X)


def _alpha(beta, cov, k, n):
    """First n-1 coefficients are number effects (number n = baseline) -> centred alpha and SE."""
    b = np.append(beta[: n - 1], 0.0)
    V = np.zeros((n, n))
    V[: n - 1, : n - 1] = cov[: n - 1, : n - 1]
    C = np.eye(n) - 1.0 / n
    return k * (C @ b), k * np.sqrt(np.diag(C @ V @ C.T))


def _quarter(iso):
    return iso[:4] + "Q" + str((int(iso[5:7]) - 1) // 3 + 1)


def fit(draws, n=55):
    """draws: oldest first, each {'id','date' (ISO),'main','prizes'}; only rows with prizes are used."""
    rows = [d for d in draws if d["prizes"] and d["prizes"]["n3"] and d["prizes"]["n2"] and d["prizes"]["jp1"]]
    by_id = {d["id"]: d["prizes"] for d in rows}
    quarters = sorted({_quarter(d["date"]) for d in rows})
    qi = {q: i for i, q in enumerate(quarters)}
    X1, y1, X2, y2 = [], [], [], []
    for d in rows:
        p = d["prizes"]
        nums = np.zeros(n - 1)
        for x in d["main"]:
            if x < n:
                nums[x - 1] = 1
        q = np.zeros(len(quarters))
        q[qi[_quarter(d["date"])]] = 1  # quarter effects replace the intercept
        y2.append(np.log(p["n2"] / p["n3"]))
        X2.append(np.concatenate([nums, q]))
        prev, prev2 = by_id.get(d["id"] - 1), by_id.get(d["id"] - 2)
        if not (prev and prev2):
            continue
        accum = (prev["jp1"] - (30e9 if prev2["n_jp1"] else prev2["jp1"])) / 0.9
        paid = 40e6 * prev["n1"] + 0.5e6 * prev["n2"] + 50e3 * prev["n3"]
        if accum + paid <= 0:
            continue
        wd = datetime.date.fromisoformat(d["date"]).weekday()
        y1.append(np.log(p["n3"]))
        X1.append(np.concatenate([nums, [wd == 1, wd == 3, np.log(p["jp1"]), np.log(accum + paid)], q]))
    a1, s1 = _alpha(*_ols(np.array(y1), np.array(X1, float)), K_N3, n)
    a2, s2 = _alpha(*_ols(np.array(y2), np.array(X2, float)), K_N2, n)
    w1, w2 = 1 / s1 ** 2, 1 / s2 ** 2
    a, s = (w1 * a1 + w2 * a2) / (w1 + w2), 1 / np.sqrt(w1 + w2)
    tau2 = max(0.0, a.var() - np.mean(s ** 2))
    a = a * tau2 / (tau2 + s ** 2)
    return a - a.mean(), s, len(y1)
