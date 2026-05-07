import base64
import hashlib
import io
import json
import math
import os
import platform
import re
import threading
import time
import urllib.request
import uuid
import zipfile
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit


_DEFAULT_STATIC_DIR = "/app/static" if Path("/app/static").exists() else "/data/ui/static"
STATIC_DIR = Path(os.getenv("STATIC_DIR", _DEFAULT_STATIC_DIR))
CKPOOL_STATUS_DIR = Path(os.getenv("CKPOOL_STATUS_DIR", "/data/pool/www/pool"))
CKPOOL_USERS_DIR = Path(os.getenv("CKPOOL_USERS_DIR", "/data/pool/www/users"))
CKPOOL_LOG_PATH = Path(os.getenv("CKPOOL_LOG_PATH", "/data/pool/www/ckpool.log"))
CKPOOL_SHARELOG_ROOT = Path(os.getenv("CKPOOL_SHARELOG_ROOT", "/data/pool/www"))
CKPOOL_CONF_PATH = Path(os.getenv("CKPOOL_CONF_PATH", "/data/pool/config/ckpool.conf"))
NODE_CONF_PATH = Path("/data/node/bitcoin.conf")
NODE_LOG_PATH = Path("/data/node/debug.log")
NODE_REINDEX_FLAG_PATH = Path("/data/node/.reindex-chainstate")
STATE_DIR = Path("/data/ui/state")
POOL_SERIES_PATH = STATE_DIR / "pool_timeseries.jsonl"
POOL_STATE_PATH = STATE_DIR / "pool_state.json"
CKPOOL_LOG_STATE_PATH = STATE_DIR / "ckpool_log_state.json"
BLOCKS_STATE_PATH = STATE_DIR / "blocks_state.json"
INSTALL_ID_PATH = STATE_DIR / "install_id.txt"
NODE_CACHE_PATH = STATE_DIR / "node_cache.json"
POOL_CACHE_PATH = STATE_DIR / "pool_cache.json"
POOL_WORKERS_CACHE_PATH = STATE_DIR / "pool_workers_cache.json"
CHECKIN_STATE_PATH = STATE_DIR / "checkin.json"
CKPOOL_FALLBACK_DONATION_ADDRESS = "14BMjogz69qe8hk9thyzbmR5pg34mVKB1e"

APP_CHANNEL = os.getenv("APP_CHANNEL", "").strip()
NETWORK_IP = os.getenv("NETWORK_IP", "").strip()
BCHN_IMAGE = os.getenv("BCHN_IMAGE", "").strip()
CKPOOL_IMAGE = os.getenv("CKPOOL_IMAGE", "").strip()
DEFAULT_SUPPORT_BASE_URL = "https://axebench.dreamnet.uk"
INSTALL_ID_HEADER = "X-Install-Id"

def _env_or_default(name: str, default: str) -> str:
    raw = os.getenv(name)
    if raw is None:
        return default
    val = raw.strip()
    return val or default


SUPPORT_CHECKIN_URL = _env_or_default("SUPPORT_CHECKIN_URL", f"{DEFAULT_SUPPORT_BASE_URL}/api/telemetry/ping")
SUPPORT_TICKET_URL = _env_or_default("SUPPORT_TICKET_URL", f"{DEFAULT_SUPPORT_BASE_URL}/api/support/upload")

APP_ID = "gofractal"
APP_VERSION = "0.1.9"
APP_VERSION_SUFFIX = os.getenv("APP_VERSION_SUFFIX", "").strip()
DISPLAY_VERSION = f"{APP_VERSION}{APP_VERSION_SUFFIX}"

NODE_RPC_HOST = os.getenv("NODE_RPC_HOST", "fractal")
NODE_RPC_PORT = int(os.getenv("NODE_RPC_PORT", "28332"))
NODE_RPC_USER = os.getenv("NODE_RPC_USER", "fractal")
NODE_RPC_PASS = os.getenv("NODE_RPC_PASS", "")

SAMPLE_INTERVAL_S = int(os.getenv("SERIES_SAMPLE_INTERVAL_S", "30"))
POOL_CACHE_REFRESH_S = float(os.getenv("POOL_CACHE_REFRESH_S", "15"))
POOL_CACHE_TTL_S = float(os.getenv("POOL_CACHE_TTL_S", "60"))
POOL_WORKERS_CACHE_REFRESH_S = float(os.getenv("POOL_WORKERS_CACHE_REFRESH_S", "15"))
POOL_WORKERS_CACHE_TTL_S = float(os.getenv("POOL_WORKERS_CACHE_TTL_S", "60"))
BACKSCAN_DEFAULT_INTERVAL_S = int(os.getenv("BACKSCAN_INTERVAL_S", "15"))
BACKSCAN_DEFAULT_MAX_BLOCKS = int(os.getenv("BACKSCAN_MAX_BLOCKS", "10"))
BACKSCAN_MAX_BLOCKS_CAP = int(os.getenv("BACKSCAN_MAX_BLOCKS_CAP", "5000"))
MAX_RETENTION_S = int(os.getenv("SERIES_MAX_RETENTION_S", str(7 * 24 * 60 * 60)))
MAX_SERIES_POINTS = int(os.getenv("SERIES_MAX_POINTS", "20000"))

INSTALL_ID = None


PAYOUT_SCRIPT_CACHE: dict[str, str] = {}
PAYOUT_SCRIPT_CACHE_LOCK = threading.Lock()

_POOL_CACHE_LOCK = threading.Lock()
_POOL_CACHE: dict = {}

_POOL_WORKERS_CACHE_LOCK = threading.Lock()
_POOL_WORKERS_CACHE: dict = {}


ENGINE_PATH = "/var/lib/5tratumos/apps/gostratacore-engine/data/pool/coins/fractal.json"

def get_node_from_ckpool():
    conf = _read_ckpool_conf()
    btcd = conf.get("btcd", [{}])[0]

    url = btcd.get("url", "fractal:32123")

    # split host:port
    if ":" in url:
        host, port = url.split(":")
        port = int(port)
    else:
        host = url
        port = 32123

    return {
        "host": host,
        "port": port,
        "username": btcd.get("auth"),
        "password": btcd.get("pass"),
        "zmq": conf.get("zmqblock")
    }


def build_engine_config_from_pool(settings):
    node = get_node_from_ckpool()

    return {
        "coin": "FB",
        "enabled": True,
        "coin_type": "fractal",

        "coin_definition": {
            "name": "Fractal Bitcoin",
            "symbol": "FB",
            "segwit": True,
            "address": {
                "bech32": {
                    "hrp": {
                        "mainnet": "bc",
                        "testnet": "tb"
                    }
                },
                "base58": {
                    "p2pkh": {"mainnet": 0, "testnet": 111},
                    "p2sh": {"mainnet": 5, "testnet": 196}
                }
            }
        },

	"node": {
	    "host": node.get("host", "localhost"),
	    "port": node.get("port", 8332),
	    "username": node.get("username"),
	    "password": node.get("password"),
	    "zmq_enabled": True if node.get("zmq") else False,
	    "zmq_hashblock": node.get("zmq")
	},

        "stratum": {
            "host": "0.0.0.0",
            "port": 3335,
            "difficulty": int(settings.get("startdiff") or 8192),
            "ping_enabled": True,
            "ping_interval": 30,
            "accept_suggest_diff": False,
            "stale_share_grace": 5,
            "low_diff_share_grace": 5
        },

        "mining": {
            "mode": "pool",
            "address": settings.get("payoutAddress"),
            "network": "mainnet",
            "coinbase_text": "GoStrataCore/GoStratumEngine",
            "extranonce_size": 8
        },

        "vardiff": {
            "enabled": True,
            "min_diff": int(settings.get("mindiff") or 8192),
            "max_diff": int(settings.get("maxdiff") or 262144),
            "target_time": 45,
            "retarget_time": 300,
            "variance_percent": 20,
            "float_diff": False,
            "float_diff_below_one": True,
            "float_precision": 2,
            "on_new_block": True
        },

        "template_refresh_interval": 5,

        # 👇 control flags (Phase 1)
        "ibd_complete": False,
        "node_online": False
    }

def write_engine_config(cfg):
    import os, json
    os.makedirs(os.path.dirname(ENGINE_PATH), exist_ok=True)

    tmp = ENGINE_PATH + ".tmp"

    with open(tmp, "w") as f:
        json.dump(cfg, f, indent=2)

    os.replace(tmp, ENGINE_PATH)


def _install_time_s() -> int:
    # Prefer the earliest timestamp we have locally (first time-series sample).
    try:
        if POOL_SERIES_PATH.exists() and POOL_SERIES_PATH.is_file():
            with POOL_SERIES_PATH.open("r", encoding="utf-8", errors="replace") as f:
                first = f.readline().strip()
            if first:
                obj = json.loads(first)
                t = obj.get("t") if isinstance(obj, dict) else None
                if t is not None:
                    t_i = int(float(t))
                    if t_i > 1_000_000_000_000:  # ms
                        return int(t_i / 1000)
                    if t_i > 1_000_000_000:  # s
                        return int(t_i)
    except Exception:
        pass
    try:
        if INSTALL_ID_PATH.exists():
            return int(INSTALL_ID_PATH.stat().st_mtime)
    except Exception:
        pass
    try:
        if STATE_DIR.exists():
            return int(STATE_DIR.stat().st_mtime)
    except Exception:
        pass
    return int(time.time())


def _record_payout_history(addr_legacy: str) -> None:
    a = (addr_legacy or "").strip()
    if not a:
        return
    try:
        state = _read_json_file(POOL_STATE_PATH)
    except Exception:
        state = {}

    items = state.get("payout_history") if isinstance(state.get("payout_history"), list) else []
    existing = {str(it.get("addr")) for it in items if isinstance(it, dict) and it.get("addr")}
    if a not in existing:
        items.append({"addr": a, "t": int(time.time())})

    # Keep last 20.
    items = [it for it in items if isinstance(it, dict) and it.get("addr")]
    items = items[-20:]
    state["payout_history"] = items

    if not isinstance(state.get("first_seen_at"), int):
        state["first_seen_at"] = _install_time_s()

    _write_json_file(POOL_STATE_PATH, state)


def _payout_history_addresses() -> list[str]:
    out: list[str] = []

    # Current address from ckpool config, if set.
    try:
        conf = _read_ckpool_conf()
        cur = str(conf.get("btcaddress") or "").strip()
        if cur and cur not in [CKPOOL_FALLBACK_DONATION_ADDRESS, "CHANGEME_FRACTAL_PAYOUT_ADDRESS"]:
            out.append(cur)
    except Exception:
        pass

    try:
        state = _read_json_file(POOL_STATE_PATH)
        items = state.get("payout_history") if isinstance(state.get("payout_history"), list) else []
        for it in items:
            if not isinstance(it, dict):
                continue
            a = str(it.get("addr") or "").strip()
            if a:
                out.append(a)
    except Exception:
        pass

    # Dedupe preserving order (most recent last is fine).
    seen = set()
    uniq: list[str] = []
    for a in out:
        if a in seen:
            continue
        seen.add(a)
        uniq.append(a)
    return uniq


def _payout_scripts_hex(addrs: list[str]) -> set[str]:
    scripts: set[str] = set()
    for a in addrs:
        addr = (a or "").strip()
        if not addr:
            continue
        with PAYOUT_SCRIPT_CACHE_LOCK:
            cached = PAYOUT_SCRIPT_CACHE.get(addr)
        if cached:
            scripts.add(cached)
            continue
        try:
            res = _rpc_call("validateaddress", [addr]) or {}
            spk = str(res.get("scriptPubKey") or "").strip().lower()
            if spk:
                scripts.add(spk)
                with PAYOUT_SCRIPT_CACHE_LOCK:
                    PAYOUT_SCRIPT_CACHE[addr] = spk
        except Exception:
            continue
    return scripts


