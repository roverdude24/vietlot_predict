"""python3 -m vietlot {sync|serve|lab|install|uninstall}"""
import argparse
import json
import os
import plistlib
import subprocess
import sys
from pathlib import Path

from . import db

AGENTS = Path.home() / "Library" / "LaunchAgents"
LOGS = db.ROOT / "data" / "logs"


def _agents(port):
    base = {"ProgramArguments": [sys.executable, "-m", "vietlot"], "WorkingDirectory": str(db.ROOT),
            "EnvironmentVariables": {"PYTHONUNBUFFERED": "1"}}
    serve = dict(base, Label="com.vietlot.serve", KeepAlive=True, RunAtLoad=True,
                 StandardOutPath=str(LOGS / "serve.log"), StandardErrorPath=str(LOGS / "serve.log"))
    serve["ProgramArguments"] = base["ProgramArguments"] + ["serve", "--port", str(port)]
    # Draws end 18:30; the data source publishes around 19:00. A second run catches late pages.
    sync = dict(base, Label="com.vietlot.sync", StartCalendarInterval=[{"Hour": 19, "Minute": 20}, {"Hour": 21, "Minute": 30}],
                StandardOutPath=str(LOGS / "sync.log"), StandardErrorPath=str(LOGS / "sync.log"))
    sync["ProgramArguments"] = base["ProgramArguments"] + ["sync"]
    return [serve, sync]


def _launchctl(*args):
    return subprocess.run(["launchctl", *args], capture_output=True, text=True)


def install(port):
    protected = [Path.home() / d for d in ("Desktop", "Documents", "Downloads")]
    hit = [p for p in protected if p in db.ROOT.resolve().parents]
    if hit:  # macOS privacy (TCC) blocks launchd jobs from these folders: "Operation not permitted"
        sys.exit("Repo is under %s. Move it (e.g. ~/Developer) and leave a symlink, then run install again." % hit[0])
    LOGS.mkdir(parents=True, exist_ok=True)
    AGENTS.mkdir(parents=True, exist_ok=True)
    domain = "gui/%d" % os.getuid()
    for agent in _agents(port):
        path = AGENTS / (agent["Label"] + ".plist")
        _launchctl("bootout", domain, str(path))
        path.write_bytes(plistlib.dumps(agent))
        r = _launchctl("bootstrap", domain, str(path))
        print(agent["Label"], "ok" if r.returncode == 0 else "lỗi: " + r.stderr.strip())


def uninstall():
    domain = "gui/%d" % os.getuid()
    for label in ("com.vietlot.serve", "com.vietlot.sync"):
        path = AGENTS / (label + ".plist")
        _launchctl("bootout", domain, str(path))
        path.unlink(missing_ok=True)
        print(label, "removed")


def main():
    ap = argparse.ArgumentParser(prog="vietlot")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync", help="fetch new draws and winner counts, refit, notify")
    s = sub.add_parser("serve", help="web UI + API on 127.0.0.1")
    s.add_argument("--port", type=int, default=8655)
    lb = sub.add_parser("lab", help="backtest strategies against chance")
    lb.add_argument("--game", default="655", choices=sorted(db.GAMES))
    lb.add_argument("--window", type=int, default=30)
    i = sub.add_parser("install", help="launchd: server always on, sync after every draw")
    i.add_argument("--port", type=int, default=8655)
    sub.add_parser("uninstall")
    a = ap.parse_args()
    if a.cmd == "sync":
        from . import sync
        res = sync.run()
        print("\n".join(res["log"]))
    elif a.cmd == "serve":
        from . import server
        server.serve(a.port)
    elif a.cmd == "lab":
        from . import lab
        res = lab.run(db.connect(), a.game, a.window)
        print(json.dumps({k: v for k, v in res.items() if k != "frequency"}, ensure_ascii=False, indent=1))
        f = res["frequency"]
        print("chi2 = %s, df = %s, p = %s" % (f["chi2"], f["df"], f["p"]))
    elif a.cmd == "install":
        install(a.port)
    else:
        uninstall()


if __name__ == "__main__":
    main()
