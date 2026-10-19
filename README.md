# Vietlott platform (local)

A personal Vietlott Power 6/55 + Mega 6/45 platform that runs on this Mac: full draw history in SQLite, a formula-based ticket picker, a purchase ledger, a prediction lab, and a notification after every draw.

Forked from [markdo27/vietlot_predict](https://github.com/markdo27/vietlot_predict) by Mark Do. Personal, non-commercial use only (see the original's licence note).

## What it can and cannot do

Vietlott draws are uniform random. On 1,412 Power 6/55 draws, number frequencies give χ² = 50.3 with df = 54, p = 0.62. No method predicts numbers. The **prediction lab** shows this: every strategy (hot, cold, overdue, repeat, …) is scored walk-forward against chance, and all of them match chance.

The picker uses the two levers that do work:

1. **Pairwise-disjoint tickets.** For 5 tickets, P(any prize) is 6.651% (1,928,075 / 28,989,675). Overlapping tickets get less.
2. **Least-popular numbers.** These don't change the odds. They change how many people you would split a jackpot with. Number popularity is estimated from winner counts per draw (regressions on Giải Ba and Nhì counts, 942 draws).

The picker also shows EV per 10,000đ ticket, after the 10% tax above 20M and expected jackpot sharing.

## Run

```bash
pip3 install -r requirements.txt     # numpy, scipy (stdlib otherwise)
python3 -m vietlot sync              # fetch draws + winner counts into data/vietlot.db, refit, notify
python3 -m vietlot serve             # http://127.0.0.1:8655
python3 -m vietlot lab --game 655    # backtest in the terminal
python3 -m vietlot install           # launchd: server always on, sync 19:20 and 21:30 daily
```

`install` refuses to run from ~/Desktop, ~/Documents or ~/Downloads. macOS privacy blocks background jobs from those folders. Keep the repo elsewhere (this one lives in ~/Developer/vietlot_predict).

## Layout

| Path | What |
| --- | --- |
| `vietlot/db.py` | SQLite schema: draws, prizes (winner counts, jackpots), model, purchases, tickets, meta |
| `vietlot/sync.py` | Sources: [vietvudanh/vietlott-data](https://github.com/vietvudanh/vietlott-data) (draws), xsdlk.net (winner counts) |
| `vietlot/popularity.py` | Number-popularity fit |
| `vietlot/lab.py` | Strategy backtests. Add a strategy as `f(history, n, ctx) -> 6 numbers` in `STRATEGIES` |
| `vietlot/rules.py`, `ledger.py`, `alerts.py`, `server.py` | Prizes/EV, sổ vé, macOS notifications, localhost API |
| `web/` | UI. `web/js/formula.js` holds the client-side math (exact odds, EV, ticket builder) |
| `data/seed/` | Winner-count history, so a fresh DB doesn't need a 25-minute scrape |

Checks: `python3 tools/check.py` and `node tools/check.mjs`.
