"""End-to-end tests for leo-reverse-clone persistent headless MCP bridge."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
BRIDGE = SKILL_DIR / "scripts" / "mcp_bridge.py"

MOCK_STDIO_SERVER = r"""
import json, sys

state = {"opened": None, "calls": 0, "toolsets": ["core"]}

for raw in sys.stdin:
    line = raw.strip()
    if not line:
        continue
    msg = json.loads(line)
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}
    if mid is None:
        continue
    if method == "initialize":
        resp = {"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": "2025-06-18", "serverInfo": {"name": "mock-craft", "version": "0.6.1"}}}
    elif method == "tools/list":
        tools = [{"name": "core_target_open", "description": "Open a target"}]
        if "android" in state["toolsets"]:
            tools.append({"name": "android_package_show", "description": "Show APK"})
        resp = {"jsonrpc": "2.0", "id": mid, "result": {"tools": tools}}
    elif method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        state["calls"] += 1
        if name == "core_target_open":
            state["opened"] = args.get("path")
            payload = {"opened": state["opened"], "calls": state["calls"]}
        elif name == "enable_toolset":
            ts = args.get("toolset")
            if ts and ts not in state["toolsets"]:
                state["toolsets"].append(ts)
            payload = {"enabled": state["toolsets"]}
        elif name == "big_output":
            payload = {"blob": "X" * 5000, "opened": state["opened"], "calls": state["calls"]}
        else:
            payload = {"opened": state["opened"], "calls": state["calls"], "tool": name}
        resp = {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": json.dumps(payload)}], "structuredContent": payload, "isError": False}}
    elif method == "resources/list":
        resp = {"jsonrpc": "2.0", "id": mid, "result": {"resources": [{"uri": "evidence://ev_demo", "name": "ev_demo"}]}}
    elif method == "resources/read":
        resp = {"jsonrpc": "2.0", "id": mid, "result": {"contents": [{"uri": params.get("uri"), "text": json.dumps({"opened": state["opened"]})}]}}
    else:
        resp = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown {method}"}}
    sys.stdout.write(json.dumps(resp) + "\n")
    sys.stdout.flush()
"""

MOCK_HTTP_SERVER = r"""
import json, sys, secrets
from http.server import BaseHTTPRequestHandler, HTTPServer

session_id = "sid-" + secrets.token_hex(6)
state = {"calls": 0, "opened": None}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return
    def do_DELETE(self):
        self.send_response(200)
        self.end_headers()
    def do_POST(self):
        length = int(self.headers.get("Content-Length") or "0")
        body = json.loads(self.rfile.read(length).decode("utf-8"))
        mid = body.get("id")
        method = body.get("method")
        params = body.get("params") or {}
        if method == "notifications/initialized":
            self.send_response(202)
            self.end_headers()
            return
        if method == "initialize":
            resp = {"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": "2025-06-18", "serverInfo": {"name": "mock-rea", "version": "6.10.1"}}}
            raw = json.dumps(resp).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Mcp-Session-Id", session_id)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if self.headers.get("Mcp-Session-Id") != session_id:
            self.send_response(404)
            self.end_headers()
            return
        if method == "ping":
            resp = {"jsonrpc": "2.0", "id": mid, "result": {}}
            raw = json.dumps(resp).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if method == "tools/list":
            resp = {"jsonrpc": "2.0", "id": mid, "result": {"tools": [{"name": "inspect_android_package", "description": "Inspect APK"}]}}
            raw = json.dumps(resp).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if method == "tools/call":
            state["calls"] += 1
            args = params.get("arguments") or {}
            if "path" in args:
                state["opened"] = args["path"]
            payload = {"calls": state["calls"], "opened": state["opened"], "session_id": session_id}
            resp = {"jsonrpc": "2.0", "id": mid, "result": {"structuredContent": payload, "isError": False}}
            # Test SSE response framing
            sse = f"event: message\ndata: {json.dumps(resp)}\n\n".encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(sse)))
            self.end_headers()
            self.wfile.write(sse)
            return
        self.send_response(404)
        self.end_headers()

