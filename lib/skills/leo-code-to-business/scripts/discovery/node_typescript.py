"""Node.js and TypeScript multi-signal discovery adapter."""

from __future__ import annotations

import json
import re
from pathlib import Path

from discovery.core import AdapterResult, DiscoveryContext, RawFinding, RejectedFinding


SOURCE_SUFFIXES = {".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx"}
EXCLUDED_PARTS = {
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".git",
    "_leo_business",
}
ROUTE_PATTERN = re.compile(
    r"\b(?P<receiver>app|router|server)\.(?P<method>get|post|put|patch|delete|all)"
    r"\s*\(\s*(?P<quote>['\"])(?P<path>[^'\"]+)(?P=quote)",
    re.I,
)
SERVER_ROUTE_PATTERN = re.compile(
    r"\bserver\.route\s*\(\s*\{(?P<body>.*?)\}\s*\)", re.I | re.S
)
CREATE_SERVER_PATTERN = re.compile(r"\b(?:http|https)\.createServer\s*\(")
ORM_WRITE_PATTERN = re.compile(
    r"\b(?P<receiver>(?:db|prisma|sequelize|knex|repository|repo|model|collection)"
    r"(?:\.[A-Za-z_$][\w$]*)*)\.(?P<method>create|insert|update|updateMany|upsert|delete|deleteMany|save|execute)\s*\(",
    re.I,
)
FETCH_PATTERN = re.compile(r"\b(?P<client>fetch|axios(?:\.[a-z]+)?|got|request)\s*\(", re.I)
EVENT_PATTERN = re.compile(
    r"\b(?P<receiver>[A-Za-z_$][\w$]*)\.(?P<method>emit|publish|send|on|once|subscribe|consume)"
    r"\s*\(\s*(?P<quote>['\"])(?P<event>[^'\"]+)(?P=quote)",
    re.I,
)
SCHEDULE_PATTERN = re.compile(
    r"\b(?P<receiver>cron|schedule|scheduler)\.(?P<method>schedule|scheduleJob|add)\s*\(",
    re.I,
)
CLI_PATTERN = re.compile(
    r"\b(?P<receiver>program|cli|command)\.command\s*\(\s*(?P<quote>['\"])(?P<name>[^'\"]+)(?P=quote)",
    re.I,
)
DYNAMIC_ROUTE_PATTERN = re.compile(
    r"\b(?:app|router|server)\.(?:get|post|put|patch|delete|all)\s*\(\s*(?!['\"])",
    re.I,
)
DYNAMIC_EVENT_PATTERN = re.compile(
    r"\b[A-Za-z_$][\w$]*\.(?:emit|publish|send|on|once|subscribe|consume)\s*\(\s*(?!['\"])",
    re.I,
)
UNKNOWN_DECORATOR_PATTERN = re.compile(r"^\s*@(Get|Post|Put|Patch|Delete|Controller|Subscribe)\b", re.M)
REPAIR_PATTERN = re.compile(r"repair|retry|reconcile|compensat|redo|replay|relink", re.I)


def _line(content: str, offset: int) -> int:
    return content.count("\n", 0, offset) + 1


def _location(relative: str, symbol: str, content: str, match: re.Match[str]) -> dict:
    start = _line(content, match.start())
    return {
        "path": relative,
        "symbol": symbol,
        "start_line": start,
        "end_line": start + max(1, match.group(0).count("\n")),
    }


