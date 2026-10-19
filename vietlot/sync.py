"""Fetch new draws and winner counts into SQLite, refit popularity, then send alerts."""
import datetime
import html
import json
import re
import time
import urllib.request
from math import comb

import numpy as np

from . import alerts, db, popularity

RAW = "https://raw.githubusercontent.com/vietvudanh/vietlott-data/main/data/{}.jsonl"
SOURCE = {"655": "power655", "645": "power645"}
XSDLK = {"655": "https://xsdlk.net/xo-so-power-655/ky-{}/", "645": "https://xsdlk.net/xo-so-mega-645/ky-{}/"}
UA = {"User-Agent": "Mozilla/5.0 (Macintosh) Chrome/126", "Accept-Language": "vi"}
SEED = db.ROOT / "data" / "seed"


def _get(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")


def sync_draws(con, game, log):
    n = db.GAMES[game]["n"]
    rows = [json.loads(line) for line in _get(RAW.format(SOURCE[game])).splitlines() if line.strip()]
    if len(rows) < 1000:  # a truncated download must never be taken as the history
        raise RuntimeError("{}: only {} rows downloaded".format(game, len(rows)))
    before = con.execute("SELECT COUNT(*) FROM draws WHERE game = ?", (game,)).fetchone()[0]
    skipped = 0
    for r in rows:
        res = r["result"]
        main, bonus = sorted(res[:6]), (res[6] if game == "655" and len(res) == 7 else None)
        if len(set(main)) != 6 or not all(1 <= x <= n for x in res):
            skipped += 1
            continue
        con.execute("INSERT OR REPLACE INTO draws VALUES (?,?,?,?,?,?,?,?,?,?)", (game, int(r["id"]), r["date"][:10], *main, bonus))
    added = con.execute("SELECT COUNT(*) FROM draws WHERE game = ?", (game,)).fetchone()[0] - before
    log.append("{}: {} kỳ ({} mới{})".format(game, before + added, added, ", bỏ {} dòng lỗi".format(skipped) if skipped else ""))
    return added


# xsdlk.net per-draw page, flattened to text
_text = lambda h: html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h)))
R_HEAD = re.compile(r"Kỳ #(\d+) / (\d+/\d+/\d+)\D*?Các con số dự thưởng phải trùng với số kết quả ((?:\d+ ){6,7})")
R_655 = re.compile(
    r"Jackpot 1 1 2 3 4 5 6 \+ ([\d,]+|\?) ([\d.,]+|\?) Jackpot 2 1 2 3 4 5 \+ P ([\d,]+) ([\d.,]+|\?) "
    r"1 Giải Nhất 1 2 3 4 5 \+ ([\d,]+) [\d.,]+ 2 Giải Nhì 1 2 3 4 \+ ([\d,]+) [\d.,]+ 3 Giải Ba 1 2 3 \+ ([\d,]+)")
R_645 = re.compile(
    r"Jackpot 1 2 3 4 5 6 ([\d,]+|\?) ([\d.,]+|\?) 1 Giải Nhất 1 2 3 4 5 ([\d,]+) [\d.,]+ "
    r"2 Giải Nhì 1 2 3 4 ([\d,]+) [\d.,]+ 3 Giải Ba 1 2 3 ([\d,]+)")


def _num(s):
    return None if s == "?" else int(s.replace(",", "").replace(".", ""))


def parse_xsdlk(page, game):
    t = _text(page)
    head, body = R_HEAD.search(t), (R_655 if game == "655" else R_645).search(t)
    if not (head and body):
        return None
    g = [_num(x) for x in body.groups()]
    if game == "655":
        return dict(id=int(head.group(1)), jp1=g[1], jp2=g[3], n_jp1=g[0], n_jp2=g[2], n1=g[4], n2=g[5], n3=g[6])
    return dict(id=int(head.group(1)), jp1=g[1], jp2=None, n_jp1=g[0], n_jp2=None, n1=g[2], n2=g[3], n3=g[4])


def _insert_prize(con, game, p):
    con.execute("INSERT OR REPLACE INTO prizes VALUES (?,?,?,?,?,?,?,?,?)",
                (game, p["id"], p["jp1"], p.get("jp2"), p["n_jp1"], p.get("n_jp2"), p["n1"], p["n2"], p["n3"]))


