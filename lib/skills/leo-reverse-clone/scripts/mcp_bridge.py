#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "httpx>=0.27.0,<1",
# ]
# ///
"""Headless persistent MCP Bridge for leo-reverse-clone (rea-agents & craft-anything-cli).

Acts as a local MCP client without registering anything into global Agent MCP configs:
  - `rea`: launches & reuses native `rea mcp --http` Streamable HTTP daemon + Mcp-Session-Id
  - `craft`: launches & reuses a loopback authenticated Broker holding `craft-anything-cli mcp` stdio pipe

Subcommands:
  status [rea|craft|all]
  start <rea|craft> [--deep|--clean-room] [--all-tools] [--idle-timeout 1800] [--server-cmd '<json-argv>']
  stop [rea|craft|all]
  tools <rea|craft> [--query <kw>] [--format json|markdown]
  enable-toolset craft <toolset>
  call <rea|craft> <tool_name> ['<json>' | --args-file <path>] [--save-json <path>] [--max-chars 12000] [--timeout 180]
  resources <rea|craft>
  read-resource <rea|craft> <uri> [--save-json <path>] [--max-chars 12000]

Exit codes: 0 ok, 1 RPC/tool error, 2 daemon/setup error, 3 bad usage.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import httpx

PROTOCOL_VERSION = "2025-06-18"
CLIENT_INFO = {"name": "leo-reverse-clone-bridge", "version": "1.0.0"}
DEFAULT_IDLE_TIMEOUT = 1800
DEFAULT_MAX_CHARS = 12000


def get_config_path() -> Path:
    override = os.environ.get("LEO_REVERSE_CLONE_CONFIG_PATH")
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / ".shrimp" / "skills" / "leo-reverse-clone" / "config.json"


def get_runtime_dir() -> Path:
    override = os.environ.get("LEO_REVERSE_CLONE_RUNTIME_DIR")
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / ".shrimp" / "skills" / "leo-reverse-clone" / "runtime"


def read_skill_config() -> dict[str, Any]:
    cfg_path = get_config_path()
    if not cfg_path.is_file():
        return {}
    try:
        return json.loads(cfg_path.read_text(encoding="utf-8-sig"))
    except Exception:
        return {}


def normalize_engine(raw: str) -> str:
    val = (raw or "").strip().lower()
    if val in {"rea", "rea-agents"}:
        return "rea"
    if val in {"craft", "craft-anything", "craft-anything-cli"}:
        return "craft"
    if val == "all":
        return "all"
    raise ValueError(f"不支持的引擎名: {raw}（可选: rea | craft）")


def normalize_proxy_string(raw: str | None) -> str:
    if not raw:
        return ""
    trimmed = raw.strip()
    if not trimmed or trimmed.lower() in {"direct", "none", "off", "false"}:
        return ""
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", trimmed):
        return trimmed
    return f"http://{trimmed}"


def parse_scutil_proxy_output(text: str) -> str:
    def _val(key: str) -> str:
        m = re.search(rf"^\s*{re.escape(key)}\s*:\s*(.+?)\s*$", text, re.MULTILINE)
        return m.group(1).strip() if m else ""

    if _val("HTTPSEnable") == "1" and _val("HTTPSProxy") and _val("HTTPSPort"):
        return f"http://{_val('HTTPSProxy')}:{_val('HTTPSPort')}"
    if _val("HTTPEnable") == "1" and _val("HTTPProxy") and _val("HTTPPort"):
        return f"http://{_val('HTTPProxy')}:{_val('HTTPPort')}"
    if _val("SOCKSEnable") == "1" and _val("SOCKSProxy") and _val("SOCKSPort"):
        return f"socks5://{_val('SOCKSProxy')}:{_val('SOCKSPort')}"
    return ""


def parse_windows_reg_proxy_output(text: str) -> str:
    m_en = re.search(r"ProxyEnable\s+REG_DWORD\s+(0x[0-9a-fA-F]+|\d+)", text, re.IGNORECASE)
    if not m_en or int(m_en.group(1), 0) == 0:
        return ""
    m_srv = re.search(r"ProxyServer\s+REG_SZ\s+([^\r\n]+)", text, re.IGNORECASE)
    if not m_srv:
        return ""
    raw = m_srv.group(1).strip()
    if not raw:
        return ""
    if "=" in raw:
        entries: dict[str, str] = {}
        for part in raw.split(";"):
            part = part.strip()
            if "=" in part:
                k, v = part.split("=", 1)
                entries[k.strip().lower()] = v.strip()
        chosen = entries.get("https") or entries.get("http") or entries.get("socks") or ""
        if not chosen:
            return ""
        if entries.get("socks") == chosen and "://" not in chosen:
            return f"socks5://{chosen}"
        return normalize_proxy_string(chosen)
    return normalize_proxy_string(raw)


def detect_system_proxy() -> str:
    try:
        if sys.platform == "darwin":
            out = subprocess.check_output(["scutil", "--proxy"], text=True, stderr=subprocess.DEVNULL, timeout=2)
            return parse_scutil_proxy_output(out)
        if os.name == "nt":
            out = subprocess.check_output(
                ["reg", "query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings"],
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=2,
            )
            return parse_windows_reg_proxy_output(out)
    except Exception:
        return ""
    return ""


def append_loopback_no_proxy(raw: str = "") -> str:
    items = [s.strip() for s in (raw or "").split(",") if s.strip()]
    lower_set = {x.lower() for x in items}
    for host in ("127.0.0.1", "localhost", "::1"):
        if host not in lower_set:
            items.append(host)
    return ",".join(items)


def resolve_proxy_info(env: dict[str, str] | None = None, config_proxy: str | None = None) -> dict[str, str]:
    source_env = env if env is not None else os.environ
    cfg_val = (config_proxy or "").strip()
    if cfg_val:
        if cfg_val.lower() in {"direct", "none", "off", "false"}:
            return {"url": "", "source": "config-disabled"}
        return {"url": normalize_proxy_string(cfg_val), "source": "config"}
    for key in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
        val = (source_env.get(key) or "").strip()
        if val:
            return {"url": normalize_proxy_string(val), "source": "env"}
    sys_val = detect_system_proxy()
    if sys_val:
        return {"url": normalize_proxy_string(sys_val), "source": "system"}
    return {"url": "", "source": "direct"}


def get_augmented_env() -> dict[str, str]:
    env = dict(os.environ)
    home = Path.home()
    extra = [
        str(home / ".local" / "bin"),
        str(home / ".cargo" / "bin"),
        str(home / ".npm-global" / "bin"),
    ]
    current = env.get("PATH", "")
    env["PATH"] = os.pathsep.join([*extra, current]) if current else os.pathsep.join(extra)

    cfg = read_skill_config()
    proxy_info = resolve_proxy_info(env=env, config_proxy=cfg.get("proxy"))
    no_proxy = append_loopback_no_proxy(env.get("NO_PROXY") or env.get("no_proxy") or "")
    env["NO_PROXY"] = no_proxy
    env["no_proxy"] = no_proxy

    proxy_url = proxy_info["url"]
    if not proxy_url:
        if proxy_info["source"] == "config-disabled":
            for k in ("HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"):
                env.pop(k, None)
    elif proxy_url.lower().startswith("socks"):
        env["ALL_PROXY"] = proxy_url
        env["all_proxy"] = proxy_url
    else:
        env["HTTP_PROXY"] = proxy_url
        env["http_proxy"] = proxy_url
        env["HTTPS_PROXY"] = proxy_url
        env["https_proxy"] = proxy_url
    return env


def find_executable(name: str, env: dict[str, str]) -> str | None:
    if not name:
        return None
    p = Path(name).expanduser()
    if p.is_absolute() or os.sep in name or "/" in name:
        return str(p.resolve()) if p.is_file() else None
    return shutil.which(name, path=env.get("PATH"))


def state_file_for(engine: str) -> Path:
    return get_runtime_dir() / f"{engine}.json"


def write_json_atomic(path: Path, data: dict[str, Any], private: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.{secrets.token_hex(4)}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if private and os.name != "nt":
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
    tmp.replace(path)


def read_state(engine: str) -> dict[str, Any] | None:
    sf = state_file_for(engine)
    if not sf.is_file():
        return None
    try:
        return json.loads(sf.read_text(encoding="utf-8"))
    except Exception:
        return None


def clear_state(engine: str) -> None:
    sf = state_file_for(engine)
    try:
        sf.unlink(missing_ok=True)
    except OSError:
        pass


def is_pid_alive(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    if os.name == "nt":
        try:
            out = subprocess.check_output(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=3,
            )
            return str(pid) in out
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def terminate_pid(pid: int | None, wait_secs: float = 3.0) -> None:
    if not pid or pid <= 0 or not is_pid_alive(pid):
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return
    deadline = time.monotonic() + wait_secs
    while time.monotonic() < deadline:
        if not is_pid_alive(pid):
            return
        time.sleep(0.1)
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass


def detached_popen_kwargs() -> dict[str, Any]:
    if os.name == "nt":
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
        return {"creationflags": flags}
    return {"start_new_session": True}


# ---------------------------------------------------------------------------
# Streamable HTTP MCP client helpers (REA)
# ---------------------------------------------------------------------------


def parse_streamable_http_response(resp: httpx.Response, expected_id: int | str | None = None) -> dict[str, Any]:
    ctype = (resp.headers.get("content-type") or "").lower()
    if "text/event-stream" in ctype:
        messages: list[dict[str, Any]] = []
        data_lines: list[str] = []
        for raw_line in resp.text.splitlines():
            line = raw_line.strip()
            if not line:
                if data_lines:
                    payload = "\n".join(data_lines)
                    data_lines.clear()
                    try:
                        parsed = json.loads(payload)
                        if isinstance(parsed, dict):
                            messages.append(parsed)
                    except json.JSONDecodeError:
                        pass
                continue
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if data_lines:
            try:
                parsed = json.loads("\n".join(data_lines))
                if isinstance(parsed, dict):
                    messages.append(parsed)
            except json.JSONDecodeError:
                pass
        if expected_id is not None:
            for msg in messages:
                if msg.get("id") == expected_id:
                    return msg
        if messages:
            return messages[-1]
        raise RuntimeError(f"SSE 响应中未找到有效 JSON-RPC 消息（HTTP {resp.status_code}）")

    if not resp.text.strip():
        return {}
    return resp.json()


def rea_build_command(server_cmd: list[str] | None = None) -> list[str]:
    if server_cmd:
        return list(server_cmd)
    env = get_augmented_env()
    cfg = read_skill_config()
    rea_bin = find_executable(cfg.get("rea_bin") or "", env) or find_executable("rea", env) or find_executable("rea-agents", env)
    if rea_bin:
        return [rea_bin, "mcp", "--http", "--host", "127.0.0.1", "--port", "0"]
    npx = find_executable("npx", env)
    if npx:
        return [npx, "-y", "rea-agents@latest", "mcp", "--http", "--host", "127.0.0.1", "--port", "0"]
    raise RuntimeError("未找到 rea / rea-agents 或 npx，请先运行 `node scripts/install.mjs --engine rea --yes`。")


def rea_initialize_session(url: str, timeout: float = 30.0) -> str:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    init_body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": CLIENT_INFO,
        },
    }
    with httpx.Client(timeout=timeout, trust_env=False) as client:
        resp = client.post(url, headers=headers, json=init_body)
        if resp.status_code >= 400:
            raise RuntimeError(f"REA initialize 失败 (HTTP {resp.status_code}): {resp.text[:500]}")
        session_id = resp.headers.get("mcp-session-id") or resp.headers.get("Mcp-Session-Id") or ""
        rpc = parse_streamable_http_response(resp, expected_id=1)
        if "error" in rpc:
            raise RuntimeError(f"REA initialize 返回错误: {rpc['error']}")

        notif_headers = dict(headers)
        if session_id:
            notif_headers["Mcp-Session-Id"] = session_id
        notif_body = {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}
        client.post(url, headers=notif_headers, json=notif_body)
        return session_id


def rea_health_check(state: dict[str, Any]) -> bool:
    if not state or not is_pid_alive(state.get("pid")):
        return False
    url = state.get("url")
    if not url:
        return False
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if state.get("session_id"):
        headers["Mcp-Session-Id"] = state["session_id"]
    try:
        with httpx.Client(timeout=4.0, trust_env=False) as client:
            resp = client.post(url, headers=headers, json={"jsonrpc": "2.0", "id": 0, "method": "ping", "params": {}})
            return resp.status_code in (200, 202)
    except Exception:
        return False


def ensure_rea_daemon(server_cmd: list[str] | None = None, startup_timeout: float | None = None) -> dict[str, Any]:
    existing = read_state("rea")
    if existing and is_pid_alive(existing.get("pid")) and existing.get("url"):
        if rea_health_check(existing):
            return existing
        try:
            session_id = rea_initialize_session(existing["url"], timeout=15.0)
            existing["session_id"] = session_id
            write_json_atomic(state_file_for("rea"), existing)
            return existing
        except Exception:
            terminate_pid(existing.get("pid"))
            clear_state("rea")

    cmd = rea_build_command(server_cmd)
    if startup_timeout is None:
        is_npx = Path(cmd[0]).name.lower() in {"npx", "npx.cmd"}
        startup_timeout = 120.0 if is_npx else 45.0
    rt = get_runtime_dir()
    rt.mkdir(parents=True, exist_ok=True)
    log_path = rt / "rea.stderr.log"
    log_file = open(log_path, "wb")
    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=log_file,
            env=get_augmented_env(),
            **detached_popen_kwargs(),
        )
    finally:
        log_file.close()

    url: str | None = None
    deadline = time.monotonic() + startup_timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            err_tail = log_path.read_text(encoding="utf-8", errors="replace")[-2000:]
            raise RuntimeError(f"REA MCP 启动失败（退出码 {proc.returncode}）:\n{err_tail}")
        if log_path.is_file():
            for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(obj, dict) and obj.get("url") and (
                    "listening" in str(obj.get("msg", "")).lower() or str(obj.get("url", "")).startswith("http://")
                ):
                    url = str(obj["url"])
                    break
        if url:
            break
        time.sleep(0.15)

    if not url:
        terminate_pid(proc.pid)
        err_tail = log_path.read_text(encoding="utf-8", errors="replace")[-2000:] if log_path.is_file() else ""
        raise RuntimeError(f"等待 REA HTTP MCP 监听地址超时（{startup_timeout}s）。stderr:\n{err_tail}")

    session_id = rea_initialize_session(url, timeout=20.0)
    state = {
        "engine": "rea",
        "transport": "streamable-http",
        "pid": proc.pid,
        "url": url,
        "session_id": session_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "log": str(log_path),
    }
    write_json_atomic(state_file_for("rea"), state)
    return state


def rea_rpc(method: str, params: dict[str, Any] | None = None, timeout: float = 180.0, server_cmd: list[str] | None = None) -> dict[str, Any]:
    state = ensure_rea_daemon(server_cmd=server_cmd)
    req_id = int(time.time() * 1000) % 1_000_000_000 + 10
    body = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}

    def _send(session_id: str) -> httpx.Response:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if session_id:
            headers["Mcp-Session-Id"] = session_id
        with httpx.Client(timeout=timeout, trust_env=False) as client:
            return client.post(state["url"], headers=headers, json=body)

    resp = _send(state.get("session_id", ""))
    if resp.status_code in (400, 404):
        new_sid = rea_initialize_session(state["url"], timeout=20.0)
        state["session_id"] = new_sid
        write_json_atomic(state_file_for("rea"), state)
        resp = _send(new_sid)

    if resp.status_code >= 400:
        raise RuntimeError(f"REA MCP 请求失败 (HTTP {resp.status_code}): {resp.text[:1000]}")
    return parse_streamable_http_response(resp, expected_id=req_id)


def stop_rea() -> dict[str, Any]:
    state = read_state("rea")
    if not state:
        return {"engine": "rea", "stopped": False, "reason": "not_running"}
    if state.get("url") and state.get("session_id"):
        try:
            with httpx.Client(timeout=3.0, trust_env=False) as client:
                client.delete(state["url"], headers={"Mcp-Session-Id": state["session_id"]})
        except Exception:
            pass
    terminate_pid(state.get("pid"))
    clear_state("rea")
    return {"engine": "rea", "stopped": True, "pid": state.get("pid")}


# ---------------------------------------------------------------------------
# Persistent Stdio Loopback Broker (Craft Anything)
# ---------------------------------------------------------------------------


def craft_build_command(
    mode: str = "deep",
    all_tools: bool = False,
    server_cmd: list[str] | None = None,
) -> list[str]:
    if server_cmd:
        return list(server_cmd)
    env = get_augmented_env()
    cfg = read_skill_config()
    craft_bin = find_executable(cfg.get("craft_bin") or "", env) or find_executable("craft-anything-cli", env)
    if not craft_bin:
        raise RuntimeError(
            "未找到 craft-anything-cli，请先运行 `node scripts/install.mjs --engine craft-anything --yes`（免编译下载纯 CLI，无需 .dmg）。"
        )
    cmd = [craft_bin]
    if mode == "clean_room":
        cmd.append("--clean-room")
    else:
        cmd.append("--deep")
    cmd.append("mcp")
    if all_tools:
        cmd.append("--all-tools")
    return cmd


class StdioMcpProxy:
    """Thread-safe JSON-RPC 2.0 client holding one persistent stdio MCP subprocess."""

    def __init__(self, cmd: list[str], stderr_log: Path) -> None:
        self.cmd = cmd
        self.stderr_log = stderr_log
        self._lock = threading.Lock()
        self._pending: dict[int, queue.Queue[dict[str, Any]]] = {}
        self._next_id = 1
        self._closed = False
        self.last_activity = time.monotonic()

        stderr_log.parent.mkdir(parents=True, exist_ok=True)
        self._stderr_file = open(stderr_log, "wb")
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._stderr_file,
            env=get_augmented_env(),
            bufsize=0,
        )
        self._reader_thread = threading.Thread(target=self._read_loop, name="stdio-mcp-reader", daemon=True)
        self._reader_thread.start()

    def _read_loop(self) -> None:
        assert self.proc.stdout is not None
        try:
            for raw in self.proc.stdout:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(msg, dict) and "id" in msg and msg["id"] is not None:
                    req_id = msg["id"]
                    with self._lock:
                        q = self._pending.get(req_id)
                    if q is not None:
                        q.put(msg)
        finally:
            self._fail_all("底层 stdio MCP 进程已退出")

    def _fail_all(self, reason: str) -> None:
        with self._lock:
            self._closed = True
            for q in self._pending.values():
                q.put({"jsonrpc": "2.0", "error": {"code": -32000, "message": reason}})
            self._pending.clear()

    def is_alive(self) -> bool:
        return not self._closed and self.proc.poll() is None

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        payload = json.dumps({"jsonrpc": "2.0", "method": method, "params": params or {}}, ensure_ascii=False) + "\n"
        with self._lock:
            if not self.is_alive() or self.proc.stdin is None:
                raise RuntimeError("底层 stdio MCP 进程未运行")
            self.proc.stdin.write(payload.encode("utf-8"))
            self.proc.stdin.flush()
            self.last_activity = time.monotonic()

    def request(self, method: str, params: dict[str, Any] | None = None, timeout: float = 180.0) -> dict[str, Any]:
        q: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
        with self._lock:
            if not self.is_alive() or self.proc.stdin is None:
                raise RuntimeError("底层 stdio MCP 进程已停止")
            req_id = self._next_id
            self._next_id += 1
            self._pending[req_id] = q
            payload = json.dumps(
                {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}},
                ensure_ascii=False,
            ) + "\n"
            self.proc.stdin.write(payload.encode("utf-8"))
            self.proc.stdin.flush()
            self.last_activity = time.monotonic()

        try:
            resp = q.get(timeout=timeout)
            self.last_activity = time.monotonic()
            return resp
        except queue.Empty as exc:
            raise TimeoutError(f"stdio MCP 调用 `{method}` 超时（{timeout}s）") from exc
        finally:
            with self._lock:
                self._pending.pop(req_id, None)

    def initialize(self) -> dict[str, Any]:
        resp = self.request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": CLIENT_INFO,
            },
            timeout=30.0,
        )
        if "error" in resp:
            raise RuntimeError(f"craft MCP initialize 失败: {resp['error']}")
        self.notify("notifications/initialized", {})
        return resp

    def close(self) -> None:
        self._closed = True
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except Exception:
            pass
        if self.proc.poll() is None:
            terminate_pid(self.proc.pid, wait_secs=2.0)
        try:
            self._stderr_file.close()
        except Exception:
            pass


def run_craft_broker(
    mode: str,
    all_tools: bool,
    idle_timeout: int,
    server_cmd: list[str] | None,
) -> int:
    rt = get_runtime_dir()
    rt.mkdir(parents=True, exist_ok=True)
    stderr_log = rt / "craft.stderr.log"
    cmd = craft_build_command(mode=mode, all_tools=all_tools, server_cmd=server_cmd)
    proxy = StdioMcpProxy(cmd, stderr_log)
    init_resp = proxy.initialize()

    token = secrets.token_hex(32)
    stop_event = threading.Event()

    class BrokerHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            return

        def _authorized(self) -> bool:
            return secrets.compare_digest(self.headers.get("X-Bridge-Token", ""), token)

        def _send_json(self, code: int, obj: dict[str, Any]) -> None:
            raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self) -> None:
            if not self._authorized():
                self._send_json(403, {"error": "forbidden"})
                return
            if self.path == "/health":
                self._send_json(
                    200,
                    {
                        "ok": proxy.is_alive(),
                        "engine": "craft",
                        "mode": mode,
                        "pid": os.getpid(),
                        "child_pid": proxy.proc.pid,
                        "idle_secs": round(time.monotonic() - proxy.last_activity, 1),
                    },
                )
                return
            self._send_json(404, {"error": "not_found"})

        def do_POST(self) -> None:
            if not self._authorized():
                self._send_json(403, {"error": "forbidden"})
                return
            length = int(self.headers.get("Content-Length") or "0")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            if self.path == "/shutdown":
                self._send_json(200, {"ok": True})
                stop_event.set()
                threading.Thread(target=httpd.shutdown, daemon=True).start()
                return
            if self.path == "/rpc":
                try:
                    req = json.loads(raw.decode("utf-8"))
                    method = str(req["method"])
                    params = req.get("params") or {}
                    timeout = float(req.get("timeout") or 180.0)
                    rpc_resp = proxy.request(method, params, timeout=timeout)
                    self._send_json(200, rpc_resp)
                except Exception as exc:
                    self._send_json(500, {"jsonrpc": "2.0", "error": {"code": -32000, "message": str(exc)}})
                return
            self._send_json(404, {"error": "not_found"})

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), BrokerHandler)
    port = httpd.server_address[1]
    state = {
        "engine": "craft",
        "transport": "stdio-broker",
        "mode": mode,
        "all_tools": all_tools,
        "pid": os.getpid(),
        "child_pid": proxy.proc.pid,
        "url": f"http://127.0.0.1:{port}",
        "token": token,
        "server_info": (init_resp.get("result") or {}).get("serverInfo"),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "log": str(stderr_log),
    }
    write_json_atomic(state_file_for("craft"), state)

    def _watchdog() -> None:
        while not stop_event.wait(2.0):
            if not proxy.is_alive():
                stop_event.set()
                httpd.shutdown()
                return
            if idle_timeout > 0 and (time.monotonic() - proxy.last_activity) > idle_timeout:
                stop_event.set()
                httpd.shutdown()
                return

    def _handle_sig(_signum: int, _frame: Any) -> None:
        stop_event.set()
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, _handle_sig)
    signal.signal(signal.SIGINT, _handle_sig)
    threading.Thread(target=_watchdog, daemon=True).start()

    try:
        httpd.serve_forever(poll_interval=0.5)
    finally:
        httpd.server_close()
        proxy.close()
        cur = read_state("craft")
        if cur and cur.get("pid") == os.getpid():
            clear_state("craft")
    return 0


def craft_health_check(state: dict[str, Any]) -> bool:
    if not state or not is_pid_alive(state.get("pid")):
        return False
    url = state.get("url")
    token = state.get("token")
    if not url or not token:
        return False
    try:
        with httpx.Client(timeout=3.0, trust_env=False) as client:
            resp = client.get(f"{url}/health", headers={"X-Bridge-Token": token})
            return resp.status_code == 200 and bool(resp.json().get("ok"))
    except Exception:
        return False


def ensure_craft_daemon(
    mode: str | None = None,
    all_tools: bool = False,
    idle_timeout: int | None = None,
    server_cmd: list[str] | None = None,
    startup_timeout: float = 25.0,
) -> dict[str, Any]:
    cfg = read_skill_config()
    want_mode = mode or cfg.get("default_mode") or "deep"
    want_idle = idle_timeout if idle_timeout is not None else int(cfg.get("idle_timeout_secs") or DEFAULT_IDLE_TIMEOUT)

    existing = read_state("craft")
    if existing and craft_health_check(existing):
        if mode is None or existing.get("mode") == want_mode:
            return existing
        stop_craft()

    if existing:
        terminate_pid(existing.get("pid"))
        clear_state("craft")

    # Pre-validate command before spawning detached broker so errors are clear & immediate
    craft_build_command(mode=want_mode, all_tools=all_tools, server_cmd=server_cmd)

    rt = get_runtime_dir()
    rt.mkdir(parents=True, exist_ok=True)
    broker_log = rt / "craft.broker.log"
    broker_cmd = [
        sys.executable,
        str(Path(__file__).resolve()),
        "_broker",
        "--mode",
        want_mode,
        "--idle-timeout",
        str(want_idle),
    ]
    if all_tools:
        broker_cmd.append("--all-tools")
    if server_cmd:
        broker_cmd.extend(["--server-cmd", json.dumps(server_cmd)])

    log_file = open(broker_log, "wb")
    try:
        proc = subprocess.Popen(
            broker_cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=log_file,
            env=get_augmented_env(),
            **detached_popen_kwargs(),
        )
    finally:
        log_file.close()

    deadline = time.monotonic() + startup_timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            err_tail = broker_log.read_text(encoding="utf-8", errors="replace")[-2000:]
            raise RuntimeError(f"Craft MCP Broker 启动失败（退出码 {proc.returncode}）:\n{err_tail}")
        st = read_state("craft")
        if st and st.get("pid") == proc.pid and craft_health_check(st):
            return st
        time.sleep(0.15)

    terminate_pid(proc.pid)
    err_tail = broker_log.read_text(encoding="utf-8", errors="replace")[-2000:] if broker_log.is_file() else ""
    raise RuntimeError(f"等待 Craft MCP Broker 就绪超时（{startup_timeout}s）。log:\n{err_tail}")


def craft_rpc(
    method: str,
    params: dict[str, Any] | None = None,
    timeout: float = 180.0,
    mode: str | None = None,
    all_tools: bool = False,
    server_cmd: list[str] | None = None,
) -> dict[str, Any]:
    state = ensure_craft_daemon(mode=mode, all_tools=all_tools, server_cmd=server_cmd)
    with httpx.Client(timeout=timeout + 5.0, trust_env=False) as client:
        resp = client.post(
            f"{state['url']}/rpc",
            headers={"X-Bridge-Token": state["token"]},
            json={"method": method, "params": params or {}, "timeout": timeout},
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Craft Broker 请求失败 (HTTP {resp.status_code}): {resp.text[:1000]}")
        return resp.json()


def stop_craft() -> dict[str, Any]:
    state = read_state("craft")
    if not state:
        return {"engine": "craft", "stopped": False, "reason": "not_running"}
    if state.get("url") and state.get("token"):
        try:
            with httpx.Client(timeout=3.0, trust_env=False) as client:
                client.post(f"{state['url']}/shutdown", headers={"X-Bridge-Token": state["token"]})
        except Exception:
            pass
    terminate_pid(state.get("pid"), wait_secs=2.0)
    terminate_pid(state.get("child_pid"), wait_secs=1.0)
    clear_state("craft")
    return {"engine": "craft", "stopped": True, "pid": state.get("pid")}


# ---------------------------------------------------------------------------
# Unified CLI commands
# ---------------------------------------------------------------------------


def dispatch_rpc(
    engine: str,
    method: str,
    params: dict[str, Any] | None = None,
    timeout: float = 180.0,
    mode: str | None = None,
    all_tools: bool = False,
    server_cmd: list[str] | None = None,
) -> dict[str, Any]:
    if engine == "rea":
        return rea_rpc(method, params, timeout=timeout, server_cmd=server_cmd)
    if engine == "craft":
        return craft_rpc(method, params, timeout=timeout, mode=mode, all_tools=all_tools, server_cmd=server_cmd)
    raise ValueError(f"不支持的引擎: {engine}")


def emit_bounded_output(
    engine: str,
    label: str,
    payload: Any,
    save_json: str | None = None,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> None:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    saved_path: Path | None = None
    if save_json:
        saved_path = Path(save_json).expanduser().resolve()
        saved_path.parent.mkdir(parents=True, exist_ok=True)
        saved_path.write_text(rendered, encoding="utf-8")

    if max_chars > 0 and len(rendered) > max_chars:
        if saved_path is None:
            out_dir = get_runtime_dir() / "outputs"
            out_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            safe_label = "".join(c if c.isalnum() or c in "-_" else "_" for c in label)[:48]
            saved_path = out_dir / f"{engine}_{safe_label}_{ts}.json"
            saved_path.write_text(rendered, encoding="utf-8")
        summary = {
            "truncated": True,
            "total_chars": len(rendered),
            "max_chars": max_chars,
            "saved_to": str(saved_path),
            "note": "完整 MCP 响应已自动落盘保存，避免撑爆上下文；请按需分段读取 saved_to 或改用分页/摘要参数。",
            "preview": rendered[: min(max_chars, 3000)],
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    print(rendered)


def format_tools_markdown(engine: str, tools: list[dict[str, Any]]) -> str:
    lines = [f"### `{engine}` 可用 MCP 工具（共 {len(tools)} 个）", ""]
    for t in tools:
        name = t.get("name", "")
        desc = str(t.get("description") or t.get("title") or "").strip().splitlines()[0] if (t.get("description") or t.get("title")) else ""
        if len(desc) > 140:
            desc = desc[:137] + "..."
        lines.append(f"- `{name}`: {desc}")
    return "\n".join(lines)


def parse_server_cmd(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    val = json.loads(raw)
    if not isinstance(val, list) or not all(isinstance(x, str) for x in val):
        raise ValueError("--server-cmd 必须是 JSON 字符串数组")
    return val


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="leo-reverse-clone 无头常驻 MCP 桥接客户端")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp_status = sub.add_parser("status", help="查看常驻 MCP 守护进程状态")
    sp_status.add_argument("engine", nargs="?", default="all", help="rea | craft | all")

    sp_start = sub.add_parser("start", help="启动或复用常驻 MCP 守护进程")
    sp_start.add_argument("engine", help="rea | craft")
    sp_start.add_argument("--deep", action="store_true", help="craft 引擎使用 Deep 模式（默认）")
    sp_start.add_argument("--clean-room", action="store_true", help="craft 引擎使用 Clean room 净室模式")
    sp_start.add_argument("--all-tools", action="store_true", help="craft 引擎一次性列出全部工具集")
    sp_start.add_argument("--idle-timeout", type=int, default=None, help="craft Broker 闲置自动退出秒数")
    sp_start.add_argument("--server-cmd", default=None, help="自定义服务端启动命令 JSON 数组（测试/高级用途）")

    sp_stop = sub.add_parser("stop", help="停止常驻 MCP 守护进程")
    sp_stop.add_argument("engine", nargs="?", default="all", help="rea | craft | all")

    sp_tools = sub.add_parser("tools", help="列出当前 MCP 会话暴露的工具")
    sp_tools.add_argument("engine", help="rea | craft")
    sp_tools.add_argument("--query", default="", help="按关键词过滤工具名与描述")
    sp_tools.add_argument("--format", choices=["json", "markdown"], default="markdown")
    sp_tools.add_argument("--server-cmd", default=None)

    sp_en = sub.add_parser("enable-toolset", help="快捷开启 craft-anything 的指定工具集")
    sp_en.add_argument("engine", choices=["craft", "craft-anything"])
    sp_en.add_argument("toolset", help="如 android / native / browser / javascript / formats / all")

    sp_call = sub.add_parser("call", help="调用指定 MCP 工具（复用常驻会话）")
    sp_call.add_argument("engine", help="rea | craft")
    sp_call.add_argument("tool_name", help="MCP 工具名称")
    sp_call.add_argument("args_json", nargs="?", default="{}", help="工具参数 JSON 字符串")
    sp_call.add_argument("--args-file", default=None, help="从 JSON 文件读取工具参数")
    sp_call.add_argument("--save-json", default=None, help="将完整 JSON 响应保存至指定路径")
    sp_call.add_argument("--max-chars", type=int, default=DEFAULT_MAX_CHARS, help="终端最大输出字符数，超限自动落盘")
    sp_call.add_argument("--timeout", type=float, default=180.0, help="单次调用超时秒数")
    sp_call.add_argument("--server-cmd", default=None)

    sp_res = sub.add_parser("resources", help="列出当前 MCP 会话保留的资源")
    sp_res.add_argument("engine", help="rea | craft")
    sp_res.add_argument("--server-cmd", default=None)

    sp_read = sub.add_parser("read-resource", help="读取指定 MCP 资源 URI（如 evidence://...）")
    sp_read.add_argument("engine", help="rea | craft")
    sp_read.add_argument("uri", help="资源 URI")
    sp_read.add_argument("--save-json", default=None)
    sp_read.add_argument("--max-chars", type=int, default=DEFAULT_MAX_CHARS)
    sp_read.add_argument("--server-cmd", default=None)

    sp_broker = sub.add_parser("_broker", help=argparse.SUPPRESS)
    sp_broker.add_argument("--mode", default="deep")
    sp_broker.add_argument("--all-tools", action="store_true")
    sp_broker.add_argument("--idle-timeout", type=int, default=DEFAULT_IDLE_TIMEOUT)
    sp_broker.add_argument("--server-cmd", default=None)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.cmd == "_broker":
        return run_craft_broker(
            mode=args.mode,
            all_tools=args.all_tools,
            idle_timeout=args.idle_timeout,
            server_cmd=parse_server_cmd(args.server_cmd),
        )

    try:
        if args.cmd == "status":
            eng = normalize_engine(args.engine)
            targets = ["rea", "craft"] if eng == "all" else [eng]
            out: dict[str, Any] = {}
            for t in targets:
                st = read_state(t)
                alive = rea_health_check(st) if t == "rea" else craft_health_check(st)
                out[t] = {
                    "running": bool(alive),
                    "pid": st.get("pid") if st else None,
                    "transport": st.get("transport") if st else None,
                    "url": st.get("url") if st else None,
                    "mode": st.get("mode") if st else None,
                    "started_at": st.get("started_at") if st else None,
                }
            print(json.dumps(out, ensure_ascii=False, indent=2))
            return 0

        if args.cmd == "start":
            eng = normalize_engine(args.engine)
            server_cmd = parse_server_cmd(args.server_cmd)
            if eng == "rea":
                st = ensure_rea_daemon(server_cmd=server_cmd)
            elif eng == "craft":
                mode = "clean_room" if args.clean_room else ("deep" if args.deep else None)
                st = ensure_craft_daemon(
                    mode=mode,
                    all_tools=args.all_tools,
                    idle_timeout=args.idle_timeout,
                    server_cmd=server_cmd,
                )
            else:
                raise ValueError("start 仅支持 rea 或 craft")
            safe_st = {k: v for k, v in st.items() if k != "token"}
            print(json.dumps(safe_st, ensure_ascii=False, indent=2))
            return 0

        if args.cmd == "stop":
            eng = normalize_engine(args.engine)
            targets = ["rea", "craft"] if eng == "all" else [eng]
            out = {t: (stop_rea() if t == "rea" else stop_craft()) for t in targets}
            print(json.dumps(out, ensure_ascii=False, indent=2))
            return 0

        if args.cmd == "tools":
            eng = normalize_engine(args.engine)
            resp = dispatch_rpc(eng, "tools/list", {}, server_cmd=parse_server_cmd(args.server_cmd))
            if "error" in resp:
                print(json.dumps(resp, ensure_ascii=False, indent=2), file=sys.stderr)
                return 1
            tools = list((resp.get("result") or {}).get("tools") or [])
            q = (args.query or "").strip().lower()
            if q:
                tools = [
                    t
                    for t in tools
                    if q in str(t.get("name", "")).lower() or q in str(t.get("description", "")).lower()
                ]
            if args.format == "markdown":
                print(format_tools_markdown(eng, tools))
            else:
                print(json.dumps({"engine": eng, "count": len(tools), "tools": tools}, ensure_ascii=False, indent=2))
            return 0

        if args.cmd == "enable-toolset":
            resp = dispatch_rpc("craft", "tools/call", {"name": "enable_toolset", "arguments": {"toolset": args.toolset}})
            print(json.dumps(resp, ensure_ascii=False, indent=2))
            return 1 if "error" in resp or (resp.get("result") or {}).get("isError") else 0

        if args.cmd == "call":
            eng = normalize_engine(args.engine)
            if args.args_file:
                raw_args = Path(args.args_file).expanduser().read_text(encoding="utf-8-sig")
            else:
                raw_args = args.args_json
            tool_args = json.loads(raw_args) if raw_args and raw_args.strip() else {}
            if not isinstance(tool_args, dict):
                raise ValueError("工具参数必须是 JSON 对象")
            resp = dispatch_rpc(
                eng,
                "tools/call",
                {"name": args.tool_name, "arguments": tool_args},
                timeout=args.timeout,
                server_cmd=parse_server_cmd(args.server_cmd),
            )
            emit_bounded_output(eng, args.tool_name, resp, save_json=args.save_json, max_chars=args.max_chars)
            if "error" in resp or (resp.get("result") or {}).get("isError"):
                return 1
            return 0

        if args.cmd == "resources":
            eng = normalize_engine(args.engine)
            resp = dispatch_rpc(eng, "resources/list", {}, server_cmd=parse_server_cmd(args.server_cmd))
            print(json.dumps(resp, ensure_ascii=False, indent=2))
            return 1 if "error" in resp else 0

        if args.cmd == "read-resource":
            eng = normalize_engine(args.engine)
            resp = dispatch_rpc(eng, "resources/read", {"uri": args.uri}, server_cmd=parse_server_cmd(args.server_cmd))
            emit_bounded_output(eng, "resource", resp, save_json=args.save_json, max_chars=args.max_chars)
            return 1 if "error" in resp else 0

    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 3
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
