"""Self-check for the Python side. Run from the repo root: python3 tools/check.py"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["VIETLOT_DB"] = str(Path(tempfile.mkdtemp()) / "t.db")  # before import: db.py reads it once
from vietlot import db, ledger, rules, sync  # noqa: E402

# EV parity with web/js/formula.js reference: JP1 155 ty, JP2 5 ty, 2.7M tickets, rho .71 -> ~6,743
ev = rules.expected_value("655", 155e9, 5e9, 2.7e6, 0.71)
assert abs(ev - 6743) < 5, ev
assert rules.net(40e6) == 38e6 and rules.net(5e5) == 5e5

assert rules.prize_key("655", [1, 2, 3, 4, 5, 9], [1, 2, 3, 4, 5, 6], 9) == "jp2"
assert rules.prize_key("655", [1, 2, 3, 4, 5, 8], [1, 2, 3, 4, 5, 6], 9) == "p1"
assert rules.prize_key("645", [1, 2, 3, 4, 5, 9], [1, 2, 3, 4, 5, 6], None) == "p1"
assert rules.prize_key("655", [1, 2, 3, 10, 11, 12], [1, 2, 3, 4, 5, 6], 9) == "p3"
assert rules.prize_key("655", [1, 2, 13, 10, 11, 12], [1, 2, 3, 4, 5, 6], 9) is None
assert rules.prize_value("655", "jp1", {"jp1": 100e9, "n_jp1": 2, "jp2": 0, "n_jp2": 0}) == rules.net(50e9)

assert sync.next_draw("655", 1412, "2026-10-17") == (1413, "2026-10-20")  # Sat -> Tue
assert sync.next_draw("645", 1577, "2026-10-18") == (1578, "2026-10-21")  # Sun -> Wed

page = ("<p>Kỳ #1411 / 15/10/2026 ⚡ Các con số dự thưởng phải trùng với số kết quả 07 23 25 42 45 51 04 </p>"
        "<td>Jackpot 1</td><td>1 2 3 4 5 6 +</td><td>0</td><td>156,701,347,950</td>"
        "<td>Jackpot 2</td><td>1 2 3 4 5 + P</td><td>2</td><td>5,217,498,700</td>"
        "<td>1</td><td>Giải Nhất</td><td>1 2 3 4 5 +</td><td>28</td><td>40.000.000</td>"
        "<td>2</td><td>Giải Nhì</td><td>1 2 3 4 +</td><td>2,048</td><td>500.000</td>"
        "<td>3</td><td>Giải Ba</td><td>1 2 3 +</td><td>35,792</td><td>50.000</td>")
p = sync.parse_xsdlk(page, "655")
assert p == dict(id=1411, jp1=156701347950, jp2=5217498700, n_jp1=0, n_jp2=2, n1=28, n2=2048, n3=35792), p

con = db.connect()
con.execute("INSERT INTO draws VALUES ('655', 1411, '2026-10-15', 7, 23, 25, 42, 45, 51, 4)")
got = ledger.add(con, "655", [[7, 23, 25, 1, 2, 3], [42, 45, 51, 4, 9, 10]], draw_id=1411)
assert got["result"]["prizes"] == ["p3", "p3"] and got["result"]["won"] == 100000 and got["cost"] == 20000, got
for bad in ([[1, 2, 3, 4, 5]], [[1, 2, 3, 4, 5, 56]], [[1, 1, 2, 3, 4, 5]], []):
    try:
        ledger.add(con, "655", bad, draw_id=1411)
        raise AssertionError("accepted " + str(bad))
    except ValueError:
        pass
assert ledger.delete(con, got["id"]) and not con.execute("SELECT COUNT(*) FROM tickets").fetchone()[0]
print("vietlot python: all checks pass, EV", round(ev))
