"""Purchases (the sổ vé): stored tickets, results derived from the draws table on read."""
import datetime

from . import db, rules


def _validate(game, tickets):
    if game not in db.GAMES:
        raise ValueError("game phải là 655 hoặc 645")
    n = db.GAMES[game]["n"]
    if not isinstance(tickets, list) or not 1 <= len(tickets) <= 9:
        raise ValueError("cần 1 đến 9 vé")
    out = []
    for t in tickets:
        if not (isinstance(t, list) and len(t) == 6 and all(isinstance(x, int) and 1 <= x <= n for x in t) and len(set(t)) == 6):
            raise ValueError("mỗi vé là 6 số khác nhau từ 1 đến {}: {}".format(n, t))
        out.append(sorted(t))
    return out


def add(con, game, tickets, draw_id=None, code=None, bought_at=None):
    tickets = _validate(game, tickets)
    if draw_id is None:
        m = db.model(con, game)
        if not m:
            raise ValueError("chưa có dữ liệu, chạy sync trước")
        draw_id = m["next"]["id"]
    bought_at = bought_at or datetime.datetime.now().isoformat(timespec="minutes")
    cur = con.execute("INSERT INTO purchases(game, draw_id, bought_at, code) VALUES (?,?,?,?)", (game, int(draw_id), bought_at, code))
    for i, t in enumerate(tickets):
        con.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?)", (cur.lastrowid, i, *t))
    con.commit()
    return get(con, cur.lastrowid)


def delete(con, pid):
    n = con.execute("DELETE FROM purchases WHERE id = ?", (pid,)).rowcount
    con.commit()
    return n > 0


def get(con, pid):
    rows = list_all(con, pid)
    return rows[0] if rows else None


def list_all(con, pid=None):
    sql = "SELECT * FROM purchases" + (" WHERE id = ?" if pid else "") + " ORDER BY draw_id DESC, id DESC"
    out = []
    for p in con.execute(sql, (pid,) if pid else ()):
        tickets = [[r["n%d" % i] for i in range(1, 7)]
                   for r in con.execute("SELECT * FROM tickets WHERE purchase_id = ? ORDER BY idx", (p["id"],))]
        d = con.execute("SELECT d.*, p.jp1, p.jp2, p.n_jp1, p.n_jp2, p.n1, p.n2, p.n3, p.id AS pid FROM draws d "
                        "LEFT JOIN prizes p ON p.game = d.game AND p.id = d.id WHERE d.game = ? AND d.id = ?",
                        (p["game"], p["draw_id"])).fetchone()
        result, draw_date = None, None
        if d:
            draw = db._draw(d)
            draw_date = draw["date"]
            keys = [rules.prize_key(p["game"], t, draw["main"], draw["bonus"]) for t in tickets]
            result = {"main": draw["main"], "bonus": draw["bonus"],
                      "matches": [len(set(t) & set(draw["main"])) for t in tickets], "prizes": keys,
                      "won": round(sum(rules.prize_value(p["game"], k, draw["prizes"]) for k in keys if k))}
        out.append({"id": p["id"], "game": p["game"], "draw_id": p["draw_id"], "draw_date": draw_date,
                    "bought_at": p["bought_at"], "code": p["code"], "cost": rules.PRICE * len(tickets),
                    "tickets": tickets, "result": result})
    return out


def totals(con):
    rows = list_all(con)
    return {"purchases": len(rows), "tickets": sum(len(r["tickets"]) for r in rows),
            "spent": sum(r["cost"] for r in rows), "won": sum(r["result"]["won"] for r in rows if r["result"])}