class NodeTypeScriptAdapter:
    adapter_id = "node-typescript"
    adapter_version = "2.0"
    claimed_languages = {"javascript", "typescript"}
    claimed_frameworks = {
        "node-http",
        "express",
        "fastify",
        "koa",
        "prisma",
        "sequelize",
        "node-events",
        "node-cron",
        "commander",
    }
    supported_signal_kinds = {
        "http_entry",
        "server_handler",
        "persistence_write",
        "external_call",
        "event_producer",
        "event_consumer",
        "scheduled_job",
        "command_entry",
        "repair_entry",
    }

    def discover(self, context: DiscoveryContext) -> AdapterResult:
        findings: list[RawFinding] = []
        rejected: list[RejectedFinding] = []
        unsupported: set[str] = set()
        frameworks = self._package_frameworks(context.repo_root)
        for relative in sorted(context.snapshot.get("files", {})):
            path = Path(relative)
            if path.suffix.lower() not in SOURCE_SUFFIXES:
                continue
            if set(path.parts) & EXCLUDED_PARTS or relative.endswith((".min.js", ".bundle.js")):
                continue
            source_path = context.repo_root / relative
            try:
                content = source_path.read_text(encoding="utf-8", errors="ignore")
            except OSError as exc:
                rejected.append(
                    RejectedFinding(relative, f"unreadable:{exc.__class__.__name__}")
                )
                continue
            findings.extend(self._routes(relative, content))
            findings.extend(self._server_handlers(relative, content))
            findings.extend(self._writes(relative, content))
            findings.extend(self._external_calls(relative, content))
            findings.extend(self._events(relative, content))
            findings.extend(self._schedules(relative, content))
            findings.extend(self._commands(relative, content))
            if DYNAMIC_ROUTE_PATTERN.search(content):
                unsupported.add(f"dynamic route expression: {relative}")
            if DYNAMIC_EVENT_PATTERN.search(content):
                unsupported.add(f"computed event name: {relative}")
            if UNKNOWN_DECORATOR_PATTERN.search(content) and not frameworks & {
                "@nestjs/common",
                "routing-controllers",
            }:
                unsupported.add(f"unknown route decorator framework: {relative}")
            if re.search(r"generated|openapi|swagger", relative, re.I):
                unsupported.add(f"generated client requires source verification: {relative}")
        return AdapterResult(
            findings=findings,
            rejected=rejected,
            unsupported_constructs=sorted(unsupported),
            truncated=False,
            diagnostics=[
                "package frameworks: " + ", ".join(sorted(frameworks))
                if frameworks
                else "package frameworks: none detected"
            ],
        )

    @staticmethod
    def _package_frameworks(repo_root: Path) -> set[str]:
        path = repo_root / "package.json"
        if not path.exists():
            return set()
        try:
            package = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return set()
        dependencies = {
            **package.get("dependencies", {}),
            **package.get("devDependencies", {}),
        }
        return set(dependencies)

    def _routes(self, relative: str, content: str) -> list[RawFinding]:
        findings = []
        for match in ROUTE_PATTERN.finditer(content):
            method = match.group("method").upper()
            route = match.group("path")
            findings.append(
                RawFinding(
                    signal_class="trigger_entry",
                    kind="http_entry",
                    locator=f"{relative}:{method}:{route}",
                    name=f"{method} {route}",
                    source_location=_location(relative, f"{match.group('receiver')}.{match.group('method')}", content, match),
                    framework_identity=f"{method} {route}",
                    structural_importance="normal",
                    classification="unresolved",
                )
            )
        for match in SERVER_ROUTE_PATTERN.finditer(content):
            body = match.group("body")
            method_match = re.search(r"method\s*:\s*['\"]([^'\"]+)", body, re.I)
            path_match = re.search(r"(?:url|path)\s*:\s*['\"]([^'\"]+)", body, re.I)
            if not method_match or not path_match:
                continue
            method = method_match.group(1).upper()
            route = path_match.group(1)
            findings.append(
                RawFinding(
                    signal_class="trigger_entry",
                    kind="http_entry",
                    locator=f"{relative}:{method}:{route}:server-route",
                    name=f"{method} {route}",
                    source_location=_location(relative, "server.route", content, match),
                    framework_identity=f"{method} {route}",
                    classification="unresolved",
                )
            )
        return findings

    def _server_handlers(self, relative: str, content: str) -> list[RawFinding]:
        return [
            RawFinding(
                signal_class="trigger_entry",
                kind="server_handler",
                locator=f"{relative}:http.createServer:{index}",
                name="http.createServer handler",
                source_location=_location(relative, "http.createServer", content, match),
                framework_identity="node-http-createServer",
                structural_importance="normal",
                classification="unresolved",
            )
            for index, match in enumerate(CREATE_SERVER_PATTERN.finditer(content))
        ]

    def _writes(self, relative: str, content: str) -> list[RawFinding]:
        findings = []
        for index, match in enumerate(ORM_WRITE_PATTERN.finditer(content)):
            identity = f"{match.group('receiver')}.{match.group('method')}"
            findings.append(
                RawFinding(
                    signal_class="mutation_anchor",
                    kind="persistence_write",
                    locator=f"{relative}:{identity}:{index}",
                    name=identity,
                    source_location=_location(relative, identity, content, match),
                    framework_identity=identity,
                    structural_importance="high",
                    classification="business",
                )
            )
        return findings

    def _external_calls(self, relative: str, content: str) -> list[RawFinding]:
        findings = []
        for index, match in enumerate(FETCH_PATTERN.finditer(content)):
            nearby = content[match.start() : match.start() + 240]
            high = bool(re.search(r"payment|refund|billing|charge|order|approval", nearby, re.I))
            findings.append(
                RawFinding(
                    signal_class="external_effect_anchor",
                    kind="external_call",
                    locator=f"{relative}:{match.group('client')}:{index}",
                    name=match.group("client"),
                    source_location=_location(relative, match.group("client"), content, match),
                    framework_identity=match.group("client").lower(),
                    structural_importance="high" if high else "normal",
                    classification="external_integration",
                )
            )
        return findings

    def _events(self, relative: str, content: str) -> list[RawFinding]:
        findings = []
        for index, match in enumerate(EVENT_PATTERN.finditer(content)):
            method = match.group("method").lower()
            producer = method in {"emit", "publish", "send"}
            event = match.group("event")
            findings.append(
                RawFinding(
                    signal_class="event_anchor",
                    kind="event_producer" if producer else "event_consumer",
                    locator=f"{relative}:{method}:{event}:{index}",
                    name=f"{method} {event}",
                    source_location=_location(relative, f"{match.group('receiver')}.{method}", content, match),
                    framework_identity=event,
                    structural_importance="high",
                    classification="business",
                )
            )
        return findings

    def _schedules(self, relative: str, content: str) -> list[RawFinding]:
        findings = []
        for index, match in enumerate(SCHEDULE_PATTERN.finditer(content)):
            nearby = content[match.start() : match.start() + 220]
            repair = bool(REPAIR_PATTERN.search(nearby))
            findings.append(
                RawFinding(
                    signal_class="operational_anchor",
                    kind="scheduled_job",
                    locator=f"{relative}:schedule:{index}",
                    name="scheduled job",
                    source_location=_location(relative, "schedule", content, match),
                    framework_identity="node-schedule",
                    structural_importance="high" if repair else "normal",
                    classification="operations",
                )
            )
            if repair:
                findings.append(
                    RawFinding(
                        signal_class="operational_anchor",
                        kind="repair_entry",
                        locator=f"{relative}:schedule-repair:{index}",
                        name="scheduled repair",
                        source_location=_location(relative, "schedule", content, match),
                        framework_identity="scheduled-repair",
                        structural_importance="high",
                        classification="compensation_or_retry",
                    )
                )
        return findings

    def _commands(self, relative: str, content: str) -> list[RawFinding]:
        findings = []
        for index, match in enumerate(CLI_PATTERN.finditer(content)):
            name = match.group("name")
            repair = bool(REPAIR_PATTERN.search(name))
            findings.append(
                RawFinding(
                    signal_class="trigger_entry",
                    kind="command_entry",
                    locator=f"{relative}:command:{name}:{index}",
                    name=name,
                    source_location=_location(relative, "program.command", content, match),
                    framework_identity=name,
                    structural_importance="high" if repair else "normal",
                    classification="operations",
                )
            )
            if repair:
                findings.append(
                    RawFinding(
                        signal_class="operational_anchor",
                        kind="repair_entry",
                        locator=f"{relative}:command-repair:{name}:{index}",
                        name=name,
                        source_location=_location(relative, "program.command", content, match),
                        framework_identity=name,
                        structural_importance="high",
                        classification="compensation_or_retry",
                    )
                )
        return findings
