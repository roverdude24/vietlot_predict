"""The user's own formula: a fixed set of disjoint tickets bought every draw (data/plan.json)."""
import json

from . import db, ledger, rules

PATH = db.ROOT / "data" / "plan.json"


def load():
    p = json.loads(PATH.read_text())
    ledger._validate(p["game"], p["tickets"])  # a hand-edited plan must still be valid tickets
    return p


def sms(game, tickets):
    """Vietlott SMS via ZaloPay to 9969, up to 5 tickets per message."""
    return ["ZLP %s K1 " % game + " ".join("S " + " ".join("%02d" % x for x in t) for t in tickets[i:i + 5])
            for i in range(0, len(tickets), 5)]


def status(con):
    p = load()
    m = db.model(con, p["game"])
    nxt = m["next"] if m else None
    bought = bool(nxt) and con.execute("SELECT 1 FROM purchases WHERE game = ? AND draw_id = ?",
                                       (p["game"], nxt["id"])).fetchone() is not None
    return dict(p, cost_per_draw=rules.PRICE * len(p["tickets"]), sms=sms(p["game"], p["tickets"]),
                next_draw=nxt["id"] if nxt else None, next_bought=bought)


def pick(con, game):
    """The set the board shows for a game: the saved plan for its game, else the same formula's set."""
    p = load()
    if p["game"] == game:
        return status(con)
    m = db.model(con, game)
    if not m or not m.get("formula_set"):
        return None
    t = m["formula_set"]
    bought = con.execute("SELECT 1 FROM purchases WHERE game = ? AND draw_id = ?", (game, m["next"]["id"])).fetchone() is not None
    return {"name": "Công thức của tôi", "game": game, "tickets": t, "cost_per_draw": rules.PRICE * len(t),
            "note": "Cùng công thức: 5 vé rời (30 số khác nhau) từ các số ít người chọn.",
            "sms": sms(game, t), "next_draw": m["next"]["id"], "next_bought": bought}
