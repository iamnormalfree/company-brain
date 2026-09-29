#!/usr/bin/env python3
"""
bd-bridge.py — minimal HTTP bridge from kongming (Cloudflare Worker) to bd.

kongming runs inside workerd with no shell, so it cannot run `bd` directly. This
script exposes a tiny localhost-only HTTP API that kongming can call via fetch()
when the wrangler config allows host bindings.

Endpoints (all GET, all return JSON):

  GET /health
    -> {"ok": true, "bd_version": "...", "rig": "..."}

  GET /bd/ready?limit=50
    -> runs `bd ready --json --limit <n>` and returns the parsed JSON array.
       Defaults: limit=50, max=200.

  GET /bd/show?id=<bead-id>
    -> runs `bd show <id> --json` and returns the parsed JSON object.

  GET /bd/list?status=open&limit=50
    -> runs `bd list --json --status <status> --limit <n>`. status is one of
       open, in_progress, closed, all. Defaults: open, 50.

Auth: requires header `Authorization: Bearer <token>` matching the
BD_BRIDGE_TOKEN env var. 401 otherwise.

Bind: <process>127.0.0.1:<BD_BRIDGE_PORT> (default 8795). NEVER 0.0.0.0.

Logging: each request goes to stderr with `[bd-bridge]` prefix. Kongming log
scrape picks up `[bd-bridge]` as a substring.

This is intentionally not an MCP server. ADR docs/adr/2026-09-29-*.md anchor
the choice (smallest viable bridge; Service-HQ stays operational-only).
"""

import json
import logging
import os
import shlex
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BRIDGE_VERSION = "0.1.0"
DEFAULT_PORT = 8795
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
VALID_STATUS = ("open", "in_progress", "closed", "all")

