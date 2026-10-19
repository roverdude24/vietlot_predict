"""After each new draw: one macOS notification with the result, your tickets, and next draw's EV."""
import os
import subprocess

from . import db, ledger, plan, rules

NAMES = {"655": "Power 6/55", "645": "Mega 6/45"}


def _fmt(v):
    return "{:,.0f}".format(v).replace(",", ".")


def message(con, game, draw):
    nums = " ".join("%02d" % x for x in draw["main"]) + (" | %02d" % draw["bonus"] if draw["bonus"] else "")
    lines = ["Kỳ #%05d: %s" % (draw["id"], nums)]
    mine = [p for p in ledger.list_all(con) if p["game"] == game and p["draw_id"] == draw["id"] and p["result"]]
    for p in mine:
        r = p["result"]
        lines.append("Vé của bạn: trùng %s, %s" % ("-".join(map(str, r["matches"])), "trúng " + _fmt(r["won"]) + "đ" if r["won"] else "không trúng"))
    m = db.model(con, game)
    if m and m["next"]["jp1"]:
        nx = m["next"]
        ev = rules.expected_value(game, nx["jp1"], nx["jp2"] or 0, nx["sales"], 0.71)  # 0.71: typical popularity of formula-built tickets
        lines.append("Kỳ #%05d: Jackpot ~%s tỷ, vé chọn theo công thức nhận lại ~%sđ / 10.000đ"
                     % (nx["id"], _fmt(nx["jp1"] / 1e9), _fmt(round(ev, -1))))
    st = plan.status(con)
    if st["game"] == game and not st["next_bought"]:
        lines.append("Công thức của tôi: chưa mua kỳ #%05d (%sđ), gửi dòng SMS tới 9969" % (st["next_draw"], _fmt(st["cost_per_draw"])))
    return "\n".join(lines)


def _notify(title, text):
    if os.environ.get("VIETLOT_NOTIFY", "1") == "0":
        return
    esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')
    subprocess.run(["osascript", "-e", 'display notification "%s" with title "%s"' % (esc(text), esc(title))],
                   check=False, timeout=15)


def send_new(con):
    """Notify once per new draw. The first run only records the latest draw, so history never floods in."""
    log = []
    for game in ("655", "645"):
        rows = db.draws(con, game, limit=5)
        if not rows:
            continue
        seen = db.get_meta(con, "alerted_" + game)
        if seen is not None:
            for d in rows:
                if d["id"] > int(seen):
                    text = message(con, game, d)
                    _notify("Vietlott " + NAMES[game], text)
                    log.append("thông báo: " + text.replace("\n", " · "))
        db.set_meta(con, "alerted_" + game, str(rows[-1]["id"]))
    con.commit()
    return log
