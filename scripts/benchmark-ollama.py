#!/usr/bin/env python3
"""Explicit local Ollama benchmark: synthetic requests only; no tools or user sessions.
Does load the configured model and may change its loaded context. Never unloads a model.
Writes timings/quality checks, not model responses or private configuration.
"""
import argparse
import json
import re
import statistics
import time
import urllib.request
from pathlib import Path


def request(base, route, body=None):
    data = None if body is None else json.dumps(body).encode()
    return urllib.request.urlopen(urllib.request.Request(base + "/api/" + route,
        data=data, headers={"Content-Type": "application/json"}), timeout=300)


def run(base, model, context, think, messages, expected):
    start = time.perf_counter()
    first_text = first_thinking = None
    text = ""
    final = {}
    with request(base, "chat", {"model": model, "messages": messages, "stream": True,
        "think": think, "options": {"num_ctx": context, "num_predict": 256,
        "temperature": 0, "seed": 42}, "truncate": False}) as response:
        for line in response:
            if not line.strip():
                continue
            part = json.loads(line)
            if part.get("error"):
                raise RuntimeError(part["error"])
            elapsed = round((time.perf_counter() - start) * 1000)
            msg = part.get("message", {})
            if msg.get("thinking") and first_thinking is None:
                first_thinking = elapsed
            if msg.get("content"):
                if first_text is None:
                    first_text = elapsed
                text += msg["content"]
            if part.get("done"):
                final = part
    if not final:
        raise RuntimeError("Incomplete Ollama stream")
    return {"context": context, "think": think, "wall_ms": round((time.perf_counter() - start) * 1000),
        "first_text_ms": first_text, "first_thinking_ms": first_thinking,
        "quality_ok": bool(re.fullmatch(re.escape(expected) + r"[.!]?", text.strip(), flags=re.IGNORECASE)), "done_reason": final.get("done_reason"),
        **{k: final.get(k) for k in ("total_duration", "load_duration", "prompt_eval_count", "prompt_eval_cached_count",
           "prompt_eval_duration", "eval_count", "eval_duration")}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:11434")
    parser.add_argument("--model", default="qwen3.8-27b-64k:latest")
    parser.add_argument("--contexts", nargs="+", type=int, default=[65536, 32768])
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--thinking", choices=["low", "off"], default="low")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.runs < 1 or any(c < 1024 for c in args.contexts):
        parser.error("Positive runs and contexts >=1024 required")
    if args.base_url.rstrip("/") not in ("http://127.0.0.1:11434", "http://localhost:11434"):
        parser.error("This benchmark only supports the local Ollama endpoint")
    if args.output.exists():
        parser.error("Output already exists; choose a new result file")
    think = False if args.thinking == "off" else "low"
    with request(args.base_url, "version") as response:
        version = json.load(response)
    with request(args.base_url, "show", {"model": args.model}) as response:
        show = json.load(response)
    supported = show.get("thinking", {}).get("values")
    if supported is not None and think not in supported:
        parser.error("Requested thinking mode is not supported by this model")
    result = {"model": args.model, "version": version, "details": show.get("details"), "runs": []}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    def save():
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    # Each context gets its own warm-up, kept separate from the measured runs.
    for context in args.contexts:
        messages = [{"role": "user", "content": "Wie viel ist 17 plus 25? Antworte nur mit der Zahl."}]
        warm = run(args.base_url, args.model, context, think, messages, "42")
        warm.update(case="arithmetic", warmup=True)
        result["runs"].append(warm)
        save()
        print(json.dumps(warm), flush=True)
        for index in range(args.runs):
            row = run(args.base_url, args.model, context, think, messages, "42")
            row.update(case="arithmetic", warmup=False, repetition=index + 1)
            result["runs"].append(row)
            save()
            print(json.dumps(row), flush=True)
    summaries = []
    for context in args.contexts:
        rows = [r for r in result["runs"] if r["context"] == context and not r["warmup"]]
        summaries.append({"context": context, "quality_ok": all(r["quality_ok"] for r in rows),
            "median_wall_ms": statistics.median(r["wall_ms"] for r in rows),
            "median_first_text_ms": statistics.median(r["first_text_ms"] for r in rows if r["first_text_ms"] is not None) if any(r["first_text_ms"] is not None for r in rows) else None})
    result["summaries"] = summaries
    save()
    print(json.dumps({"summaries": summaries}), flush=True)


if __name__ == "__main__":
    main()