logging.basicConfig(
    level=logging.INFO,
    format="[bd-bridge] %(asctime)s %(levelname)s %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("bd-bridge")


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise RuntimeError(f"missing required env var: {name}")
    return value


# Resolve bd binary and rig dir once at startup so we fail loudly if either is
# missing. kongming's bd is symlinked into PATH for the operate repo; we let
# bd pick its own rig from $BD_RIG_DIR (defaults to /srv/agents/operate).
def resolve_bd() -> tuple[str, str]:
    rig = os.environ.get("BD_RIG_DIR", "/srv/agents/operate")
    bd_bin = os.environ.get("BD_BIN", "bd")
    # Probe bd so we fail fast on a missing install.
    try:
        out = subprocess.run(
            [bd_bin, "--version"],
            cwd=rig,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except FileNotFoundError:
        raise RuntimeError(f"bd binary not found: {bd_bin!r}")
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"bd --version timed out after 10s")
    if out.returncode != 0:
        raise RuntimeError(
            f"bd --version failed (rc={out.returncode}): "
            f"{out.stderr.strip() or out.stdout.strip()}"
        )
    return bd_bin, rig


def run_bd(args: list[str], rig: str) -> tuple[int, str, str]:
    """Run bd with the given args in the rig dir. Returns (rc, stdout, stderr)."""
    cmd = [bd_bin, *args, "--json"]
    log.info("exec %s", " ".join(shlex.quote(a) for a in cmd))
    try:
        proc = subprocess.run(
            cmd,
            cwd=rig,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return 124, "", "bd command timed out after 30s"
    return proc.returncode, proc.stdout, proc.stderr


def json_response(handler: BaseHTTPRequestHandler, status: int, body: dict | list):
    payload = json.dumps(body, indent=None, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(payload)


def error_response(handler: BaseHTTPRequestHandler, status: int, message: str):
    json_response(handler, status, {"error": message, "bridge_version": BRIDGE_VERSION})


def coerce_int(raw: str | None, default: int, maximum: int) -> int:
    if raw is None or raw == "":
        return default
    try:
        n = int(raw)
    except ValueError:
        raise ValueError(f"not an integer: {raw!r}")
    if n < 1:
        raise ValueError(f"must be >= 1: {n}")
    if n > maximum:
        raise ValueError(f"must be <= {maximum}: {n}")
    return n


class BdBridgeHandler(BaseHTTPRequestHandler):
    server_version = f"bd-bridge/{BRIDGE_VERSION}"

    # Silence the default per-request stderr log so we control format.
    def log_message(self, fmt, *args):
        return

    def log_request_line(self, method: str, path: str, status: int):
        log.info("%s %s -> %d", method, path, status)

    def _check_auth(self) -> bool:
        token = os.environ.get("BD_BRIDGE_TOKEN", "")
        if not token:
            log.error("BD_BRIDGE_TOKEN is empty; refusing all requests")
            return False
        auth_header = self.headers.get("Authorization", "")
        expected = f"Bearer {token}"
        # constant-time-ish compare
        if len(auth_header) != len(expected):
            return False
        result = 0
        for a, b in zip(auth_header, expected):
            result |= ord(a) ^ ord(b)
        return result == 0

    def _dispatch(self):
        if not self._check_auth():
            error_response(self, 401, "invalid or missing bearer token")
            return
        url = urlparse(self.path)
        path = url.path
        qs = parse_qs(url.query, keep_blank_values=False)

        try:
            if path == "/health":
                self._handle_health()
            elif path == "/bd/ready":
                self._handle_ready(qs)
            elif path == "/bd/show":
                self._handle_show(qs)
            elif path == "/bd/list":
                self._handle_list(qs)
            else:
                error_response(self, 404, f"unknown endpoint: {path}")
        except ValueError as exc:
            error_response(self, 400, str(exc))
        except RuntimeError as exc:
            error_response(self, 503, str(exc))

    def do_GET(self):
        try:
            self._dispatch()
        except BrokenPipeError:
            log.warning("client disconnected before response completed")

    def _handle_health(self):
        rc, out, err = run_bd(["--version"], rig)
        if rc != 0:
            error_response(self, 503, f"bd probe failed: {err.strip()}")
            return
        json_response(
            self,
            200,
            {
                "ok": True,
                "bd_version": out.strip(),
                "rig": rig,
                "bridge_version": BRIDGE_VERSION,
            },
        )

    def _handle_ready(self, qs):
        limit = coerce_int(qs.get("limit", [None])[0], DEFAULT_LIMIT, MAX_LIMIT)
        rc, out, err = run_bd(["ready", "--limit", str(limit)], rig)
        if rc != 0:
            error_response(self, 502, f"bd ready failed (rc={rc}): {err.strip()}")
            return
        try:
            payload = json.loads(out)
        except json.JSONDecodeError as exc:
            error_response(self, 502, f"bd ready returned non-JSON: {exc}")
            return
        json_response(self, 200, payload)

    def _handle_show(self, qs):
        bead_id = qs.get("id", [None])[0]
        if not bead_id:
            raise ValueError("missing required query param: id")
        # Defang: only allow bd-valid characters in bead ids (lowercase, digits,
        # dashes, dots, underscores). Avoids shell injection via subprocess.
        safe_id = "".join(c for c in bead_id if c.isalnum() or c in "-._")
        if safe_id != bead_id:
            raise ValueError(f"invalid bead id characters: {bead_id!r}")
        rc, out, err = run_bd(["show", safe_id], rig)
        if rc != 0:
            if rc == 1 and "not found" in err.lower():
                error_response(self, 404, f"bead not found: {safe_id}")
                return
            error_response(self, 502, f"bd show failed (rc={rc}): {err.strip()}")
            return
        try:
            payload = json.loads(out)
        except json.JSONDecodeError as exc:
            error_response(self, 502, f"bd show returned non-JSON: {exc}")
            return
        json_response(self, 200, payload)

    def _handle_list(self, qs):
        status = qs.get("status", ["open"])[0]
        if status not in VALID_STATUS:
            raise ValueError(
                f"invalid status {status!r}; must be one of {VALID_STATUS}"
            )
        limit = coerce_int(qs.get("limit", [None])[0], DEFAULT_LIMIT, MAX_LIMIT)
        args = ["list"]
        if status != "all":
            args += ["--status", status]
        args += ["--limit", str(limit)]
        rc, out, err = run_bd(args, rig)
        if rc != 0:
            error_response(self, 502, f"bd list failed (rc={rc}): {err.strip()}")
            return
        try:
            payload = json.loads(out)
        except json.JSONDecodeError as exc:
            error_response(self, 502, f"bd list returned non-JSON: {exc}")
            return
        json_response(self, 200, payload)


# Module-level so we resolve once and reuse. _dispatch is the per-request path.
bd_bin, rig = (None, None)  # type: ignore[assignment]


def main() -> int:
    global bd_bin, rig
    try:
        bd_bin, rig = resolve_bd()
    except RuntimeError as exc:
        log.error("startup failed: %s", exc)
        return 2

    bind_host = os.environ.get("BD_BRIDGE_HOST", "127.0.0.1")
    if bind_host not in ("127.0.0.1", "::1"):
        log.error("refusing to bind %s; only 127.0.0.1 / ::1 allowed", bind_host)
        return 2
    port = coerce_int(os.environ.get("BD_BRIDGE_PORT"), DEFAULT_PORT, 65535)

    if not os.environ.get("BD_BRIDGE_TOKEN"):
        log.error("BD_BRIDGE_TOKEN is empty; refusing to start")
        return 2
    if len(os.environ["BD_BRIDGE_TOKEN"]) < 16:
        log.error("BD_BRIDGE_TOKEN too short; need >= 16 chars")
        return 2

    server = ThreadingHTTPServer((bind_host, port), BdBridgeHandler)
    log.info(
        "listening on http://%s:%d rig=%s bd=%s",
        bind_host,
        port,
        rig,
        bd_bin,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down (SIGINT)")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())