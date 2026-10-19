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