def _ckpool_user_best_share(addr: str) -> tuple[float | None, str | None]:
    """
    Read ckpool's per-user status file (named by address) and return:
    (best_share_difficulty, workername_for_best_share)
    """
    a = (addr or "").strip()
    if not a:
        return None, None
    try:
        base = CKPOOL_USERS_DIR.resolve()
    except Exception:
        base = CKPOOL_USERS_DIR
    path = (CKPOOL_USERS_DIR / a).resolve()
    try:
        if base and not str(path).startswith(str(base)):
            return None, None
        if not path.exists() or not path.is_file():
            return None, None
        raw = path.read_text(encoding="utf-8", errors="replace").strip()
        if not raw:
            return None, None
        obj = _extract_json_obj(raw)
        if not isinstance(obj, dict):
            return None, None

        best = obj.get("bestshare") or obj.get("best_share") or obj.get("bestShare")
        try:
            best_f = float(best)
        except Exception:
            best_f = None
        if best_f is not None and not math.isfinite(best_f):
            best_f = None

        best_worker = None
        try:
            workers = obj.get("worker")
            if isinstance(workers, list):
                best_w = -1.0
                for w in workers:
                    if not isinstance(w, dict):
                        continue
                    v = w.get("bestshare") or w.get("best_share") or w.get("bestShare")
                    try:
                        v_f = float(v)
                    except Exception:
                        continue
                    if not math.isfinite(v_f):
                        continue
                    if v_f > best_w:
                        best_w = v_f
                        best_worker = str(w.get("workername") or "").strip() or None
                if best_f is None and best_w >= 0:
                    best_f = best_w
        except Exception:
            pass

        return best_f, best_worker
    except Exception:
        return None, None


def _reset_ckpool_bestshare(addrs: list[str]) -> dict:
    # Do NOT attempt to mutate ckpool's /www/users files: ckpool will overwrite them.
    # Instead, reset GoFractal's "Since block" tracker and ignore the current all-time best share value.
    now_s = int(time.time())
    uniq: list[str] = []
    seen = set()
    for a in addrs:
        s = str(a or "").strip()
        if not s or s in seen:
            continue
        seen.add(s)
        uniq.append(s)

    best = None
    best_worker = None
    for a in uniq:
        try:
            d, w = _ckpool_user_best_share(a)
            if d is None:
                continue
            d_i = _best_share_int(d)
            if d_i is None or d_i <= 0:
                continue
            if best is None or d_i > best:
                best = d_i
                best_worker = w
        except Exception:
            continue

    try:
        state = _read_json_file(POOL_STATE_PATH)
    except Exception:
        state = {}

    state["bestshare_reset_at"] = now_s
    _reset_since_block_tracker(
        pool_state=state,
        started_at=now_s,
        exclude_value=int(best) if best is not None else None,
        exclude_reason="manual",
    )
    _write_json_file(POOL_STATE_PATH, state)

    return {"ok": True, "t": now_s, "excludedValue": best, "excludedWorker": best_worker}


def _maybe_backscan_blocks(max_blocks: int = 10) -> None:
    # Incremental backscan that finds blocks mined by this pool's payout address(es).
    try:
        addrs = _payout_history_addresses()
        if not addrs:
            return
        addr_hash = hashlib.sha256("|".join(sorted(addrs)).encode("utf-8")).hexdigest()

        state = _read_json_file(BLOCKS_STATE_PATH)
        scan = state.get("backscan") if isinstance(state.get("backscan"), dict) else {}
        prev_hash = str(scan.get("payoutAddrHash") or "").strip().lower() or None
        now_s = int(time.time())

        if prev_hash and prev_hash != addr_hash:
            if bool(scan.get("complete")):
                scan["stale"] = True
                scan["enabled"] = False
                scan["payoutAddrHash"] = addr_hash
                scan["updatedAt"] = now_s
                state["backscan"] = scan
                _write_json_file(BLOCKS_STATE_PATH, state)
                return
            if not bool(scan.get("enabled")):
                scan["stale"] = True
                scan["enabled"] = False
                scan["payoutAddrHash"] = addr_hash
                scan["updatedAt"] = now_s
                state["backscan"] = scan
                _write_json_file(BLOCKS_STATE_PATH, state)
                return
            # Scan in progress and user likely changed payout address: restart pointers.
            scan = {}

        enabled = bool(scan.get("enabled", False))
        if bool(scan.get("complete")):
            return
        if not enabled:
            return

        scripts = _payout_scripts_hex(addrs)
        if not scripts:
            return

        events = state.get("events") if isinstance(state.get("events"), list) else []
        known = {e.get("hash") for e in events if isinstance(e, dict)}

        interval_s = int(scan.get("intervalS") or BACKSCAN_DEFAULT_INTERVAL_S)
        last_run = int(scan.get("lastRunAt") or 0)
        if interval_s > 0 and last_run and (now_s - last_run) < interval_s:
            return

        max_blocks = int(scan.get("maxBlocks") or max_blocks or BACKSCAN_DEFAULT_MAX_BLOCKS)
        next_h = scan.get("nextHeight")
        start_h = scan.get("startHeight")
        tip_h = _rpc_call("getblockcount")

        try:
            tip_h = int(tip_h)
        except Exception:
            return

        if next_h is None or start_h is None:
            install_t = _install_time_s()
            approx_blocks = max(0, int((now_s - int(install_t)) / 600))
            start_h = max(0, tip_h - approx_blocks - 10)
            next_h = int(start_h)
            scan = {
                "startHeight": int(start_h),
                "nextHeight": int(next_h),
                "tipHeightAtStart": int(tip_h),
                "startedAt": now_s,
                "updatedAt": now_s,
                "enabled": True,
                "complete": False,
                "payoutAddrHash": addr_hash,
            }

        blocks_done = 0
        while blocks_done < max_blocks and int(next_h) <= tip_h:
            h = int(next_h)
            next_h = h + 1
            blocks_done += 1

            try:
                blockhash = _rpc_call("getblockhash", [h])
                if not isinstance(blockhash, str) or not re.match(r"^[0-9a-fA-F]{64}$", blockhash):
                    continue
                bh = blockhash.lower()
                if bh in known:
                    continue

                # Use verbosity=2 so the coinbase transaction is included without requiring txindex
                # (getrawtransaction may fail when txindex=0).
                blk = _rpc_call("getblock", [bh, 2]) or {}
                if not isinstance(blk, dict):
                    continue
                txs = blk.get("tx")
                if not isinstance(txs, list) or not txs:
                    continue
                cb = txs[0]
                if not isinstance(cb, dict):
                    continue
                coinbase_txid = cb.get("txid") or cb.get("hash")
                if not isinstance(coinbase_txid, str) or not re.match(r"^[0-9a-fA-F]{64}$", coinbase_txid):
                    continue
                vouts = cb.get("vout")
                if not isinstance(vouts, list):
                    continue

                matched = False
                for v in vouts:
                    if not isinstance(v, dict):
                        continue
                    spk = v.get("scriptPubKey")
                    if not isinstance(spk, dict):
                        continue
                    spk_hex = str(spk.get("hex") or "").strip().lower()
                    if spk_hex and spk_hex in scripts:
                        matched = True
                        break

                if not matched:
                    continue

                net_diff = None
                try:
                    nd = blk.get("difficulty")
                    if nd is not None:
                        nd_f = float(nd)
                        if math.isfinite(nd_f) and nd_f > 0:
                            net_diff = nd_f
                except Exception:
                    net_diff = None

                solve_diff = None
                solve_worker = None
                try:
                    best = None
                    best_w = None
                    for a in addrs:
                        d, w = _ckpool_user_best_share(a)
                        if d is None:
                            continue
                        if best is None or d > best:
                            best = d
                            best_w = w
                    solve_diff = best
                    solve_worker = best_w
                except Exception:
                    solve_diff = None
                    solve_worker = None

                # Auto-reset "Since block" when a block is detected (winning share should not stick forever).
                try:
                    v = _best_share_int(solve_diff) if solve_diff is not None else None
                    if v is not None and v > 0:
                        ps = _read_json_file(POOL_STATE_PATH)
                        _reset_since_block_tracker(
                            pool_state=ps,
                            started_at=now_s,
                            exclude_value=int(v),
                            exclude_reason="block",
                        )
                        _write_json_file(POOL_STATE_PATH, ps)
                except Exception:
                    pass

                t = blk.get("time")
                try:
                    t_i = int(t) if t is not None else now_s
                except Exception:
                    t_i = now_s

                conf = blk.get("confirmations")
                try:
                    conf_i = int(conf) if conf is not None else None
                except Exception:
                    conf_i = None

                events.append(
                    {
                        "t": t_i,
                        "hash": bh,
                        "height": h,
                        "coinbase_txid": coinbase_txid.lower(),
                        "confirmations": conf_i,
                        "network_difficulty": net_diff,
                        "solve_diff": solve_diff,
                        "solve_worker": solve_worker,
                        "source": "backscan",
                    }
                )
                known.add(bh)
            except Exception:
                continue

        scan["nextHeight"] = int(next_h)
        scan["tipHeightLast"] = int(tip_h)
        scan["updatedAt"] = now_s
        scan["lastRunAt"] = now_s
        scan["complete"] = bool(int(next_h) > tip_h)
        scan["enabled"] = bool(scan.get("enabled", False))
        scan["payoutAddrHash"] = addr_hash
        if scan["complete"]:
            scan["enabled"] = False
            scan["completedAt"] = now_s

        state["backscan"] = scan
        state["events"] = events[-200:]
        _write_json_file(BLOCKS_STATE_PATH, state)
    except Exception:
        return


def _json(data, status=200):
    body = json.dumps(data).encode("utf-8")
    return status, body, "application/json; charset=utf-8"


def _parse_month_yyyy_mm(value: str | None) -> int | None:
    s = str(value or "").strip()
    if not s:
        return None
    try:
        dt = datetime.strptime(s, "%Y-%m").replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return None


def _estimate_start_height(tip_h: int, from_ts: int, spacing_s: int, buffer_blocks: int) -> int:
    now_s = int(time.time())
    from_ts = int(from_ts)
    if from_ts <= 0 or from_ts >= now_s:
        return max(0, int(tip_h) - int(buffer_blocks))
    approx_blocks = max(0, int((now_s - from_ts) / max(1, int(spacing_s))))
    return max(0, int(tip_h) - approx_blocks - int(buffer_blocks))


def _read_static(rel_path: str):
    # Ignore query-string fragments (e.g. /app.js?v=... for cache-busting).
    rel = urlsplit(rel_path).path.lstrip("/") or "index.html"
    path = (STATIC_DIR / rel).resolve()
    if not str(path).startswith(str(STATIC_DIR.resolve())):
        return 403, b"forbidden", "text/plain; charset=utf-8"
    if not path.exists() or not path.is_file():
        return 404, b"not found", "text/plain; charset=utf-8"
    suffix = path.suffix.lower()
    content_type = "application/octet-stream"
    if suffix in [".html", ".htm"]:
        content_type = "text/html; charset=utf-8"
    elif suffix == ".css":
        content_type = "text/css; charset=utf-8"
    elif suffix == ".js":
        content_type = "application/javascript; charset=utf-8"
    elif suffix == ".svg":
        content_type = "image/svg+xml"
    elif suffix == ".png":
        content_type = "image/png"
    elif suffix == ".webp":
        content_type = "image/webp"

    if rel == "index.html" and content_type.startswith("text/html"):
        try:
            html = path.read_text(encoding="utf-8", errors="replace")
            html = html.replace("__APP_VERSION__", DISPLAY_VERSION)
            html = html.replace("__APP_CHANNEL__", APP_CHANNEL or "")
            return 200, html.encode("utf-8"), content_type
        except Exception:
            pass

    return 200, path.read_bytes(), content_type


def _rpc_call(method: str, params=None):
    if params is None:
        params = []
    url = f"http://{NODE_RPC_HOST}:{NODE_RPC_PORT}/"
    payload = json.dumps({"jsonrpc": "1.0", "id": "umbrel", "method": method, "params": params}).encode("utf-8")

    auth = base64.b64encode(f"{NODE_RPC_USER}:{NODE_RPC_PASS}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Basic {auth}"},
        method="POST",
    )
    last_err = None
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            last_err = None
            break
        except Exception as e:
            last_err = e
            if attempt == 0:
                time.sleep(0.4)
                continue
            raise
    if last_err is not None:
        raise last_err
    if data.get("error"):
        raise RuntimeError(str(data["error"]))
    return data.get("result")


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except Exception:
        return ""


def _write_text(path: Path, value: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value.strip() + "\n", encoding="utf-8")


def _get_or_create_install_id() -> str:
    existing = _read_text(INSTALL_ID_PATH)
    if existing:
        return existing
    new_id = uuid.uuid4().hex
    _write_text(INSTALL_ID_PATH, new_id)
    return new_id


def _read_json(path: Path) -> dict:
    try:
        if not path.exists():
            return {}
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_json(path: Path, data: dict):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except Exception:
        pass


