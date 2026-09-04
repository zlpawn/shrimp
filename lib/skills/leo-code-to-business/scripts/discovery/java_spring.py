"""Java/Spring multi-signal discovery adapter."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

from discovery.core import AdapterResult, DiscoveryContext, RawFinding, RejectedFinding


METHOD_PATTERN = re.compile(
    r"(?P<annotations>(?:\s*@[^\n]+\n)*)"
    r"\s*(?:(?:public|protected|private|static|final|synchronized|abstract|default)\s+)*"
    r"[\w<>,.?\[\]\s]+\s+(?P<name>\w+)\s*\((?s:.*?)\)\s*(?:throws\s+[^\{;]+)?(?P<end>[\{;])",
    re.MULTILINE,
)
CLASS_PATTERN = re.compile(
    r"(?P<annotations>(?:\s*@[^\n]+\n)*)\s*(?:public\s+)?(?:class|interface)\s+(?P<name>\w+)",
    re.MULTILINE,
)
MAPPING_PATTERN = re.compile(
    r"@(?P<kind>RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)"
    r"(?:\s*\((?P<args>[^)]*)\))?",
    re.DOTALL,
)
PATH_PATTERN = re.compile(r"[\"'](?P<path>/[^\"']*|[^\"']+)[\"']")
SQL_WRITE_PATTERN = re.compile(r"\b(?:update|insert\s+into|delete\s+from|merge\s+into)\b", re.I)
CALL_PATTERN = re.compile(r"\b(?P<receiver>\w+)\.(?P<method>\w+)\s*\(")
TERMINAL_STATE_PATTERN = re.compile(
    r"\b(?:CANCELLED|CANCELED|CLOSED|REJECTED|FAILED|COMPLETED|DONE|REFUNDED|APPROVED)\b"
)
CALCULATION_METHOD_PATTERN = re.compile(
    r"(?:^calculate$|calculate.*score|recalculate.*score|cal.*score|trigger.*score)", re.I
)
BUSINESS_PROCESS_METHOD_PATTERN = re.compile(
    r"(?:contactVideoByFolder|uploaded.*VideoRelate|relate.*Video)", re.I
)
STATE_TRANSITION_METHOD_PATTERN = re.compile(
    r"(?:updateTask(?:Success|Failure|Result)|completeTask|failTask)", re.I
)


def _line_number(content: str, offset: int) -> int:
    return content.count("\n", 0, offset) + 1


def _path_from_mapping(annotation_text: str) -> tuple[str, str] | None:
    match = MAPPING_PATTERN.search(annotation_text)
    if not match:
        return None
    annotation = match.group("kind")
    path_match = PATH_PATTERN.search(match.group("args") or "")
    path = path_match.group("path") if path_match else ""
    if path and not path.startswith("/"):
        path = "/" + path
    method = {
        "GetMapping": "GET",
        "PostMapping": "POST",
        "PutMapping": "PUT",
        "DeleteMapping": "DELETE",
        "PatchMapping": "PATCH",
        "RequestMapping": "ANY",
    }[annotation]
    return method, path


def _method_blocks(content: str) -> Iterable[tuple[re.Match[str], str]]:
    for match in METHOD_PATTERN.finditer(content):
        if match.group("end") == ";":
            yield match, ""
            continue
        brace_start = content.find("{", match.start())
        depth = 0
        quote: str | None = None
        escaped = False
        for index in range(brace_start, len(content)):
            char = content[index]
            if quote:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote:
                    quote = None
                continue
            if char in {"\"", "'"}:
                quote = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    yield match, content[brace_start + 1 : index]
                    break


def _location(path: str, symbol: str, content: str, start: int, body: str = "") -> dict:
    start_line = _line_number(content, start)
    return {
        "path": path,
        "symbol": symbol,
        "start_line": start_line,
        "end_line": start_line + max(1, body.count("\n") + 2),
    }


class JavaSpringAdapter:
    adapter_id = "java-spring"
    adapter_version = "3.0"
    claimed_languages = {"java"}
    claimed_frameworks = {"spring", "spring-mvc", "spring-events", "mybatis", "feign"}
    supported_signal_kinds = {
        "http_entry",
        "event_consumer",
        "scheduled_job",
        "command_entry",
        "persistence_write",
        "state_write",
        "external_call",
        "event_producer",
        "repair_entry",
        "business_process",
        "calculation",
        "callback_entry",
        "state_transition",
    }

    def discover(self, context: DiscoveryContext) -> AdapterResult:
        findings: list[RawFinding] = []
        rejected: list[RejectedFinding] = []
        unsupported: set[str] = set()
        java_paths = sorted(
            path for path in context.snapshot.get("files", {}) if path.endswith(".java")
        )
        for relative in java_paths:
            path = context.repo_root / relative
            try:
                content = path.read_text(encoding="utf-8", errors="ignore")
            except OSError as exc:
                rejected.append(RejectedFinding(relative, f"unreadable:{exc.__class__.__name__}"))
                continue
            class_match = CLASS_PATTERN.search(content)
            class_name = class_match.group("name") if class_match else path.stem
            class_annotations = class_match.group("annotations") if class_match else ""
            is_feign = "@FeignClient" in class_annotations or "@FeignClient" in content[: class_match.end() if class_match else 0]
            class_mapping = _path_from_mapping(class_annotations)
            class_prefix = class_mapping[1] if class_mapping else ""
            if re.search(r"@\w+Mapping\b", class_annotations) and not class_mapping:
                unsupported.add(f"custom composed class mapping: {relative}:{class_name}")

            for method_match, body in _method_blocks(content):
                method = method_match.group("name")
                annotations = method_match.group("annotations") or ""
                symbol = f"{class_name}.{method}"
                location = _location(relative, symbol, content, method_match.start(), body)
                mapping = _path_from_mapping(annotations)
                if mapping:
                    http_method, method_path = mapping
                    route = (class_prefix.rstrip("/") + method_path) or "/"
                    is_callback = "/callback" in route.lower() or "callback" in method.lower()
                    kind = "callback_entry" if is_callback else ("external_call" if is_feign else "http_entry")
                    signal_class = (
                        "trigger_entry"
                        if is_callback or not is_feign
                        else "external_effect_anchor"
                    )
                    findings.append(
                        RawFinding(
                            signal_class=signal_class,
                            kind=kind,
                            locator=f"{relative}:{symbol}:{http_method}:{route}",
                            name=f"{http_method} {route}",
                            source_location=location,
                            framework_identity=f"{http_method} {route}",
                            structural_importance="high" if is_callback or is_feign else "normal",
                            classification=(
                                "business"
                                if is_callback
                                else ("external_integration" if is_feign else "unresolved")
                            ),
                        )
                    )
                elif re.search(r"@\w+Mapping\b", annotations):
                    unsupported.add(f"custom composed method mapping: {relative}:{symbol}")

                if "@EventListener" in annotations or re.search(
                    r"@(KafkaListener|RabbitListener|RocketMQMessageListener)\b", annotations
                ):
                    findings.append(
                        RawFinding(
                            signal_class="event_anchor",
                            kind="event_consumer",
                            locator=f"{relative}:{symbol}:consumer",
                            name=symbol,
                            source_location=location,
                            framework_identity=annotations.strip(),
                            structural_importance="high",
                            classification="business",
                        )
                    )
                if "@Scheduled" in annotations:
                    findings.append(
                        RawFinding(
                            signal_class="operational_anchor",
                            kind="scheduled_job",
                            locator=f"{relative}:{symbol}:scheduled",
                            name=symbol,
                            source_location=location,
                            framework_identity=annotations.strip(),
                            structural_importance="high" if self._is_repair(symbol, body) else "normal",
                            classification="operations",
                        )
                    )
                if self._is_repair(symbol, body):
                    findings.append(
                        RawFinding(
                            signal_class="operational_anchor",
                            kind="repair_entry",
                            locator=f"{relative}:{symbol}:repair",
                            name=symbol,
                            source_location=location,
                            framework_identity="repair/reconcile/retry",
                            structural_importance="high",
                            classification="compensation_or_retry",
                        )
                    )

                semantic_finding = self._semantic_method_finding(
                    relative, class_name, method, symbol, location
                )
                if semantic_finding is not None:
                    findings.append(semantic_finding)

                findings.extend(self._body_findings(relative, symbol, content, method_match.start(), body))

            if SQL_WRITE_PATTERN.search(content) and ("@Update" in content or "@Insert" in content or "@Delete" in content):
                for sql_match in SQL_WRITE_PATTERN.finditer(content):
                    symbol = f"{class_name}.sql"
                    findings.append(
                        RawFinding(
                            signal_class="mutation_anchor",
                            kind="persistence_write",
                            locator=f"{relative}:{symbol}:{sql_match.start()}",
                            name=sql_match.group(0).lower(),
                            source_location=_location(relative, symbol, content, sql_match.start()),
                            framework_identity=sql_match.group(0).lower(),
                            structural_importance="high",
                            classification="business",
                        )
                    )

            self._audit_high_value_surfaces(
                relative,
                content,
                class_name,
                findings,
                unsupported,
            )

        findings.extend(self._xml_sql_findings(context))
        return AdapterResult(
            findings=findings,
            rejected=rejected,
            unsupported_constructs=sorted(unsupported),
            truncated=False,
            diagnostics=[],
        )

    @staticmethod
    def _audit_high_value_surfaces(
        relative: str,
        content: str,
        class_name: str,
        findings: list[RawFinding],
        unsupported: set[str],
    ) -> None:
        found_symbols_by_kind: dict[str, set[str]] = {}
        for finding in findings:
            symbol = str(finding.source_location.get("symbol", ""))
            if str(finding.source_location.get("path", "")) != relative:
                continue
            found_symbols_by_kind.setdefault(finding.kind, set()).add(symbol)

        expected: list[tuple[str, str]] = []
        if class_name.endswith("ScoreCalculator") and re.search(r"\bcalculate\s*\(", content):
            expected.append(("calculation", f"{class_name}.calculate"))
        for mapping in MAPPING_PATTERN.finditer(content):
            annotation_text = mapping.group(0)
            path = _path_from_mapping(annotation_text)
            if path and "/callback" in path[1].lower():
                following = content[mapping.start() :]
                method = METHOD_PATTERN.search(following)
                if method:
                    expected.append(("callback_entry", f"{class_name}.{method.group('name')}"))

        for kind, symbol in expected:
            if symbol not in found_symbols_by_kind.get(kind, set()):
                unsupported.add(
                    f"high-value {kind} surface was not parsed: {relative}:{symbol}"
                )

    @staticmethod
    def _is_repair(symbol: str, body: str) -> bool:
        return bool(
            re.search(
                r"repair|retry|reconcile|compensat|redo|relink|replace|fallback|recover|restore",
                symbol + " " + body,
                re.I,
            )
        )

    @staticmethod
    def _semantic_method_finding(
        relative: str,
        class_name: str,
        method: str,
        symbol: str,
        location: dict,
    ) -> RawFinding | None:
        if class_name.endswith("ScoreCalculator") and method == "calculate":
            kind = "calculation"
            signal_class = "calculation_anchor"
        elif CALCULATION_METHOD_PATTERN.search(method):
            kind = "calculation"
            signal_class = "calculation_anchor"
        elif STATE_TRANSITION_METHOD_PATTERN.search(method):
            kind = "state_transition"
            signal_class = "state_anchor"
        elif BUSINESS_PROCESS_METHOD_PATTERN.search(method):
            kind = "business_process"
            signal_class = "process_anchor"
        else:
            return None
        return RawFinding(
            signal_class=signal_class,
            kind=kind,
            locator=f"{relative}:{symbol}:{kind}",
            name=symbol,
            source_location=location,
            framework_identity=f"java-method:{method}",
            structural_importance="high",
            classification="business",
        )

    def _body_findings(
        self, relative: str, symbol: str, content: str, start: int, body: str
    ) -> list[RawFinding]:
        findings: list[RawFinding] = []
        location = _location(relative, symbol, content, start, body)
        lowered_symbol = symbol.lower()
        for index, call in enumerate(CALL_PATTERN.finditer(body)):
            receiver = call.group("receiver")
            method = call.group("method")
            identity = f"{receiver}.{method}"
            lowered = identity.lower()
            if receiver in {"repository", "mapper", "dao"} and re.search(
                r"insert|update|save|delete|write|restore|set", method, re.I
            ):
                findings.append(
                    RawFinding(
                        signal_class="mutation_anchor",
                        kind="persistence_write",
                        locator=f"{relative}:{symbol}:{identity}:{index}",
                        name=identity,
                        source_location=location,
                        framework_identity=identity,
                        structural_importance="high",
                        classification="business",
                    )
                )
            if re.search(r"\.set\s*\(|set\w+\s*\(|updateStatus|changeStatus", body) and (
                method in {"set", "updateStatus", "changeStatus", "update"} or "status" in method.lower()
            ):
                findings.append(
                    RawFinding(
                        signal_class="state_anchor",
                        kind="state_write",
                        locator=f"{relative}:{symbol}:{identity}:state:{index}",
                        name=identity,
                        source_location=location,
                        framework_identity=identity,
                        structural_importance="high" if TERMINAL_STATE_PATTERN.search(body) else "normal",
                        classification="business",
                    )
                )
            if method in {"publishEvent", "send", "produce", "publish"} or receiver in {
                "publisher", "producer", "eventBus"
            }:
                findings.append(
                    RawFinding(
                        signal_class="event_anchor",
                        kind="event_producer",
                        locator=f"{relative}:{symbol}:{identity}:producer:{index}",
                        name=identity,
                        source_location=location,
                        framework_identity=identity,
                        structural_importance="high",
                        classification="business",
                    )
                )
            if receiver.lower().endswith(("client", "gateway", "sdk")) or any(
                term in lowered for term in ("payment", "refund", "http", "resttemplate", "webclient")
            ):
                findings.append(
                    RawFinding(
                        signal_class="external_effect_anchor",
                        kind="external_call",
                        locator=f"{relative}:{symbol}:{identity}:external:{index}",
                        name=identity,
                        source_location=location,
                        framework_identity=identity,
                        structural_importance="high" if any(term in lowered for term in ("payment", "refund")) else "normal",
                        classification="external_integration",
                    )
                )
        return findings

    def _xml_sql_findings(self, context: DiscoveryContext) -> list[RawFinding]:
        findings: list[RawFinding] = []
        for relative in sorted(context.snapshot.get("files", {})):
            if not relative.endswith((".xml", ".sql")):
                continue
            path = context.repo_root / relative
            try:
                content = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for index, match in enumerate(SQL_WRITE_PATTERN.finditer(content)):
                findings.append(
                    RawFinding(
                        signal_class="mutation_anchor",
                        kind="persistence_write",
                        locator=f"{relative}:sql:{index}",
                        name=match.group(0).lower(),
                        source_location=_location(relative, "sql", content, match.start()),
                        framework_identity=match.group(0).lower(),
                        structural_importance="high",
                        classification="business",
                    )
                )
        return findings