httpd = HTTPServer(("127.0.0.1", 0), Handler)
port = httpd.server_address[1]
sys.stderr.write(json.dumps({"msg": "MCP transport listening", "url": f"http://127.0.0.1:{port}/mcp"}) + "\n")
sys.stderr.flush()
httpd.serve_forever()
"""


class TestMcpBridge(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="leo-rc-bridge-")
        self.tmp_dir = Path(self._tmp.name)
        self.env = dict(os.environ)
        self.env["LEO_REVERSE_CLONE_RUNTIME_DIR"] = str(self.tmp_dir / "runtime")
        self.env["LEO_REVERSE_CLONE_CONFIG_PATH"] = str(self.tmp_dir / "config.json")

        self.stdio_script = self.tmp_dir / "mock_stdio.py"
        self.stdio_script.write_text(MOCK_STDIO_SERVER, encoding="utf-8")
        self.http_script = self.tmp_dir / "mock_http.py"
        self.http_script.write_text(MOCK_HTTP_SERVER, encoding="utf-8")

    def tearDown(self) -> None:
        self._run_bridge(["stop", "all"], check=False)
        self._tmp.cleanup()

    def _run_bridge(self, args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
        proc = subprocess.run(
            [sys.executable, str(BRIDGE), *args],
            env=self.env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        if check and proc.returncode != 0:
            self.fail(f"bridge {args} failed ({proc.returncode}):\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}")
        return proc

    def test_craft_stdio_broker_persists_session_toolsets_and_spills_large_output(self) -> None:
        server_cmd = json.dumps([sys.executable, str(self.stdio_script)])
        start = json.loads(self._run_bridge(["start", "craft", "--deep", "--server-cmd", server_cmd]).stdout)
        self.assertEqual(start["engine"], "craft")
        self.assertEqual(start["mode"], "deep")
        self.assertNotIn("token", start)

        # Call 1 opens target in persistent stdio session
        call1 = json.loads(self._run_bridge(["call", "craft", "core_target_open", '{"path":"/abs/demo.apk"}']).stdout)
        self.assertEqual(call1["result"]["structuredContent"]["opened"], "/abs/demo.apk")
        self.assertEqual(call1["result"]["structuredContent"]["calls"], 1)

        # Enable toolset persists into subsequent tools/list
        self._run_bridge(["enable-toolset", "craft", "android"])
        tools = json.loads(self._run_bridge(["tools", "craft", "--format", "json"]).stdout)
        tool_names = [t["name"] for t in tools["tools"]]
        self.assertIn("android_package_show", tool_names)

        # Call 2 sees target opened in Call 1 (proving persistent session!)
        call2 = json.loads(self._run_bridge(["call", "craft", "android_package_show", "{}" ]).stdout)
        self.assertEqual(call2["result"]["structuredContent"]["opened"], "/abs/demo.apk")
        self.assertEqual(call2["result"]["structuredContent"]["calls"], 3)

        # Resource read sees persistent state
        res = json.loads(self._run_bridge(["read-resource", "craft", "evidence://ev_demo"]).stdout)
        self.assertIn("/abs/demo.apk", res["result"]["contents"][0]["text"])

        # Oversized output spills to disk automatically
        big = json.loads(self._run_bridge(["call", "craft", "big_output", "{}", "--max-chars", "400"]).stdout)
        self.assertTrue(big["truncated"])
        saved_path = Path(big["saved_to"])
        self.assertTrue(saved_path.is_file())
        self.assertIn("XXXXX", saved_path.read_text(encoding="utf-8"))

        # Stop cleanly shuts down broker
        stopped = json.loads(self._run_bridge(["stop", "craft"]).stdout)
        self.assertTrue(stopped["craft"]["stopped"])
        status = json.loads(self._run_bridge(["status", "craft"]).stdout)
        self.assertFalse(status["craft"]["running"])

    def test_rea_streamable_http_reuses_mcp_session_and_parses_sse(self) -> None:
        server_cmd = json.dumps([sys.executable, str(self.http_script)])
        start = json.loads(self._run_bridge(["start", "rea", "--server-cmd", server_cmd]).stdout)
        self.assertEqual(start["engine"], "rea")
        self.assertTrue(start["session_id"].startswith("sid-"))

        # Call 1 + Call 2 reuse the exact same Mcp-Session-Id and keep server state
        c1 = json.loads(self._run_bridge(["call", "rea", "inspect_android_package", '{"path":"/abs/app.apk"}']).stdout)
        self.assertEqual(c1["result"]["structuredContent"]["calls"], 1)
        self.assertEqual(c1["result"]["structuredContent"]["opened"], "/abs/app.apk")

        c2 = json.loads(self._run_bridge(["call", "rea", "inspect_android_package", "{}"]).stdout)
        self.assertEqual(c2["result"]["structuredContent"]["calls"], 2)
        self.assertEqual(c2["result"]["structuredContent"]["opened"], "/abs/app.apk")
        self.assertEqual(
            c1["result"]["structuredContent"]["session_id"],
            c2["result"]["structuredContent"]["session_id"],
        )

        # Tools markdown formatting works
        md = self._run_bridge(["tools", "rea", "--format", "markdown"]).stdout
        self.assertIn("inspect_android_package", md)

        # Clean stop
        stopped = json.loads(self._run_bridge(["stop", "rea"]).stdout)
        self.assertTrue(stopped["rea"]["stopped"])
        status = json.loads(self._run_bridge(["status", "rea"]).stdout)
        self.assertFalse(status["rea"]["running"])

    def test_proxy_inheritance_and_loopback_no_proxy(self) -> None:
        sys.path.insert(0, str(SKILL_DIR / "scripts"))
        import mcp_bridge

        mac_out = "HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7897\n"
        self.assertEqual(mcp_bridge.parse_scutil_proxy_output(mac_out), "http://127.0.0.1:7897")

        win_out = "ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ http=127.0.0.1:7890;https=127.0.0.1:7891\n"
        self.assertEqual(mcp_bridge.parse_windows_reg_proxy_output(win_out), "http://127.0.0.1:7891")

        # Config proxy overrides env, and loopback is protected in NO_PROXY
        cfg_file = self.tmp_dir / "config.json"
        cfg_file.write_text(json.dumps({"proxy": "http://127.0.0.1:7897"}), encoding="utf-8")
        old_cfg = os.environ.get("LEO_REVERSE_CLONE_CONFIG_PATH")
        os.environ["LEO_REVERSE_CLONE_CONFIG_PATH"] = str(cfg_file)
        try:
            env = mcp_bridge.get_augmented_env()
            self.assertEqual(env.get("HTTPS_PROXY"), "http://127.0.0.1:7897")
            self.assertEqual(env.get("HTTP_PROXY"), "http://127.0.0.1:7897")
            self.assertIn("127.0.0.1", env.get("NO_PROXY", ""))
            self.assertIn("localhost", env.get("NO_PROXY", ""))
            self.assertIn("::1", env.get("NO_PROXY", ""))
        finally:
            if old_cfg is None:
                os.environ.pop("LEO_REVERSE_CLONE_CONFIG_PATH", None)
            else:
                os.environ["LEO_REVERSE_CLONE_CONFIG_PATH"] = old_cfg


if __name__ == "__main__":
    unittest.main()
