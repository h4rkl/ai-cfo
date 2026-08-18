#!/usr/bin/env python3
"""Scan local Claude Code and Codex session logs (CodexBar-style)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OSError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def project_name(cwd: str, fallback: str = "") -> str:
    if cwd:
        parts = [p for p in Path(cwd).parts if p not in ("/",)]
        if parts:
            return parts[-1]
    if fallback:
        name = fallback.replace("-Users-", "").replace("-", "/")
        return Path(name).name or fallback
    return "unknown"


def decode_claude_dir(name: str) -> str:
    if name.startswith("-"):
        return "/" + name[1:].replace("-", "/")
    return name


def first_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content") or ""
                if text:
                    return str(text).strip()
            elif isinstance(item, str) and item.strip():
                return item.strip()
    return ""


def clip(text: str, n: int = 160) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"


class Session:
    def __init__(self, sid: str, provider: str) -> None:
        self.id = sid
        self.provider = provider
        self.cwd = ""
        self.title = ""
        self.prompt = ""
        self.started: datetime | None = None
        self.ended: datetime | None = None
        self.models: dict[str, bool] = {}
        self.input_tokens = 0
        self.output_tokens = 0
        self.cached_input = 0
        self.cache_write = 0
        self.turns = 0
        self._claude_msgs: dict[str, dict[str, int]] = {}

    def touch(self, ts: datetime | None) -> None:
        if not ts:
            return
        if self.started is None or ts < self.started:
            self.started = ts
        if self.ended is None or ts > self.ended:
            self.ended = ts

    def add_model(self, model: str | None) -> None:
        if model:
            self.models[model] = True

    def add_claude_usage(self, msg_id: str, usage: dict[str, Any], model: str | None, ts: datetime | None) -> None:
        self.touch(ts)
        self.add_model(model)
        key = msg_id or f"anon-{len(self._claude_msgs)}"
        self._claude_msgs[key] = {
            "input": int(usage.get("input_tokens") or 0),
            "output": int(usage.get("output_tokens") or 0),
            "cached": int(usage.get("cache_read_input_tokens") or 0),
            "write": int(usage.get("cache_creation_input_tokens") or 0),
        }

    def finalize_claude(self) -> None:
        self.input_tokens = 0
        self.output_tokens = 0
        self.cached_input = 0
        self.cache_write = 0
        for row in self._claude_msgs.values():
            self.input_tokens += row["input"] + row["cached"] + row["write"]
            self.output_tokens += row["output"]
            self.cached_input += row["cached"]
            self.cache_write += row["write"]
        self.turns = len(self._claude_msgs)

    def add_codex_turn(self, last: dict[str, Any], model: str | None, ts: datetime | None) -> None:
        self.touch(ts)
        self.add_model(model)
        self.input_tokens += int(last.get("input_tokens") or 0)
        self.output_tokens += int(last.get("output_tokens") or 0)
        self.cached_input += int(last.get("cached_input_tokens") or 0)
        self.cache_write += int(last.get("cache_write_input_tokens") or 0)
        self.turns += 1

    def to_dict(self) -> dict[str, Any]:
        hours = 0.0
        if self.started and self.ended:
            hours = max((self.ended - self.started).total_seconds() / 3600.0, 0.0)
        cwd = self.cwd
        return {
            "id": self.id,
            "provider": self.provider,
            "project": project_name(cwd, self.id),
            "cwd": cwd,
            "title": self.title or self.prompt or project_name(cwd, "untitled"),
            "prompt": self.prompt,
            "startedAt": self.started.isoformat() if self.started else None,
            "endedAt": self.ended.isoformat() if self.ended else None,
            "hours": round(hours, 2),
            "models": sorted(self.models),
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "cachedInputTokens": self.cached_input,
            "cacheWriteTokens": self.cache_write,
            "turns": self.turns,
        }


def iter_jsonl(path: Path):
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except OSError:
        return


def collect_files(roots: list[Path], cutoff: datetime) -> list[Path]:
    files: list[Path] = []
    cutoff_ts = cutoff.timestamp()
    for root in roots:
        if not root.is_dir():
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for name in filenames:
                if not name.endswith(".jsonl"):
                    continue
                path = Path(dirpath) / name
                try:
                    if path.stat().st_mtime < cutoff_ts - 86400:
                        continue
                except OSError:
                    continue
                files.append(path)
    return files


def scan_claude(roots: list[Path], cutoff: datetime) -> list[Session]:
    sessions: dict[str, Session] = {}
    for path in collect_files(roots, cutoff):
        sid = path.stem
        session = sessions.get(sid)
        if session is None:
            session = Session(sid, "claude")
            encoded = path.parent.name
            session.cwd = decode_claude_dir(encoded)
            sessions[sid] = session
        for obj in iter_jsonl(path):
            kind = obj.get("type")
            ts = parse_ts(obj.get("timestamp"))
            if ts and ts < cutoff and kind not in ("ai-title", "last-prompt"):
                continue
            if obj.get("cwd"):
                session.cwd = str(obj["cwd"])
            if obj.get("sessionId"):
                session.id = str(obj["sessionId"])
            if kind == "ai-title" and obj.get("aiTitle"):
                session.title = str(obj["aiTitle"]).strip()
            elif kind == "last-prompt" and obj.get("lastPrompt") and not session.prompt:
                session.prompt = clip(str(obj["lastPrompt"]))
            elif kind == "user" and not session.prompt:
                msg = obj.get("message") or {}
                session.prompt = clip(first_text(msg.get("content")))
                session.touch(ts)
            elif kind == "assistant":
                msg = obj.get("message") or {}
                usage = msg.get("usage")
                if isinstance(usage, dict):
                    session.add_claude_usage(
                        str(msg.get("id") or obj.get("requestId") or ""),
                        usage,
                        msg.get("model") or obj.get("model"),
                        ts,
                    )
        session.finalize_claude()
    return [s for s in sessions.values() if s.turns or s.input_tokens or s.output_tokens]


def scan_codex(roots: list[Path], cutoff: datetime) -> list[Session]:
    sessions: dict[str, Session] = {}
    for path in collect_files(roots, cutoff):
        current_model = ""
        sid = path.stem
        session = sessions.get(sid)
        if session is None:
            session = Session(sid, "codex")
            sessions[sid] = session
        last_total = None
        for obj in iter_jsonl(path):
            kind = obj.get("type")
            payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
            ts = parse_ts(obj.get("timestamp"))
            if kind == "session_meta":
                session.id = str(payload.get("session_id") or payload.get("id") or session.id)
                if payload.get("cwd"):
                    session.cwd = str(payload["cwd"])
                session.touch(parse_ts(payload.get("timestamp")) or ts)
                continue
            if kind == "turn_context":
                model = payload.get("model")
                if model:
                    current_model = str(model)
                    session.add_model(current_model)
                if payload.get("cwd"):
                    session.cwd = str(payload["cwd"])
                session.touch(ts)
                continue
            inner = payload if payload.get("type") else obj
            if not isinstance(inner, dict):
                continue
            if inner.get("type") in ("user_message", "user_input") and not session.prompt:
                text = inner.get("message") or inner.get("text") or first_text(inner.get("content"))
                session.prompt = clip(str(text))
                session.touch(ts)
            if inner.get("type") == "token_count":
                info = inner.get("info")
                if not isinstance(info, dict):
                    continue
                last = info.get("last_token_usage")
                total = info.get("total_token_usage")
                if isinstance(last, dict) and any(last.values()):
                    session.add_codex_turn(last, current_model, ts)
                elif isinstance(total, dict):
                    # Fall back to end-of-session cumulative if no per-turn deltas.
                    last_total = total
                    session.touch(ts)
                    session.add_model(current_model)
        if session.turns == 0 and isinstance(last_total, dict):
            session.add_codex_turn(last_total, current_model, session.ended)
    return [s for s in sessions.values() if s.turns or s.input_tokens or s.output_tokens]


def default_claude_roots() -> list[Path]:
    home = Path.home()
    roots = [
        home / ".claude" / "projects",
        home / ".config" / "claude" / "projects",
    ]
    extra = os.environ.get("CLAUDE_CONFIG_DIR", "")
    for part in extra.split(","):
        part = part.strip()
        if part:
            roots.append(Path(os.path.expanduser(part)) / "projects")
    return roots


def default_codex_roots() -> list[Path]:
    home = Path(os.environ.get("CODEX_HOME") or (Path.home() / ".codex"))
    return [home / "sessions", home / "archived_sessions"]


def scan(days: int, claude_roots: list[Path], codex_roots: list[Path]) -> dict[str, Any]:
    cutoff = now_utc() - timedelta(days=max(days, 1))
    sessions = scan_claude(claude_roots, cutoff) + scan_codex(codex_roots, cutoff)
    sessions.sort(key=lambda s: s.ended or s.started or now_utc(), reverse=True)
    return {
        "scannedAt": now_utc().isoformat(),
        "days": days,
        "cutoff": cutoff.isoformat(),
        "claudeRoots": [str(p) for p in claude_roots if p.exists()],
        "codexRoots": [str(p) for p in codex_roots if p.exists()],
        "sessions": [s.to_dict() for s in sessions],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan local Claude/Codex usage logs")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--json", action="store_true", default=True)
    parser.add_argument("--claude-root", action="append", default=[])
    parser.add_argument("--codex-root", action="append", default=[])
    args = parser.parse_args()
    claude = [Path(p) for p in args.claude_root] or default_claude_roots()
    codex = [Path(p) for p in args.codex_root] or default_codex_roots()
    result = scan(args.days, claude, codex)
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