def _post_json(url: str, payload: dict, *, timeout_s: int = 25, headers: dict | None = None):
    body = json.dumps(payload).encode("utf-8")
    all_headers = {"Content-Type": "application/json"}
    if headers:
        all_headers.update(headers)
    req = urllib.request.Request(
        url,
        data=body,
        headers=all_headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return resp.status, resp.read()
    except HTTPError as e:
        try:
            return int(getattr(e, "code", 0) or 0), e.read() or b""
        except Exception:
            return int(getattr(e, "code", 0) or 0), b""


def _encode_multipart(fields: dict[str, str], files: dict[str, tuple[str, bytes, str]]):
    boundary = uuid.uuid4().hex
    crlf = "\r\n"
    body = bytearray()

    for name, value in fields.items():
        body.extend(f"--{boundary}{crlf}".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{name}"{crlf}{crlf}'.encode("utf-8"))
        body.extend(value.encode("utf-8"))
        body.extend(crlf.encode("utf-8"))

    for name, (filename, data, content_type) in files.items():
        body.extend(f"--{boundary}{crlf}".encode("utf-8"))
        body.extend(
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"{crlf}'.encode("utf-8")
        )
        body.extend(f"Content-Type: {content_type}{crlf}{crlf}".encode("utf-8"))
        body.extend(data)
        body.extend(crlf.encode("utf-8"))

    body.extend(f"--{boundary}--{crlf}".encode("utf-8"))
    return boundary, bytes(body)


def _post_support_bundle(url: str, *, bundle_bytes: bytes, filename: str, timeout_s: int = 20):
    boundary, body = _encode_multipart(fields={}, files={"bundle": (filename, bundle_bytes, "application/zip")})
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        INSTALL_ID_HEADER: str(INSTALL_ID or ""),
    }
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return resp.status, resp.read()
    except HTTPError as e:
        try:
            return int(getattr(e, "code", 0) or 0), e.read() or b""
        except Exception:
            return int(getattr(e, "code", 0) or 0), b""


def _support_payload_base() -> dict:
    return {
        "install_id": INSTALL_ID,
        "app_id": APP_ID,
        "app_version": APP_VERSION,
        "channel": APP_CHANNEL or None,
        "arch": platform.machine(),
        "ts": int(time.time()),
    }


def _support_checkin_once():
    try:
        now = time.time()
        st = _read_json(CHECKIN_STATE_PATH)
        last = float(st.get("last_ping_at") or 0.0)
        if (now - last) < float(24 * 60 * 60):
            return
        payload = {"app": "GoFractal", "version": APP_VERSION}
        _post_json(SUPPORT_CHECKIN_URL, payload, timeout_s=25, headers={INSTALL_ID_HEADER: str(INSTALL_ID or "")})
        _write_json(CHECKIN_STATE_PATH, {"last_ping_at": now})
    except Exception:
        pass


def _support_checkin_loop(stop_event: threading.Event):
    _support_checkin_once()
    while not stop_event.is_set():
        stop_event.wait(24 * 60 * 60)
        if stop_event.is_set():
            break
        _support_checkin_once()

def _read_conf_kv(path: Path):
    if not path.exists():
        return {}
    out = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


_CONF_LINE_RE = re.compile(r"^\s*(#\s*)?(?P<key>[A-Za-z0-9_]+)\s*=\s*(?P<value>.*)\s*$")


def _set_conf_key(lines: list[str], key: str, value: str | None, *, comment_out: bool = False):
    found = False
    for i, line in enumerate(lines):
        m = _CONF_LINE_RE.match(line)
        if not m:
            continue
        if m.group("key") != key:
            continue
        found = True
        if value is None:
            lines[i] = f"# {key}=1"
        else:
            lines[i] = f"{key}={value}" if not comment_out else f"# {key}={value}"
    if not found and value is not None:
        lines.append(f"{key}={value}")


def _update_node_conf(network: str, prune: int, txindex: int):
    NODE_CONF_PATH.parent.mkdir(parents=True, exist_ok=True)
    if NODE_CONF_PATH.exists():
        lines = NODE_CONF_PATH.read_text(encoding="utf-8", errors="replace").splitlines()
    else:
        lines = []

    network = network.lower().strip()
    if network not in ["mainnet", "testnet", "regtest"]:
        raise ValueError("invalid network")

    _set_conf_key(lines, "txindex", str(int(bool(txindex))))
    _set_conf_key(lines, "prune", str(int(prune)))

    if network == "mainnet":
        _set_conf_key(lines, "testnet", "1", comment_out=True)
        _set_conf_key(lines, "regtest", "1", comment_out=True)
    elif network == "testnet":
        _set_conf_key(lines, "testnet", "1", comment_out=False)
        _set_conf_key(lines, "regtest", "1", comment_out=True)
    else:
        _set_conf_key(lines, "testnet", "1", comment_out=True)
        _set_conf_key(lines, "regtest", "1", comment_out=False)

    NODE_CONF_PATH.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _tail_text(path: Path, *, max_bytes: int = 64 * 1024) -> str:
    try:
        if not path.exists():
            return ""
        size = path.stat().st_size
        start = max(0, size - max_bytes)
        with path.open("rb") as f:
            f.seek(start)
            raw = f.read()
        return raw.decode("utf-8", errors="replace")
    except Exception:
        return ""


def _detect_reindex_required() -> bool:
    txt = _tail_text(NODE_LOG_PATH)
    if not txt:
        return False
    lowered = txt.lower()
    return ("previously been pruned" in lowered) and ("reindex" in lowered)


def _request_reindex_chainstate():
    try:
        NODE_REINDEX_FLAG_PATH.parent.mkdir(parents=True, exist_ok=True)
        NODE_REINDEX_FLAG_PATH.write_text(str(int(time.time())) + "\n", encoding="utf-8")
    except Exception:
        pass


def _build_support_bundle_zip(payload: dict) -> tuple[bytes, str]:
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("ticket.json", json.dumps(payload, indent=2, sort_keys=True))
        zf.writestr("about.json", json.dumps(_about(), indent=2, sort_keys=True))
        zf.writestr("settings.json", json.dumps(_current_settings(), indent=2, sort_keys=True))
    name = f"axebch-support-{int(time.time())}.zip"
    return bio.getvalue(), name


def _current_settings():
    conf = _read_conf_kv(NODE_CONF_PATH)
    net = "mainnet"
    if conf.get("regtest") == "1":
        net = "regtest"
    elif conf.get("testnet") == "1":
        net = "testnet"
    prune = int(conf.get("prune") or 0)
    txindex = int(conf.get("txindex") or 0)
    return {"network": net, "prune": prune, "txindex": txindex}


def _node_status():
    info = _rpc_call("getblockchaininfo")
    net = _rpc_call("getnetworkinfo")
    mempool = _rpc_call("getmempoolinfo")

    blocks = int(info.get("blocks") or 0)
    headers = int(info.get("headers") or blocks)
    progress = float(info.get("verificationprogress") or 0.0)
    ibd = bool(info.get("initialblockdownload", False))
    try:
        difficulty = float(info.get("difficulty") or 0.0)
    except Exception:
        difficulty = 0.0

    best_block_time = None
    try:
        bh = str(info.get("bestblockhash") or "").strip()
        if bh:
            hdr = _rpc_call("getblockheader", [bh, True]) or {}
            if isinstance(hdr, dict) and hdr.get("time") is not None:
                best_block_time = int(hdr.get("time"))
    except Exception:
        best_block_time = None

    # 👇 Override underlying BCH branding completely
    clean_subversion = "Fractal Node 0.3.0"

    status = {
        "chain": info.get("chain"),
        "blocks": blocks,
        "headers": headers,
        "difficulty": difficulty,
        "verificationprogress": progress,
        "initialblockdownload": ibd,
        "connections": int(net.get("connections") or 0),
        "subversion": clean_subversion,
        "mempool_bytes": int(mempool.get("bytes") or 0),
        "size_on_disk": int(info.get("size_on_disk") or 0),
        "pruned": bool(info.get("pruned", False)),
        "best_block_time": best_block_time,
        "median_time": int(info.get("mediantime") or 0),
        "warnings": str(info.get("warnings") or net.get("warnings") or "").strip() or None,
    }

    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        NODE_CACHE_PATH.write_text(json.dumps({"t": int(time.time()), "status": status}) + "\n", encoding="utf-8")
    except Exception:
        pass

    return status


def _read_node_cache():
    try:
        if not NODE_CACHE_PATH.exists():
            return None
        obj = json.loads(NODE_CACHE_PATH.read_text(encoding="utf-8", errors="replace"))
        t = int(obj.get("t") or 0)
        status = obj.get("status") or {}
        if not isinstance(status, dict):
            return None
        return {"t": t, "status": status}
    except Exception:
        return None


def _about():
    node = None
    node_error = None
    pool = None

    try:
        node = _node_status()
    except Exception as e:
        node_error = str(e)

    try:
        pool = _pool_settings()
    except Exception:
        pool = {}

    return {
        "channel": APP_CHANNEL or None,
        "networkIp": NETWORK_IP or None,
        "images": {
            "bchn": BCHN_IMAGE or None,
            "ckpool": CKPOOL_IMAGE or None,
        },
        "node": node,
        "nodeError": node_error,
        "pool": pool,
    }


def _extract_json_obj(text: str):
    s = text.strip()
    if not s:
        raise ValueError("empty json")

    try:
        return json.loads(s)
    except Exception:
        pass

    last = s.rfind("}")
    while last != -1:
        try:
            return json.loads(s[: last + 1])
        except Exception:
            last = s.rfind("}", 0, last)
    raise ValueError("invalid json")


def _to_hashrate_ths(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except Exception:
            return None

    s = str(value).strip()
    if not s:
        return None
    s = s.replace(",", "")
    # Extract leading float (supports scientific notation).
    m = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)", s)
    if not m:
        return None
    try:
        n = float(m.group(1))
    except Exception:
        return None

    rest = s[m.end() :].strip().replace("/", " ")
    # Find unit token like H/KH/MH/GH/TH/PH/EH, but also handle ckpool's
    # shorthand like "78.6G" / "8.06T" (no "H").
    unit = ""
    unit_match = re.search(r"(?i)\b([kmgtep]?h)\b", rest)
    if unit_match:
        unit = unit_match.group(1).lower().strip()
    else:
        shorthand = re.search(r"(?i)\b([kmgtep])\b", rest)
        if shorthand:
            unit = f"{shorthand.group(1).lower()}h"
        elif re.search(r"(?i)\bh\b", rest):
            unit = "h"

    # No unit: assume TH/s (historical behavior of this app).
    if not unit:
        return n

    scale_to_ths = {
        "h": 1e-12,
        "kh": 1e-9,
        "mh": 1e-6,
        "gh": 1e-3,
        "th": 1.0,
        "ph": 1e3,
        "eh": 1e6,
    }
    factor = scale_to_ths.get(unit)
    if factor is None:
        return None
    return n * factor


def _read_ckpool_conf():
    if not CKPOOL_CONF_PATH.exists():
        return {}
    return _extract_json_obj(CKPOOL_CONF_PATH.read_text(encoding="utf-8", errors="replace"))


def _write_ckpool_conf(conf: dict):
    CKPOOL_CONF_PATH.parent.mkdir(parents=True, exist_ok=True)
    CKPOOL_CONF_PATH.write_text(json.dumps(conf, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _pool_settings():
    conf_addr = ""
    validation_warning = None
    validated = None
    mindiff = None
    startdiff = None
    maxdiff = None
    try:
        conf = _read_ckpool_conf()
        conf_addr = str(conf.get("btcaddress") or "").strip()
        validation_warning = conf.get("validationWarning")
        validated = conf.get("validated")
        mindiff = conf.get("mindiff")
        startdiff = conf.get("startdiff")
        maxdiff = conf.get("maxdiff")
    except Exception:
        conf_addr = ""

    payout_address = conf_addr
    configured = bool(payout_address) and payout_address not in [
        CKPOOL_FALLBACK_DONATION_ADDRESS,
        "CHANGEME_FB_PAYOUT_ADDRESS",
    ]

    if not isinstance(validation_warning, str):
        validation_warning = None
    if validated is not None:
        validated = bool(validated)

    def _to_int(v, default: int) -> int:
        try:
            if isinstance(v, bool):
                return int(default)
            if isinstance(v, int):
                return int(v)
            if isinstance(v, float):
                if not math.isfinite(v):
                    return int(default)
                if float(int(v)) != float(v):
                    return int(default)
                return int(v)
            s = str(v).strip()
            if not re.fullmatch(r"[0-9]+", s):
                return int(default)
            return int(s)
        except Exception:
            return int(default)

    return {
        "payoutAddress": payout_address or "",
        "configured": configured,
        "validated": validated,
        "validationWarning": validation_warning,
        "mindiff": _to_int(mindiff, 1),
        "startdiff": _to_int(startdiff, 16),
        "maxdiff": _to_int(maxdiff, 0),
        "warning": (
            "Set a payout address before mining. If unset, ckpool may default to a donation address."
            if not configured
            else None
        ),
    }


def _update_pool_settings(*, payout_address: str):
    return _update_pool_settings_full(payout_address=payout_address)


def _update_pool_settings_full(
    *,
    payout_address: str,
    mindiff=None,
    startdiff=None,
    maxdiff=None,
):
    addr_raw = payout_address.strip()
    if not addr_raw:
        raise ValueError("payoutAddress is required")

    addr_valid = addr_raw

    validated = None
    validation_warning = None
    try:
        res = _rpc_call("validateaddress", [addr_valid]) or {}
        validated = bool(res.get("isvalid"))
        if not validated:
            raise ValueError("payoutAddress is not a valid Fractal Bitcoin address")
    except Exception:
        validated = False
        validation_warning = (
            "Node RPC unavailable; saved without RPC validation. Double-check your address, then restart the app."
        )

    conf = _read_ckpool_conf()
    # ckpool accepts standard Bitcoin/Fractal addresses (1,3,bc1)
    conf["btcaddress"] = addr_valid
    # Ensure ckpool writes pool stats files for the UI (older configs may miss these).
    conf["webdir"] = "/www/pool"
    conf["userdir"] = "/www/users"
    _record_payout_history(addr_valid)

    def _maybe_int(v):
        if v is None:
            return None
        if isinstance(v, bool):
            return None
        if isinstance(v, int):
            return int(v)
        if isinstance(v, float):
            if not math.isfinite(v):
                return None
            if float(int(v)) != float(v):
                raise ValueError("difficulty values must be whole numbers (ckpool does not support fractional difficulties)")
            return int(v)
        s = str(v).strip()
        if s == "":
            return None
        if not re.fullmatch(r"[0-9]+", s):
            raise ValueError("difficulty values must be whole numbers (ckpool does not support fractional difficulties)")
        return int(s)

    md = _maybe_int(mindiff)
    sd = _maybe_int(startdiff)
    xd = _maybe_int(maxdiff)

    # If any diff value is provided, validate and apply; otherwise keep existing config.
    if md is not None or sd is not None or xd is not None:
        md = md if md is not None else int(conf.get("mindiff") or 1)
        sd = sd if sd is not None else int(conf.get("startdiff") or 16)
        xd = xd if xd is not None else int(conf.get("maxdiff") or 0)

        if md < 1:
            raise ValueError("mindiff must be >= 1")
        if sd < 1:
            raise ValueError("startdiff must be >= 1")
        if sd < md:
            raise ValueError("startdiff must be >= mindiff")
        if xd < 0:
            raise ValueError("maxdiff must be 0 (no limit) or >= startdiff")
        if xd != 0 and xd < sd:
            raise ValueError("maxdiff must be 0 (no limit) or >= startdiff")

        conf["mindiff"] = md
        conf["startdiff"] = sd
        conf["maxdiff"] = xd
    else:
        # Self-heal older configs that don't include these keys (keep existing defaults).
        conf.setdefault("mindiff", 1)
        conf.setdefault("startdiff", 16)
        conf.setdefault("maxdiff", 0)

    conf["validated"] = bool(validated) if validated is not None else False

    if validation_warning:
        conf["validationWarning"] = validation_warning
    else:
        conf.pop("validationWarning", None)
    _write_ckpool_conf(conf)

    return _pool_settings()


def _read_pool_status_raw():
    def iter_candidates(filename: str):
        bases = [
            CKPOOL_STATUS_DIR,
            Path("/data/pool/www/pool"),
            Path("/data/pool/www"),
        ]
        seen = set()
        for base in bases:
            if not isinstance(base, Path):
                continue
            for p in [
                base / filename,
                base.parent / filename,
                base / "pool" / filename,
                base.parent / "pool" / filename,
            ]:
                if p in seen:
                    continue
                seen.add(p)
                yield p
            try:
                for p in base.glob(f"*/{filename}"):
                    if p in seen:
                        continue
                    seen.add(p)
                    yield p
            except Exception:
                continue

    entries = []
    for path in iter_candidates("pool.status"):
        if not (path.exists() and path.is_file()):
            continue
        try:
            entries.append((float(path.stat().st_mtime), path.read_text(encoding="utf-8", errors="replace").strip()))
        except Exception:
            continue

    if not entries:
        return ""

    non_empty = [e for e in entries if e[1]]
    if non_empty:
        return max(non_empty, key=lambda x: x[0])[1]
    return max(entries, key=lambda x: x[0])[1]

def _read_pool_workers_raw():
    def iter_candidates(filename: str):
        bases = [
            CKPOOL_STATUS_DIR,
            Path("/data/pool/www/pool"),
            Path("/data/pool/www"),
        ]
        seen = set()
        for base in bases:
            if not isinstance(base, Path):
                continue
            for p in [
                base / filename,
                base.parent / filename,
                base / "pool" / filename,
                base.parent / "pool" / filename,
            ]:
                if p in seen:
                    continue
                seen.add(p)
                yield p
            try:
                for p in base.glob(f"*/{filename}"):
                    if p in seen:
                        continue
                    seen.add(p)
                    yield p
            except Exception:
                continue

    entries = []
    for path in iter_candidates("pool.workers"):
        if not (path.exists() and path.is_file()):
            continue
        try:
            entries.append((float(path.stat().st_mtime), path.read_text(encoding="utf-8", errors="replace").strip()))
        except Exception:
            continue

    if not entries:
        return ""

    non_empty = [e for e in entries if e[1]]
    if non_empty:
        return max(non_empty, key=lambda x: x[0])[1]
    return max(entries, key=lambda x: x[0])[1]


def _parse_pool_status(raw: str):
    if not raw:
        return {"workers": 0, "hashrate_ths": None, "best_share": None}

    def to_int(value):
        try:
            return int(str(value).strip())
        except Exception:
            return 0

    def to_hashrate_ths(value):
        return _to_hashrate_ths(value)

    def normalize(data: dict):
        if not isinstance(data, dict):
            return {"workers": 0, "hashrate_ths": None, "best_share": None}
        workers = (
            data.get("workers")
            or data.get("Workers")
            or data.get("Users")
            or data.get("users")
            or data.get("active_workers")
            or data.get("activeWorkers")
        )

        hashrates_raw = {
            "1m": data.get("hashrate1m"),
            "5m": data.get("hashrate5m"),
            "15m": data.get("hashrate15m"),
            "1h": data.get("hashrate1hr") or data.get("hashrate1h"),
            "6h": data.get("hashrate6hr") or data.get("hashrate6h"),
            "1d": data.get("hashrate1d"),
            "7d": data.get("hashrate7d"),
        }
        hashrates_ths = {}
        for k, v in hashrates_raw.items():
            if v is None or (isinstance(v, str) and not v.strip()):
                continue
            hashrates_ths[k] = to_hashrate_ths(v)

        hashrate = (
            data.get("hashrate_ths")
            or data.get("hashrateThs")
            or data.get("hashrate")
            or data.get("Hashrate")
            or data.get("rate")
        )
        if hashrate is None:
            for k in ["1m", "5m", "15m", "1h", "6h", "1d", "7d"]:
                if k in hashrates_raw and hashrates_raw[k] is not None:
                    hashrate = hashrates_raw[k]
                    break

        best_share = data.get("bestshare") or data.get("best_share") or data.get("bestShare") or data.get("best")
        accepted = data.get("accepted")
        rejected = data.get("rejected")
        lastupdate = data.get("lastupdate") or data.get("last_update") or data.get("LastUpdate")

        # Backward-compatible "hashrate_ths" should reflect the 1-minute window when available.
        hashrate_ths = to_hashrate_ths(hashrate)
        try:
            hr1m = hashrates_ths.get("1m")
            if hr1m is not None and math.isfinite(float(hr1m)):
                hashrate_ths = float(hr1m)
        except Exception:
            pass
        return {
            "workers": to_int(workers),
            "hashrate_ths": hashrate_ths,
            "best_share": best_share,
            "hashrates_ths": hashrates_ths or None,
            "accepted": to_int(accepted) if accepted is not None else None,
            "rejected": to_int(rejected) if rejected is not None else None,
            "lastupdate": to_int(lastupdate) if lastupdate is not None else None,
        }

    def merge_json_objects(text: str) -> dict | None:
        merged = {}
        found = False
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            if not (line.startswith("{") and line.endswith("}")):
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if isinstance(obj, dict):
                merged.update(obj)
                found = True
        return merged if found else None

    merged = merge_json_objects(raw)
    if merged is not None:
        return normalize(merged)

    # Prefer JSON (ckpool often writes JSON, but can include extra log noise).
    try:
        return normalize(_extract_json_obj(raw))
    except Exception:
        try:
            start = raw.find("{")
            if start != -1:
                return normalize(_extract_json_obj(raw[start:]))
        except Exception:
            pass

    # Fallback: parse key/value lines.
    data = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, val = line.split("=", 1)
        elif ":" in line:
            key, val = line.split(":", 1)
        else:
            continue
        data[key.strip()] = val.strip()

    return normalize(data)

def _parse_pool_workers(raw: str):
    if not raw:
        return []

    # Best case: JSON list or object
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            # Some formats store under a key
            for key in ["workers", "data", "result"]:
                if isinstance(data.get(key), list):
                    return data[key]
            # Or a dict keyed by worker
            if all(isinstance(v, dict) for v in data.values()):
                out = []
                for k, v in data.items():
                    item = dict(v)
                    item.setdefault("worker", k)
                    out.append(item)
                return out
    except Exception:
        pass

    # Fallback: parse lines "worker ... lastshare ..."
    out = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p for p in line.replace("\t", " ").split(" ") if p]
        if not parts:
            continue
        out.append({"worker": parts[0], "raw": line})
    return out


def _support_ticket_payload(*, subject: str, message: str, email: str | None):
    diagnostics = {}
    try:
        node = _node_status()
        diagnostics["node"] = {
            "chain": node.get("chain"),
            "blocks": node.get("blocks"),
            "headers": node.get("headers"),
            "progress": node.get("verificationprogress"),
            "connections": node.get("connections"),
            "subversion": node.get("subversion"),
            "mempool_bytes": node.get("mempool_bytes"),
        }
    except Exception as e:
        diagnostics["node_error"] = str(e)

    try:
        pool = _parse_pool_status(_read_pool_status_raw())
        diagnostics["pool"] = {
            "workers": pool.get("workers"),
            "hashrate_ths": pool.get("hashrate_ths"),
            "best_share": pool.get("best_share"),
        }
    except Exception as e:
        diagnostics["pool_error"] = str(e)

    payload = _support_payload_base()
    payload.update(
        {
            "type": "support_ticket",
            "subject": subject,
            "message": message,
            "email": email or None,
            "diagnostics": diagnostics,
        }
    )
    return payload


def _now_ms():
    return int(time.time() * 1000)


class PoolSeries:
    def __init__(self):
        self._lock = threading.Lock()
        self._points: list[dict] = []

    def load(self):
        cutoff_ms = _now_ms() - (MAX_RETENTION_S * 1000)
        points: list[dict] = []
        if POOL_SERIES_PATH.exists():
            for line in POOL_SERIES_PATH.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    t = int(obj.get("t") or 0)
                    if t >= cutoff_ms:
                        points.append(obj)
                except Exception:
                    continue

        points.sort(key=lambda p: p.get("t", 0))
        if len(points) > MAX_SERIES_POINTS:
            points = points[-MAX_SERIES_POINTS:]

        with self._lock:
            self._points = points

        # Rewrite the file if we dropped old points or it's missing.
        self._rewrite(points)

    def _rewrite(self, points: list[dict]):
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = POOL_SERIES_PATH.with_suffix(".tmp")
        tmp.write_text("\n".join(json.dumps(p, separators=(",", ":")) for p in points) + ("\n" if points else ""), encoding="utf-8")
        tmp.replace(POOL_SERIES_PATH)

    def append(self, point: dict):
        cutoff_ms = _now_ms() - (MAX_RETENTION_S * 1000)
        with self._lock:
            self._points.append(point)
            self._points = [p for p in self._points if int(p.get("t") or 0) >= cutoff_ms]
            if len(self._points) > MAX_SERIES_POINTS:
                self._points = self._points[-MAX_SERIES_POINTS:]

            STATE_DIR.mkdir(parents=True, exist_ok=True)
            with POOL_SERIES_PATH.open("a", encoding="utf-8") as f:
                f.write(json.dumps(point, separators=(",", ":")) + "\n")

            # Occasionally compact the file (simple heuristic).
            if POOL_SERIES_PATH.stat().st_size > 10 * 1024 * 1024:
                self._rewrite(self._points)

    def query(self, trail: str, max_points: int = 1000):
        trail = (trail or "").strip().lower()
        seconds = {
            "30m": 30 * 60,
            "6h": 6 * 60 * 60,
            "12h": 12 * 60 * 60,
            "1d": 24 * 60 * 60,
            "3d": 3 * 24 * 60 * 60,
            "6d": 6 * 24 * 60 * 60,
            "7d": 7 * 24 * 60 * 60,
        }.get(trail, 30 * 60)

        cutoff_ms = _now_ms() - (seconds * 1000)
        with self._lock:
            pts = [p for p in self._points if int(p.get("t") or 0) >= cutoff_ms]

        if len(pts) <= max_points:
            return pts

        stride = (len(pts) + max_points - 1) // max_points
        return pts[::stride]


POOL_SERIES = PoolSeries()


def _series_sampler(stop_event: threading.Event):
    while not stop_event.is_set():
        try:
            status = _parse_pool_status(_read_pool_status_raw())
            workers = status.get("workers")
            try:
                workers_i = int(workers)
            except Exception:
                workers_i = 0

            def to_float(value):
                if value is None:
                    return None
                try:
                    return float(value)
                except Exception:
                    return None

            hashrates = status.get("hashrates_ths") or {}
            if not isinstance(hashrates, dict):
                hashrates = {}

            hashrate_f = to_float(hashrates.get("1m", status.get("hashrate_ths")))

            try:
                node = _node_status()
                net_diff = to_float(node.get("difficulty"))
                net_height = int(node.get("blocks") or 0)
            except Exception:
                net_diff = None
                net_height = None

            POOL_SERIES.append(
                {
                    "t": _now_ms(),
                    "workers": workers_i,
                    # Backward-compatible single-series hashrate (1m best-effort).
                    "hashrate_ths": hashrate_f,
                    # ckpool windowed hashrates for multi-line charts.
                    "hashrate_1m_ths": to_float(hashrates.get("1m")),
                    "hashrate_5m_ths": to_float(hashrates.get("5m")),
                    "hashrate_15m_ths": to_float(hashrates.get("15m")),
                    "hashrate_1h_ths": to_float(hashrates.get("1h")),
                    "hashrate_6h_ths": to_float(hashrates.get("6h")),
                    "hashrate_1d_ths": to_float(hashrates.get("1d")),
                    "hashrate_7d_ths": to_float(hashrates.get("7d")),
                    "network_difficulty": net_diff,
                    "network_height": net_height,
                }
            )

            _scan_ckpool_log_for_block_events()
            _scan_ckpool_sharelogs_for_since_block_best_share()
        except Exception:
            pass

        stop_event.wait(SAMPLE_INTERVAL_S)


def _backscan_worker(stop_event: threading.Event):
    while not stop_event.is_set():
        try:
            _maybe_backscan_blocks(max_blocks=BACKSCAN_DEFAULT_MAX_BLOCKS)
        except Exception:
            pass
        stop_event.wait(5)


def _widget_sync():
    try:
        s = _node_status()
        progress = max(0.0, min(1.0, float(s["verificationprogress"])))
        pct = int(progress * 100)
        label = "In progress" if s["initialblockdownload"] else "Synchronized"
        return {
            "type": "text-with-progress",
            "title": "FB sync",
            "text": f"{pct}%",
            "progressLabel": label,
            "progress": progress,
        }
    except Exception:
        return {
            "type": "text-with-progress",
            "title": "FB sync",
            "text": "-",
            "progressLabel": "Unavailable",
            "progress": 0,
        }


def _widget_pool():
    p = _pool_api_cached()
    return {
        "type": "three-stats",
        "items": [
            {"title": "Hashrate", "text": str(p.get("hashrate_ths") or "-"), "subtext": "TH/s"},
            {"title": "Workers", "text": str(p.get("workers") or 0)},
            {"title": "Best Share", "text": str(p.get("best_share") or "-")},
        ],
    }


def _read_json_file(path: Path) -> dict:
    try:
        if not path.exists():
            return {}
        raw = path.read_text(encoding="utf-8", errors="replace").strip()
        if not raw:
            return {}
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _write_json_file(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def _pool_cache_load() -> None:
    try:
        obj = _read_json_file(POOL_CACHE_PATH)
        if not isinstance(obj, dict):
            return
        with _POOL_CACHE_LOCK:
            _POOL_CACHE.clear()
            _POOL_CACHE.update(obj)
    except Exception:
        return


def _pool_workers_cache_load() -> None:
    try:
        obj = _read_json_file(POOL_WORKERS_CACHE_PATH)
        if not isinstance(obj, dict):
            return
        with _POOL_WORKERS_CACHE_LOCK:
            _POOL_WORKERS_CACHE.clear()
            _POOL_WORKERS_CACHE.update(obj)
    except Exception:
        return


def _pool_cache_set(data: dict | None, error: str | None = None) -> None:
    now = time.time()
    entry: dict = {"t": now}
    if isinstance(data, dict):
        entry["pool"] = data
    if error:
        entry["error"] = str(error)
    with _POOL_CACHE_LOCK:
        _POOL_CACHE.clear()
        _POOL_CACHE.update(entry)
    try:
        _write_json_file(POOL_CACHE_PATH, entry)
    except Exception:
        pass


def _pool_workers_cache_set(data: dict | None, error: str | None = None) -> None:
    now = time.time()
    entry: dict = {"t": now}
    if isinstance(data, dict):
        entry["workers"] = data
    if error:
        entry["error"] = str(error)
    with _POOL_WORKERS_CACHE_LOCK:
        _POOL_WORKERS_CACHE.clear()
        _POOL_WORKERS_CACHE.update(entry)
    try:
        _write_json_file(POOL_WORKERS_CACHE_PATH, entry)
    except Exception:
        pass


def _pool_cache_get(*, max_age_s: float) -> dict | None:
    try:
        max_age = float(max_age_s)
    except Exception:
        max_age = 0.0
    if max_age <= 0:
        return None
    with _POOL_CACHE_LOCK:
        entry = dict(_POOL_CACHE) if isinstance(_POOL_CACHE, dict) else {}
    if not entry:
        return None
    try:
        age = time.time() - float(entry.get("t") or 0.0)
    except Exception:
        age = None
    if age is None or age < 0 or age > max_age:
        return None
    return entry


def _pool_workers_cache_get(*, max_age_s: float) -> dict | None:
    try:
        max_age = float(max_age_s)
    except Exception:
        max_age = 0.0
    if max_age <= 0:
        return None
    with _POOL_WORKERS_CACHE_LOCK:
        entry = dict(_POOL_WORKERS_CACHE) if isinstance(_POOL_WORKERS_CACHE, dict) else {}
    if not entry:
        return None
    try:
        age = time.time() - float(entry.get("t") or 0.0)
    except Exception:
        age = None
    if age is None or age < 0 or age > max_age:
        return None
    return entry


def _pool_api_cached() -> dict:
    cached = _pool_cache_get(max_age_s=POOL_CACHE_TTL_S)
    if cached and isinstance(cached.get("pool"), dict):
        out = dict(cached["pool"])
        out["cached"] = True
        try:
            out["cache_age_s"] = max(0.0, time.time() - float(cached.get("t") or 0.0))
        except Exception:
            pass
        if cached.get("error"):
            out["stale_error"] = str(cached.get("error") or "")
        return out
    return {
        "cached": True,
        "error": "warming up",
        "workers": 0,
        "hashrate_ths": None,
        "best_share": None,
        "best_share_all_time": None,
        "best_share_since_block": None,
        "best_share_since_block_worker": None,
        "eta_seconds": None,
        "eta_text": None,
        "network_difficulty": None,
        "network_height": None,
        "network_algo": None,
    }


def _pool_workers_api_cached() -> dict:
    cached = _pool_workers_cache_get(max_age_s=POOL_WORKERS_CACHE_TTL_S)
    if cached and isinstance(cached.get("workers"), dict):
        out = dict(cached["workers"])
        out["cached"] = True
        try:
            out["cache_age_s"] = max(0.0, time.time() - float(cached.get("t") or 0.0))
        except Exception:
            pass
        if cached.get("error"):
            out["stale_error"] = str(cached.get("error") or "")
        return out
    return {"cached": True, "error": "warming up", "workers": 0, "workers_details": []}


def _pool_cache_worker(stop_event: threading.Event):
    while not stop_event.is_set():
        try:
            data = _pool_api()
            _pool_cache_set(data, error=None)
        except Exception as e:
            try:
                with _POOL_CACHE_LOCK:
                    last_pool = dict(_POOL_CACHE.get("pool") or {}) if isinstance(_POOL_CACHE.get("pool"), dict) else None
                _pool_cache_set(last_pool, error=str(e))
            except Exception:
                pass
        stop_event.wait(max(1.0, float(POOL_CACHE_REFRESH_S)))


def _pool_workers_cache_worker(stop_event: threading.Event):
    while not stop_event.is_set():
        try:
            data = _pool_workers_api()
            _pool_workers_cache_set(data, error=None)
        except Exception as e:
            try:
                with _POOL_WORKERS_CACHE_LOCK:
                    last_workers = (
                        dict(_POOL_WORKERS_CACHE.get("workers") or {})
                        if isinstance(_POOL_WORKERS_CACHE.get("workers"), dict)
                        else None
                    )
                _pool_workers_cache_set(last_workers, error=str(e))
            except Exception:
                pass
        stop_event.wait(max(1.0, float(POOL_WORKERS_CACHE_REFRESH_S)))


def _best_share_int(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        try:
            return int(value)
        except Exception:
            return None
    s = str(value).strip()
    if not s:
        return None
    try:
        if re.match(r"^[0-9]+$", s):
            return int(s)
        return int(float(s))
    except Exception:
        return None


def _format_duration(seconds: float | int | None) -> str | None:
    try:
        if seconds is None:
            return None
        s = float(seconds)
        if not math.isfinite(s) or s < 0:
            return None
        s = int(s)
    except Exception:
        return None

    if s < 60:
        return f"{s}s"
    m, _ = divmod(s, 60)
    if m < 60:
        return f"{m}m"
    h, m = divmod(m, 60)
    if h < 48:
        return f"{h}h {m}m"
    d, h = divmod(h, 24)
    return f"{d}d {h}h"


def _estimate_time_to_block_seconds(network_difficulty: float | None, hashrate_ths: float | None) -> float | None:
    try:
        if network_difficulty is None or hashrate_ths is None:
            return None
        diff = float(network_difficulty)
        ths = float(hashrate_ths)
        if not math.isfinite(diff) or not math.isfinite(ths) or diff <= 0 or ths <= 0:
            return None
        hps = ths * 1e12
        return (diff * 4294967296.0) / hps
    except Exception:
        return None


def _pool_api():
    pool = _parse_pool_status(_read_pool_status_raw())

    user = {}
    try:
        user = _read_ckpool_user_stats()
    except Exception:
        user = {}

    best_share_user = _best_share_int(user.get("bestshare")) if isinstance(user, dict) else None
    best_ever_user = _best_share_int(user.get("bestever")) if isinstance(user, dict) else None

    best_share = best_share_user if best_share_user is not None else _best_share_int(pool.get("best_share"))
    if best_share is not None and int(best_share) <= 0:
        best_share = None
    pool["best_share"] = best_share
    state = _read_json_file(POOL_STATE_PATH)
    best_all_time = _best_share_int(state.get("best_share_all_time"))

    # Prefer ckpool's per-user "bestever" if available.
    if best_ever_user is not None and (best_all_time is None or best_ever_user > best_all_time):
        best_all_time = best_ever_user
        state["best_share_all_time"] = best_all_time
        state["best_share_all_time_at"] = int(time.time())
        _write_json_file(POOL_STATE_PATH, state)

    if best_share is not None and (best_all_time is None or best_share > best_all_time):
        best_all_time = best_share
        state["best_share_all_time"] = best_all_time
        state["best_share_all_time_at"] = int(time.time())
        _write_json_file(POOL_STATE_PATH, state)

    pool["best_share_all_time"] = best_all_time

    try:
        since_best = _best_share_int(state.get("since_block_best_share"))
    except Exception:
        since_best = None
    since_worker = str(state.get("since_block_best_share_worker") or "").strip() or None
    pool["best_share_since_block"] = since_best if since_best is not None and since_best > 0 else None
    pool["best_share_since_block_worker"] = since_worker

    # Reset "Since block" right after a solve so it only reflects shares submitted after the solve.
    # ckpool's per-user bestshare may still show the winning share until the next share updates stats.
    try:
        last_solve_at = int(state.get("last_solve_at") or 0)
    except Exception:
        last_solve_at = 0
    try:
        user_lastshare = int(float(user.get("lastshare") or 0)) if isinstance(user, dict) else 0
    except Exception:
        user_lastshare = 0
    if last_solve_at > 0 and (user_lastshare <= 0 or user_lastshare <= last_solve_at):
        pool["best_share"] = None
        pool["best_share_reset_at"] = last_solve_at

    try:
        node = _node_status()
        net_diff = node.get("difficulty")
        net_height = node.get("blocks")
    except Exception:
        net_diff = None
        net_height = None

    # ckpool can report a 0 1m rate even while longer windows are non-zero. Use
    # the first non-zero window so ETA + headline hashrate stay meaningful.
    try:
        hashrate_ths = pool.get("hashrate_ths")
        hashrate_f = float(hashrate_ths) if hashrate_ths is not None else None
    except Exception:
        hashrate_f = None

    hashrates = pool.get("hashrates_ths") if isinstance(pool.get("hashrates_ths"), dict) else {}
    if not isinstance(hashrates, dict):
        hashrates = {}

    chosen_window = None
    if hashrate_f is None or hashrate_f <= 0:
        for k in ["5m", "15m", "1h", "6h", "1d", "7d", "1m"]:
            v = hashrates.get(k)
            try:
                fv = float(v)
            except Exception:
                continue
            if math.isfinite(fv) and fv > 0:
                hashrate_f = fv
                chosen_window = k
                break

    if hashrate_f is not None and math.isfinite(hashrate_f):
        pool["hashrate_ths"] = hashrate_f
    else:
        pool["hashrate_ths"] = None

    if chosen_window:
        pool["hashrate_window"] = chosen_window

    eta_seconds = _estimate_time_to_block_seconds(net_diff, pool.get("hashrate_ths"))
    pool["network_difficulty"] = net_diff
    pool["network_height"] = net_height
    pool["network_algo"] = "sha256d"
    pool["eta_seconds"] = eta_seconds
    pool["eta_text"] = _format_duration(eta_seconds)
    return pool


def _read_ckpool_user_stats() -> dict:
    try:
        conf = _read_ckpool_conf()
        user = str(conf.get("btcaddress") or "").strip()
    except Exception:
        user = ""

    candidates: list[Path] = []
    if user:
        candidates.append(CKPOOL_USERS_DIR / user)

    # Prefer the exact configured payout file if present (otherwise we can accidentally
    # pick a different user's file purely based on mtime).
    try:
        exact = CKPOOL_USERS_DIR / user if user else None
        if exact and exact.exists() and exact.is_file():
            raw = exact.read_text(encoding="utf-8", errors="replace").strip() or "{}"
            obj = json.loads(raw)
            return obj if isinstance(obj, dict) else {}
    except Exception:
        pass

    try:
        for p in CKPOOL_USERS_DIR.iterdir():
            if p.is_file():
                candidates.append(p)
    except Exception:
        pass

    best = None
    best_mtime = -1.0
    for p in candidates:
        try:
            if not (p.exists() and p.is_file()):
                continue
            mtime = float(p.stat().st_mtime)
            if mtime > best_mtime:
                best_mtime = mtime
                best = p
        except Exception:
            continue

    if not best:
        return {}

    try:
        raw = best.read_text(encoding="utf-8", errors="replace").strip() or "{}"
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _pool_workers_api() -> dict:
    now = int(time.time())
    user = _read_ckpool_user_stats()
    worker_rows = user.get("worker") if isinstance(user.get("worker"), list) else []
    pool_state = _read_json_file(POOL_STATE_PATH)
    by_worker = pool_state.get("since_block_best_share_by_worker") if isinstance(pool_state, dict) else None
    if not isinstance(by_worker, dict):
        by_worker = {}
    last_by_worker = pool_state.get("last_share_diff_by_worker") if isinstance(pool_state, dict) else None
    if not isinstance(last_by_worker, dict):
        last_by_worker = {}

    # Keep the per-worker "best since block" consistent with the overall card.
    # Older installs may have a correct overall best value but an incomplete
    # per-worker map (added later), which makes the worker list look "too low".
    since_block_best_i = None
    since_block_best_worker = ""
    since_block_best_worker_suffix = ""
    if isinstance(pool_state, dict):
        since_block_best_i = _best_share_int(pool_state.get("since_block_best_share"))
        since_block_best_worker = str(pool_state.get("since_block_best_share_worker") or "").strip()
        since_block_best_worker_suffix = since_block_best_worker.split(".")[-1].strip() if "." in since_block_best_worker else since_block_best_worker

    def _maybe_int(v):
        try:
            if v is None or isinstance(v, bool):
                return None
            if isinstance(v, int):
                return int(v)
            if isinstance(v, float):
                if not math.isfinite(v):
                    return None
                return int(v)
            s = str(v).strip()
            if not s:
                return None
            if re.fullmatch(r"[0-9]+", s):
                return int(s)
            # tolerate "123.0"
            f = float(s)
            if not math.isfinite(f):
                return None
            return int(f)
        except Exception:
            return None

    workers = []
    for w in worker_rows:
        if not isinstance(w, dict):
            continue
        name = str(w.get("workername") or "").strip()
        # ckpool reports workers as "<payout>.<worker>", but the UI and the
        # sharelog-derived "best share since block" tracker operate on the
        # worker suffix. Try both forms so the UI can show per-worker best
        # share even when ckpool includes the payout prefix.
        name_suffix = name.split(".")[-1].strip() if "." in name else name
        lastshare = w.get("lastshare")
        try:
            lastshare_i = int(float(lastshare)) if lastshare is not None else None
        except Exception:
            lastshare_i = None
        bestshare_i = _best_share_int(w.get("bestshare"))
        if bestshare_i is not None and bestshare_i <= 0:
            bestshare_i = None

        bestshare_since_block_i = None
        if name or name_suffix:
            try:
                bestshare_since_block_i = _best_share_int(by_worker.get(name_suffix) or by_worker.get(name))
                if bestshare_since_block_i is not None and bestshare_since_block_i <= 0:
                    bestshare_since_block_i = None
            except Exception:
                bestshare_since_block_i = None

        # If this worker is the overall "best since block" winner, ensure the per-worker
        # value is at least the overall best.
        if since_block_best_i is not None and since_block_best_i > 0 and (name or name_suffix):
            if (since_block_best_worker and name == since_block_best_worker) or (
                since_block_best_worker_suffix and name_suffix == since_block_best_worker_suffix
            ):
                if bestshare_since_block_i is None or bestshare_since_block_i < since_block_best_i:
                    bestshare_since_block_i = since_block_best_i

        current_diff_i = None
        for k in ["difficulty", "diff", "curdiff", "currentdiff", "vardiff", "stratumDifficulty"]:
            current_diff_i = _maybe_int(w.get(k))
            if current_diff_i is not None and current_diff_i > 0:
                break
            current_diff_i = None
        if current_diff_i is None and name_suffix:
            try:
                v = _best_share_int(last_by_worker.get(name_suffix))
            except Exception:
                v = None
            if v is not None and v > 0:
                current_diff_i = int(v)

        workers.append(
            {
                "workername": name,
                "hashrate_ths": _to_hashrate_ths(w.get("hashrate1m")),
                "hashrate_1m_ths": _to_hashrate_ths(w.get("hashrate1m")),
                "hashrate_5m_ths": _to_hashrate_ths(w.get("hashrate5m")),
                "hashrate_1h_ths": _to_hashrate_ths(w.get("hashrate1hr") or w.get("hashrate1h")),
                "hashrate_1d_ths": _to_hashrate_ths(w.get("hashrate1d")),
                "hashrate_7d_ths": _to_hashrate_ths(w.get("hashrate7d")),
                "lastshare": lastshare_i,
                "lastshare_ago_s": (now - lastshare_i) if lastshare_i else None,
                "shares": int(float(w.get("shares") or 0)),
                "bestshare": bestshare_i,
                "bestever": _best_share_int(w.get("bestever")),
                "bestshare_since_block": bestshare_since_block_i,
                "current_diff": current_diff_i,
            }
        )

    workers.sort(key=lambda x: int(x.get("lastshare") or 0), reverse=True)

    try:
        user_lastshare = int(float(user.get("lastshare") or 0)) if user.get("lastshare") is not None else None
    except Exception:
        user_lastshare = None

    return {
        "workers": int(float(user.get("workers") or len(workers) or 0)),
        "lastshare": user_lastshare,
        "lastshare_ago_s": (now - user_lastshare) if user_lastshare else None,
        "workers_details": workers,
    }


def _scan_ckpool_log_for_block_events() -> None:
    # Best-effort: tail ckpool log for block solve/submit messages.
    try:
        if not (CKPOOL_LOG_PATH.exists() and CKPOOL_LOG_PATH.is_file()):
            return
    except Exception:
        return

    state = _read_json_file(CKPOOL_LOG_STATE_PATH)
    try:
        offset = int(state.get("offset") or 0)
    except Exception:
        offset = 0

    try:
        size = int(CKPOOL_LOG_PATH.stat().st_size)
    except Exception:
        return

    if offset > size:
        offset = 0

    try:
        with CKPOOL_LOG_PATH.open("rb") as f:
            f.seek(offset)
            chunk = f.read()
            new_offset = f.tell()
    except Exception:
        return

    if not chunk:
        return

    text = chunk.decode("utf-8", errors="replace")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    block_re = re.compile(r"(?i)\b([0-9a-f]{64})\b")
    trigger_re = re.compile(r"(?i)\b(solved|block found|found a block|submitblock|submitted block)\b")
    ignore_re = re.compile(r"(?i)\b(zmq block hash|block hash changed)\b")

    blocks_state = _read_json_file(BLOCKS_STATE_PATH)
    events = blocks_state.get("events") if isinstance(blocks_state.get("events"), list) else []
    known = {e.get("hash") for e in events if isinstance(e, dict)}

    last_solve_now = None
    for ln in lines:
        if ignore_re.search(ln):
            continue
        if not trigger_re.search(ln):
            continue
        m = block_re.search(ln)
        if not m:
            continue
        h = m.group(1).lower()
        if h in known:
            continue
        now_s = int(time.time())
        events.append({"t": now_s, "detected_at": now_s, "hash": h, "log": ln, "source": "ckpool"})
        known.add(h)
        last_solve_now = now_s

    blocks_state["events"] = events[-200:]
    _write_json_file(BLOCKS_STATE_PATH, blocks_state)
    _write_json_file(CKPOOL_LOG_STATE_PATH, {"offset": new_offset, "updated_at": int(time.time())})

    if last_solve_now:
        try:
            pool_state = _read_json_file(POOL_STATE_PATH)
            pool_state["last_solve_at"] = int(last_solve_now)
            # Auto-reset "Since block" on solve: suppress the current bestshare value.
            try:
                addrs = _payout_history_addresses()
                best = None
                for a in addrs:
                    d, _w = _ckpool_user_best_share(a)
                    if d is None:
                        continue
                    di = _best_share_int(d)
                    if di is None or di <= 0:
                        continue
                    if best is None or di > best:
                        best = di
                if best is not None:
                    _reset_since_block_tracker(
                        pool_state=pool_state,
                        started_at=int(last_solve_now),
                        exclude_value=int(best),
                        exclude_reason="block",
                    )
            except Exception:
                pass
            _write_json_file(POOL_STATE_PATH, pool_state)
        except Exception:
            pass


def _ckpool_sharelog_paths() -> list[Path]:
    root = CKPOOL_SHARELOG_ROOT
    out: list[Path] = []
    try:
        if not root.exists():
            return []
        for d in root.iterdir():
            if not d.is_dir():
                continue
            # Skip non-sharelog dirs under /www.
            if d.name in ["users", "pool"]:
                continue
            for f in d.glob("*.sharelog"):
                if f.is_file():
                    out.append(f)
    except Exception:
        return []
    out.sort(key=lambda p: str(p))
    return out


def _ckpool_sharelog_offsets_at_end() -> dict[str, int]:
    offsets: dict[str, int] = {}
    for p in _ckpool_sharelog_paths():
        try:
            rel = str(p.relative_to(CKPOOL_SHARELOG_ROOT))
        except Exception:
            rel = str(p)
        try:
            offsets[rel] = int(p.stat().st_size)
        except Exception:
            continue
    return offsets


def _parse_sharelog_createdate_s(value) -> int | None:
    try:
        if value is None:
            return None
        s = str(value).strip()
        if not s:
            return None
        # Format: "1767712973,479418327"
        if "," in s:
            s = s.split(",", 1)[0]
        t = int(s)
        return t if t > 0 else None
    except Exception:
        return None


def _reset_since_block_tracker(
    *,
    pool_state: dict,
    started_at: int,
    exclude_value: int | None,
    exclude_reason: str,
) -> None:
    pool_state["since_block_started_at"] = int(started_at)
    pool_state["since_block_best_share"] = None
    pool_state["since_block_best_share_worker"] = None
    pool_state["since_block_best_share_at"] = None
    pool_state["since_block_best_share_by_worker"] = {}

    # Sharelogs are stored in rotating *.sharelog files. Capture "end offsets" so the
    # next scan only considers shares after this reset boundary.
    pool_state["since_block_sharelog_offsets"] = _ckpool_sharelog_offsets_at_end()
    pool_state["since_block_sharelog_set_at"] = int(started_at)

    # Keep the old field for backward compatibility (no longer used for scanning).
    try:
        pool_state["since_block_log_offset"] = int(CKPOOL_LOG_PATH.stat().st_size)
    except Exception:
        pool_state["since_block_log_offset"] = 0

    if exclude_value is not None and exclude_value > 0:
        pool_state["since_block_exclude_value"] = int(exclude_value)
        pool_state["since_block_exclude_set_at"] = int(started_at)
        pool_state["since_block_exclude_reason"] = str(exclude_reason or "").strip() or "unknown"


def _scan_ckpool_sharelogs_for_since_block_best_share() -> None:
    try:
        state = _read_json_file(POOL_STATE_PATH)
    except Exception:
        state = {}

    try:
        started_at = int(state.get("since_block_started_at") or 0)
    except Exception:
        started_at = 0
    if started_at <= 0:
        return

    positions = state.get("since_block_sharelog_offsets")
    if not isinstance(positions, dict):
        positions = {}

    try:
        exclude_val = _best_share_int(state.get("since_block_exclude_value"))
    except Exception:
        exclude_val = None

    try:
        best = _best_share_int(state.get("since_block_best_share"))
    except Exception:
        best = None
    best_worker = str(state.get("since_block_best_share_worker") or "").strip() or None
    by_worker = state.get("since_block_best_share_by_worker")
    if not isinstance(by_worker, dict):
        by_worker = {}
    by_worker_updated = False

    last_diff_by_worker = state.get("last_share_diff_by_worker")
    if not isinstance(last_diff_by_worker, dict):
        last_diff_by_worker = {}
    last_at_by_worker = state.get("last_share_at_by_worker")
    if not isinstance(last_at_by_worker, dict):
        last_at_by_worker = {}

    sharelogs = _ckpool_sharelog_paths()
    existing = {str(p.relative_to(CKPOOL_SHARELOG_ROOT)) for p in sharelogs}
    # Drop offsets for files that no longer exist (prevents unbounded growth).
    positions = {k: v for (k, v) in positions.items() if k in existing}

    updated = False
    for p in sharelogs:
        try:
            rel = str(p.relative_to(CKPOOL_SHARELOG_ROOT))
        except Exception:
            rel = str(p)
        try:
            offset = int(positions.get(rel) or 0)
        except Exception:
            offset = 0

        try:
            size = int(p.stat().st_size)
        except Exception:
            continue
        if offset > size:
            offset = 0

        # Bound per-file read size to avoid pathological CPU/memory if the app has been down.
        max_read = 2_000_000
        if size - offset > max_read:
            offset = max(0, size - max_read)

        try:
            with p.open("rb") as f:
                f.seek(offset)
                chunk = f.read()
                new_offset = f.tell()
        except Exception:
            continue

        positions[rel] = int(new_offset)
        if not chunk:
            continue

        for raw in chunk.splitlines():
            if not raw:
                continue
            try:
                obj = json.loads(raw.decode("utf-8", errors="replace"))
            except Exception:
                continue
            if not isinstance(obj, dict):
                continue

            ts_s = _parse_sharelog_createdate_s(obj.get("createdate")) or 0
            effective_ts = ts_s if ts_s > 0 else int(time.time())

            # ckpool sharelogs contain both "diff" and "sdiff"; sdiff is the actual share difficulty hit.
            diff_i = _best_share_int(obj.get("sdiff"))
            if diff_i is None:
                diff_i = _best_share_int(obj.get("diff"))
            if diff_i is None or diff_i <= 0:
                continue

            w = str(obj.get("workername") or "").strip() or None
            # Normalize worker labels: ckpool can report full "wallet.worker" in logs.
            if w and "." in w:
                w = w.split(".")[-1].strip() or w

            # Track per-worker "last share difficulty" irrespective of the since-block window.
            # Some ckpool sharelog lines omit/format createdate unexpectedly; in that case, fall
            # back to "now" so the UI can still show per-worker last-diff/current-diff estimates.
            if w:
                try:
                    prev_ts = int(float(last_at_by_worker.get(w) or 0))
                except Exception:
                    prev_ts = 0
                if prev_ts <= 0 or effective_ts >= prev_ts:
                    last_at_by_worker[w] = int(effective_ts)
                    last_diff_by_worker[w] = int(diff_i)

            # If createdate is present, enforce the since-block boundary by timestamp.
            # If it's missing, the per-file byte offset boundary already keeps us "since block".
            if ts_s > 0 and ts_s <= started_at:
                continue
            if exclude_val is not None and int(diff_i) == int(exclude_val):
                continue

            if best is None or diff_i > best:
                best = diff_i
                best_worker = w
                updated = True

            if w:
                try:
                    prev = _best_share_int(by_worker.get(w))
                except Exception:
                    prev = None
                if prev is None or diff_i > prev:
                    by_worker[w] = int(diff_i)
                    by_worker_updated = True

    state["since_block_sharelog_offsets"] = positions
    state["last_share_diff_by_worker"] = last_diff_by_worker
    state["last_share_at_by_worker"] = last_at_by_worker
    if by_worker_updated:
        state["since_block_best_share_by_worker"] = by_worker
    if updated:
        state["since_block_best_share"] = int(best) if best is not None else None
        state["since_block_best_share_worker"] = best_worker
        state["since_block_best_share_at"] = int(time.time())
    _write_json_file(POOL_STATE_PATH, state)


def _ensure_since_block_tracker_initialized() -> None:
    now_s = int(time.time())
    try:
        state = _read_json_file(POOL_STATE_PATH)
    except Exception:
        state = {}

    try:
        started_at = int(state.get("since_block_started_at") or 0)
    except Exception:
        started_at = 0

    if started_at > 0:
        return

    _reset_since_block_tracker(
        pool_state=state,
        started_at=now_s,
        exclude_value=None,
        exclude_reason="boot",
    )
    _write_json_file(POOL_STATE_PATH, state)


def _reset_since_block_tracker_for_worker(worker: str) -> dict:
    raw = str(worker or "").strip()
    if not raw:
        raise ValueError("missing worker")

    name = raw
    name_suffix = raw.split(".")[-1].strip() if "." in raw else raw

    state = _read_json_file(POOL_STATE_PATH)
    if not isinstance(state, dict):
        state = {}

    by_worker = state.get("since_block_best_share_by_worker")
    if not isinstance(by_worker, dict):
        by_worker = {}

    removed = []
    for k in [name, name_suffix]:
        if not k:
            continue
        if k in by_worker:
            removed.append(k)
            by_worker.pop(k, None)

    # Recompute the overall "since block" best from the remaining per-worker map.
    best_val = None
    best_key = None
    for k, v in by_worker.items():
        vi = _best_share_int(v)
        if vi is None or vi <= 0:
            continue
        if best_val is None or vi > best_val:
            best_val = int(vi)
            best_key = str(k)

    if best_val is None:
        state["since_block_best_share"] = None
        state["since_block_best_share_worker"] = None
        state["since_block_best_share_at"] = None
    else:
        state["since_block_best_share"] = int(best_val)
        state["since_block_best_share_worker"] = best_key
        state["since_block_best_share_at"] = int(time.time())

    state["since_block_best_share_by_worker"] = by_worker
    _write_json_file(POOL_STATE_PATH, state)

    return {
        "ok": True,
        "worker": name_suffix or name,
        "removedKeys": removed,
        "bestShareSinceBlock": best_val,
        "bestShareSinceBlockWorker": best_key,
    }


def _blocks_api() -> dict:
    state = _read_json_file(BLOCKS_STATE_PATH)
    events = state.get("events") if isinstance(state.get("events"), list) else []
    addrs = _payout_history_addresses()
    best_share = None
    best_worker = None
    try:
        for a in addrs:
            d, w = _ckpool_user_best_share(a)
            if d is None:
                continue
            if best_share is None or d > best_share:
                best_share = d
                best_worker = w
    except Exception:
        best_share = None
        best_worker = None
    out = []
    updated = False
    for e in events:
        if not isinstance(e, dict):
            continue
        h = str(e.get("hash") or "").strip().lower()
        if not re.match(r"^[0-9a-f]{64}$", h):
            continue

        # Opportunistically enrich events with metadata (txindex not required).
        if (
            not e.get("height")
            or not e.get("coinbase_txid")
            or e.get("confirmations") is None
            or e.get("network_difficulty") is None
            or e.get("solve_diff") is None
            or e.get("solve_worker") is None
        ):
            try:
                blk = _rpc_call("getblock", [h, 1])
                if isinstance(blk, dict):
                    height = blk.get("height")
                    txs = blk.get("tx")
                    coinbase_txid = txs[0] if isinstance(txs, list) and txs else None
                    if height is not None:
                        e["height"] = int(height)
                        updated = True
                    if coinbase_txid:
                        e["coinbase_txid"] = str(coinbase_txid)
                        updated = True
                    if e.get("network_difficulty") is None and "difficulty" in blk and blk.get("difficulty") is not None:
                        try:
                            nd = float(blk.get("difficulty"))
                            if math.isfinite(nd) and nd > 0:
                                e["network_difficulty"] = nd
                                updated = True
                        except Exception:
                            pass
                    if "confirmations" in blk and blk.get("confirmations") is not None:
                        try:
                            e["confirmations"] = int(blk.get("confirmations"))
                            updated = True
                        except Exception:
                            pass
                    if e.get("solve_diff") is None and best_share is not None:
                        e["solve_diff"] = float(best_share)
                        updated = True
                    if e.get("solve_worker") is None and best_worker:
                        e["solve_worker"] = str(best_worker)
                        updated = True
            except Exception:
                pass

        out.append(
            {
                "t": int(e.get("t") or 0),
                "hash": h,
                "height": e.get("height"),
                "network_difficulty": e.get("network_difficulty") or e.get("difficulty"),
                "confirmations": e.get("confirmations"),
                "coinbase_txid": e.get("coinbase_txid"),
                "solve_diff": e.get("solve_diff"),
                "solve_worker": e.get("solve_worker"),
                "explorer_block": f"https://blockchair.com/bitcoin-cash/block/{h}",
                "explorer_tx": f"https://blockchair.com/bitcoin-cash/transaction/{e.get('coinbase_txid')}"
                if e.get("coinbase_txid")
                else None,
                # Backward-compat: original key used by older UI.
                "explorer": f"https://blockchair.com/bitcoin-cash/block/{h}",
                "log": str(e.get("log") or ""),
            }
        )
    out.sort(key=lambda x: int(x.get("t") or 0), reverse=True)
    if updated:
        state["events"] = events[-200:]
        _write_json_file(BLOCKS_STATE_PATH, state)
    backscan = state.get("backscan") if isinstance(state.get("backscan"), dict) else {}
    return {"events": out, "backscan": backscan}


class Handler(BaseHTTPRequestHandler):
    server_version = f"{APP_ID}/{APP_VERSION}"

    def _send(self, status: int, body: bytes, content_type: str):
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/about":
            return self._send(*_json(_about()))

        if self.path == "/api/settings":
            return self._send(*_json(_current_settings()))

        if self.path == "/api/pool/settings":
            return self._send(*_json(_pool_settings()))

        if self.path == "/api/support/status":
            return self._send(
                *_json(
                    {
                        "ticketEnabled": bool(SUPPORT_TICKET_URL),
                        "checkinEnabled": bool(SUPPORT_CHECKIN_URL),
                    }
                )
            )

        if self.path == "/api/node":
            reindex_requested = NODE_REINDEX_FLAG_PATH.exists()
            reindex_required = _detect_reindex_required()
            try:
                s = _node_status()
                payload = dict(s)
                payload.update(
                    {
                        "cached": False,
                        "lastSeen": int(time.time()),
                        "reindexRequested": reindex_requested,
                        "reindexRequired": False,
                    }
                )
                return self._send(*_json(payload))
            except (HTTPError, URLError, RuntimeError) as e:
                cached = _read_node_cache()
                if cached:
                    payload = dict(cached["status"])
                    payload.update(
                        {
                            "cached": True,
                            "lastSeen": int(cached["t"]),
                            "error": str(e),
                            "reindexRequested": reindex_requested,
                            "reindexRequired": reindex_required,
                        }
                    )
                    return self._send(*_json(payload))
                return self._send(
                    *_json(
                        {
                            "error": str(e),
                            "reindexRequested": reindex_requested,
                            "reindexRequired": reindex_required,
                        },
                        status=503,
                    )
                )

        if self.path == "/api/pool":
            return self._send(*_json(_pool_api_cached()))

        if self.path == "/api/pool/workers":
            return self._send(*_json(_pool_workers_api_cached()))

        if self.path == "/api/blocks":
            return self._send(*_json(_blocks_api()))

        if self.path.startswith("/api/timeseries/pool"):
            try:
                query = ""
                if "?" in self.path:
                    _, query = self.path.split("?", 1)
                trail = "30m"
                for part in query.split("&"):
                    if part.startswith("trail="):
                        trail = part.split("=", 1)[1]
                        break
                pts = POOL_SERIES.query(trail=trail, max_points=1000)
                return self._send(*_json({"trail": trail, "points": pts}))
            except Exception as e:
                return self._send(*_json({"error": str(e)}, status=500))

        if self.path == "/api/widget/sync":
            return self._send(*_json(_widget_sync()))

        if self.path == "/api/widget/pool":
            return self._send(*_json(_widget_pool()))

        status, body, ct = _read_static(self.path if self.path != "/" else "/index.html")
        return self._send(status, body, ct)

    def do_POST(self):
        length = int(self.headers.get("content-length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b""
        if not raw:
            body = {}
        else:
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                # Some proxies/browsers may send a classic form submission instead of JSON.
                # Accept urlencoded bodies as a fallback (e.g. payoutAddress=...).
                try:
                    parsed = parse_qs(raw.decode("utf-8", errors="replace"), keep_blank_values=True)
                    body = {k: (v[0] if len(v) == 1 else v) for k, v in parsed.items()}
                except Exception:
                    return self._send(*_json({"error": "invalid json"}, status=400))

        if self.path == "/api/settings":
            prev = _current_settings()
            network = str(body.get("network") or "").strip().lower()
            prune_raw = body.get("prune")
            txindex_raw = body.get("txindex")

            try:
                prune = int(prune_raw)
            except Exception:
                return self._send(*_json({"error": "invalid prune"}, status=400))

            if prune != 0 and prune < 550:
                return self._send(*_json({"error": "prune must be 0 or >= 550"}, status=400))

            txindex = 1 if bool(txindex_raw) else 0

            try:
                _update_node_conf(network=network, prune=prune, txindex=txindex)
            except Exception as e:
                return self._send(*_json({"error": str(e)}, status=400))

            reindex_required = False
            try:
                prev_prune = int(prev.get("prune") or 0)
            except Exception:
                prev_prune = 0
            if prev_prune > 0 and prune == 0:
                reindex_required = True
                _request_reindex_chainstate()

            return self._send(*_json({"ok": True, "restartRequired": True, "reindexRequired": reindex_required}))

        if self.path == "/api/pool/settings":
            print("DEBUG: /api/pool/settings HIT", flush=True)
            payout_address = str(body.get("payoutAddress") or "")
            mindiff = body.get("mindiff")
            startdiff = body.get("startdiff")
            maxdiff = body.get("maxdiff")

            try:
                settings = _update_pool_settings_full(
                     payout_address=payout_address,
                     mindiff=mindiff,
                     startdiff=startdiff,
                     maxdiff=maxdiff,
                )

                cfg = build_engine_config_from_pool({
                    "payoutAddress": payout_address,
                    "mindiff": mindiff,
                    "startdiff": startdiff,
                    "maxdiff": maxdiff
                })

                print("DEBUG: Writing engine config", flush=True)
                write_engine_config(cfg)

                return self._send(*_json({
                    "ok": True,
                    "settings": settings,
                    "restartRequired": True
                }))

            except Exception as e:
                return self._send(*_json({"error": str(e)}, status=400))

        if self.path == "/api/pool/bestshare/reset":
            try:
                addrs: list[str] = []
                try:
                    conf = _read_ckpool_conf()
                    a = str(conf.get("btcaddress") or "").strip()
                    if a:
                        addrs.append(a)
                except Exception:
                    pass
                try:
                    addrs.extend(_payout_history_addresses())
                except Exception:
                    pass
                return self._send(*_json(_reset_ckpool_bestshare(addrs)))
            except Exception as e:
                return self._send(*_json({"error": str(e)}, status=500))

        if self.path == "/api/pool/workers/bestshare/reset":
            try:
                worker = str(body.get("worker") or body.get("workername") or body.get("name") or "").strip()
                return self._send(*_json(_reset_since_block_tracker_for_worker(worker)))
            except Exception as e:
                return self._send(*_json({"error": str(e)}, status=400))

        if self.path == "/api/blocks/backscan":
            enabled_raw = body.get("enabled", None)
            rescan = bool(body.get("rescan")) or bool(body.get("rebuild"))
            reset = bool(body.get("reset")) or bool(body.get("resetAndRescan"))
            from_month = body.get("fromMonth") or body.get("from_month") or body.get("from")
            speed = str(body.get("speed") or "").strip().lower()
            max_blocks_raw = body.get("maxBlocks") if body.get("maxBlocks") is not None else body.get("max_blocks")
            interval_raw = body.get("intervalS") if body.get("intervalS") is not None else body.get("interval_s")
            now_s = int(time.time())

            blocks_state = _read_json_file(BLOCKS_STATE_PATH)
            scan = blocks_state.get("backscan") if isinstance(blocks_state.get("backscan"), dict) else {}
            if reset:
                blocks_state["events"] = []
                scan = {}

            # Manual-only scan settings.
            max_blocks = None
            interval_s = None
            try:
                if max_blocks_raw is not None and str(max_blocks_raw).strip() != "":
                    max_blocks = int(float(max_blocks_raw))
            except Exception:
                max_blocks = None
            try:
                if interval_raw is not None and str(interval_raw).strip() != "":
                    interval_s = int(float(interval_raw))
            except Exception:
                interval_s = None

            if speed in ["slow", "normal", "fast", "unlimited"]:
                if speed == "slow":
                    max_blocks = 25
                    interval_s = 10
                elif speed == "fast":
                    max_blocks = 500
                    interval_s = 0
                elif speed == "unlimited":
                    max_blocks = 2000
                    interval_s = 0
                else:
                    max_blocks = 100
                    interval_s = 2

            if max_blocks is not None:
                scan["maxBlocks"] = max(1, min(BACKSCAN_MAX_BLOCKS_CAP, int(max_blocks)))
            if interval_s is not None:
                scan["intervalS"] = max(0, min(3600, int(interval_s)))

            from_ts = _parse_month_yyyy_mm(from_month)
            if from_ts is not None:
                scan["fromMonth"] = str(from_month)
                scan["fromTs"] = int(from_ts)

            # Enabling with no pointers is treated as a start request.
            if enabled_raw is True and not (scan.get("startHeight") is not None and scan.get("nextHeight") is not None):
                rescan = True

            if rescan or bool(body.get("resetAndRescan")):
                # Start (or restart) an on-chain history scan. It stays OFF by default unless the user enables it.
                try:
                    tip_h = int(_rpc_call("getblockcount"))
                except Exception:
                    tip_h = None

                start_h = None
                if tip_h is not None:
                    if scan.get("fromTs"):
                        start_h = _estimate_start_height(tip_h=tip_h, from_ts=int(scan["fromTs"]), spacing_s=600, buffer_blocks=10)
                    else:
                        install_t = _install_time_s()
                        approx_blocks = max(0, int((now_s - int(install_t)) / 600))
                        start_h = max(0, tip_h - approx_blocks - 10)

                # Keep existing events by default; just restart scan pointers (unless reset).
                for k in [
                    "startHeight",
                    "nextHeight",
                    "tipHeightAtStart",
                    "tipHeightLast",
                    "startedAt",
                    "updatedAt",
                    "lastRunAt",
                    "complete",
                    "completedAt",
                    "stale",
                ]:
                    scan.pop(k, None)

                if tip_h is not None and start_h is not None:
                    scan["startHeight"] = int(start_h)
                    scan["nextHeight"] = int(start_h)
                    scan["tipHeightAtStart"] = int(tip_h)
                scan["enabled"] = True if enabled_raw is None else bool(enabled_raw)
                scan["complete"] = False
                scan["stale"] = False
                scan["requestedAt"] = now_s
                scan["startedAt"] = now_s
                scan["updatedAt"] = now_s

            if enabled_raw is not None and not rescan:
                scan["enabled"] = bool(enabled_raw)
                scan["updatedAt"] = now_s

            blocks_state["backscan"] = scan
            _write_json_file(BLOCKS_STATE_PATH, blocks_state)
            return self._send(*_json({"ok": True, "backscan": scan}))

        if self.path == "/api/support/ticket":
            if not SUPPORT_TICKET_URL:
                return self._send(*_json({"error": "support not configured"}, status=503))

            subject = str(body.get("subject") or "").strip()
            message = str(body.get("message") or "").strip()
            email = str(body.get("email") or "").strip()

            if len(subject) < 3 or len(subject) > 120:
                return self._send(*_json({"error": "subject must be 3-120 chars"}, status=400))
            if len(message) < 10 or len(message) > 8000:
                return self._send(*_json({"error": "message must be 10-8000 chars"}, status=400))
            if email and len(email) > 200:
                return self._send(*_json({"error": "email too long"}, status=400))

            payload = _support_ticket_payload(subject=subject, message=message, email=email or None)
            try:
                bundle, filename = _build_support_bundle_zip(payload)
                status, resp = _post_support_bundle(
                    SUPPORT_TICKET_URL, bundle_bytes=bundle, filename=filename, timeout_s=20
                )
                if int(status) >= 400:
                    return self._send(*_json({"error": "support server error"}, status=502))
                try:
                    data = json.loads(resp.decode("utf-8", errors="replace"))
                    ticket = data.get("ticket") if isinstance(data, dict) else None
                except Exception:
                    ticket = None
            except Exception:
                return self._send(*_json({"error": "support server unreachable"}, status=502))

            return self._send(*_json({"ok": True, "ticket": ticket}))

        return self._send(*_json({"error": "not found"}, status=404))


def main():
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    CKPOOL_STATUS_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    POOL_SERIES.load()
    _ensure_since_block_tracker_initialized()
    _pool_cache_load()
    _pool_workers_cache_load()

    global INSTALL_ID
    INSTALL_ID = _get_or_create_install_id()

    stop_event = threading.Event()
    t = threading.Thread(target=_series_sampler, args=(stop_event,), daemon=True)
    t.start()

    t_pool = threading.Thread(target=_pool_cache_worker, args=(stop_event,), daemon=True)
    t_pool.start()

    t_pool_workers = threading.Thread(target=_pool_workers_cache_worker, args=(stop_event,), daemon=True)
    t_pool_workers.start()

    t_backscan = threading.Thread(target=_backscan_worker, args=(stop_event,), daemon=True)
    t_backscan.start()

    t2 = threading.Thread(target=_support_checkin_loop, args=(stop_event,), daemon=True)
    t2.start()

    ThreadingHTTPServer(("0.0.0.0", 3000), Handler).serve_forever()


if __name__ == "__main__":
    main()