def sync_prizes(con, game, log):
    if not con.execute("SELECT 1 FROM prizes WHERE game = ? LIMIT 1", (game,)).fetchone():
        seed = SEED / "power{}_winners.jsonl".format(game)
        if seed.exists():  # scraping the 2020+ history takes ~25 min; start from the committed copy
            for line in seed.read_text().splitlines():
                if line.strip():
                    p = json.loads(line)
                    _insert_prize(con, game, dict(p, id=int(p["id"])))
    last = con.execute("SELECT MAX(id) FROM draws WHERE game = ?", (game,)).fetchone()[0]
    have = con.execute("SELECT MAX(id) FROM prizes WHERE game = ?", (game,)).fetchone()[0]
    start = have + 1 if have else last - 9
    added = 0
    for k in range(start, last + 1):
        try:
            p = parse_xsdlk(_get(XSDLK[game].format(k)), game)
        except Exception as e:  # down or rate-limited: keep what we have, retry next run
            log.append("xsdlk {} #{}: {}".format(game, k, e))
            break
        if not p or p["jp1"] is None:  # gap on xsdlk; the newest draw is retried next run
            log.append("xsdlk {} #{}: chưa có số người trúng".format(game, k))
            continue
        _insert_prize(con, game, p)
        added += 1
        time.sleep(1.5)
    if added:
        log.append("xsdlk {}: thêm {} kỳ có số người trúng".format(game, added))


def next_draw(game, last_id, last_date):
    d = datetime.date.fromisoformat(last_date) + datetime.timedelta(days=1)
    while d.weekday() not in db.GAMES[game]["days"]:
        d += datetime.timedelta(days=1)
    return last_id + 1, d.isoformat()


def fit_model(con, game):
    draws = db.draws(con, game)
    known = [d for d in draws if d["prizes"] and d["prizes"]["jp1"]]
    last, lastp = draws[-1], known[-1]
    nid, ndate = next_draw(game, last["id"], last["date"])
    steps = nid - lastp["id"]  # draws between the last known jackpot and the next draw
    p = lastp["prizes"]
    if game == "655":
        alpha, se, n_fit = popularity.fit(draws, 55)
        recent = known[-10:]
        sales = float(np.mean([d["prizes"]["n3"] for d in recent])) / (368480 / comb(55, 6))
        acc = [(b["prizes"]["jp1"] - a["prizes"]["jp1"]) / 0.9 / (b["id"] - a["id"])
               for a, b in zip(known[-13:-1], known[-12:]) if not a["prizes"]["n_jp1"] and b["prizes"]["jp1"] > a["prizes"]["jp1"]]
        growth = float(np.median(acc)) if acc else 0.0
        jp1 = (30e9 if p["n_jp1"] else p["jp1"]) + 0.9 * growth * steps  # reset values, then each draw adds A
        jp2 = (3e9 if p["n_jp2"] else p["jp2"]) + 0.1 * growth * steps
        data = {"alpha": [round(float(x), 4) for x in alpha], "alpha_se": [round(float(x), 4) for x in se], "fit_draws": n_fit}
    else:
        base = db.model(con, "655")  # no 6/45 winner history to fit: reuse 6/55 habits for 1-45, re-centred
        a = np.array(base["alpha"][:45]) if base else np.zeros(45)
        since = [d for i, d in enumerate(known) if not any(x["prizes"]["n_jp1"] for x in known[i:-1])][-10:]
        sales = float(np.mean([d["prizes"]["n3"] for d in since])) / (182780 / comb(45, 6))
        st = [(b["prizes"]["jp1"] - a_["prizes"]["jp1"]) / (b["id"] - a_["id"]) for a_, b in zip(since, since[1:])]
        growth = float(np.median(st)) if st else 0.0
        jp1 = (12e9 if p["n_jp1"] else p["jp1"]) + growth * steps
        jp2 = None
        data = {"alpha": [round(float(x), 4) for x in a - a.mean()], "alpha_source": "655"}
    data.update(sales_est=round(sales), jp_growth_est=round(growth),
                next={"id": nid, "date": ndate, "jp1": round(jp1), "jp2": round(jp2) if jp2 is not None else None, "sales": round(sales)})
    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    con.execute("INSERT OR REPLACE INTO model VALUES (?,?,?)", (game, now, json.dumps(data)))


def run(con=None, notify=True):
    con = con or db.connect()
    log, added = [], {}
    for game in ("655", "645"):  # 655 first: 645 borrows its popularity model
        try:
            added[game] = sync_draws(con, game, log)
            sync_prizes(con, game, log)
            fit_model(con, game)
            con.commit()
        except Exception as e:  # one game failing must not block the other
            con.rollback()
            added[game] = 0
            log.append("{}: lỗi {}".format(game, e))
    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    db.set_meta(con, "synced_at", now)
    con.commit()
    if notify:
        log.extend(alerts.send_new(con))
    return {"added": added, "log": log, "synced_at": now}
