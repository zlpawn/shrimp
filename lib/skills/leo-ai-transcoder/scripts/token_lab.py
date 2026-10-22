# /// script
# requires-python = ">=3.9"
# dependencies = ["tiktoken>=0.7"]
# ///
"""Token 实测工具：讲解 Token / 分词相关的数值前，先在本机跑一遍。

用法（uv 会自动准备隔离环境）：
  uv run token_lab.py count "收到了" [--model gpt-4o | --encoding o200k_base]
  uv run token_lab.py models
  uv run token_lab.py probe "请把「龘」重复 10 遍" --max 1 2 3 4 [--model 模型id] [--param max_tokens] [--no-logprobs] [--extra JSON]

注意：推理模型的思考 Token 也计入输出上限，上限过小时文本会为空；可用 --extra 调低推理强度。

count 只用本地 tiktoken，不需要任何配置；它的词表只对 OpenAI 模型准确。
models / probe 调用兼容 OpenAI 规范的接口，需要配置：
  ~/.shrimp/skills/leo-ai-transcoder/credentials.json
  {"base_url": "https://<网关>/v1", "api_key": "<key>", "model": "<默认模型 id，可选>"}
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

STATE_DIR = Path.home() / ".shrimp" / "skills" / "leo-ai-transcoder"
CREDENTIALS = STATE_DIR / "credentials.json"
os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(STATE_DIR / "cache" / "tiktoken"))

SETUP_HINT = f"""未找到可用的接口配置：{CREDENTIALS}
如需调用真实接口，请创建该文件（建议 chmod 600），内容示例：
  {{"base_url": "https://<网关>/v1", "api_key": "<key>", "model": "<默认模型 id，可选>"}}
不配置也可以：count 命令只用本地词表，不受影响。base_url 和 api_key 可随时替换。"""


def load_credentials():
    try:
        cred = json.loads(CREDENTIALS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not cred.get("base_url") or not cred.get("api_key"):
        return None
    return cred


def show_bytes(bs):
    text = bytes(bs).decode("utf-8", errors="replace")
    return f"{list(bs)} -> {text!r}" + ("  ← 不完整的字" if "�" in text else "")


def cmd_count(args):
    import tiktoken

    enc = tiktoken.get_encoding(args.encoding) if args.encoding else tiktoken.encoding_for_model(args.model)
    ids = enc.encode(args.text)
    print(f"词表：{enc.name}（OpenAI 词表，只对 OpenAI 模型准确）")
    print(f"文本：{args.text!r}  字节数：{len(args.text.encode('utf-8'))}  Token 数：{len(ids)}")
    for i, tid in enumerate(ids, 1):
        print(f"  {i:>3}. id={tid:<7} {show_bytes(enc.decode_single_token_bytes(tid))}")


def call(cred, path, body=None):
    req = urllib.request.Request(
        cred["base_url"].rstrip("/") + path,
        data=None if body is None else json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {cred['api_key']}", "Content-Type": "application/json"},
        method="GET" if body is None else "POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}：{e.read().decode('utf-8', errors='replace')[:500]}")
    except urllib.error.URLError as e:
        sys.exit(f"连接失败：{e.reason}（检查 base_url 与网络 / VPN）")


def cmd_models(cred, args):
    try:
        data = call(cred, "/models")
    except RuntimeError as e:
        sys.exit(str(e))
    ids = sorted(m.get("id", "") for m in data.get("data", []))
    print(f"共 {len(ids)} 个模型：")
    for mid in ids:
        print(" ", mid)


def cmd_probe(cred, args):
    model = args.model or cred.get("model")
    if not model:
        sys.exit("未指定模型：用 --model 传入，或在 credentials.json 里填 model（可先运行 models 查看）")
    print(f"模型：{model}  上限参数：{args.param}")
    for limit in args.max:
        body = {"model": model, "messages": [{"role": "user", "content": args.text}], args.param: limit, **args.extra}
        if not args.no_logprobs:
            body["logprobs"] = True
        try:
            data = call(cred, "/chat/completions", body)
        except RuntimeError as e:
            print(f"\n── {args.param}={limit}  接口报错（截断时有的模型 / 网关会直接报错）：{e}")
            continue
        choice = data["choices"][0]
        content = choice["message"].get("content") or ""
        print(f"\n── {args.param}={limit}  finish_reason={choice.get('finish_reason')}  usage={data.get('usage')}")
        print(f"   文本：{content!r}  末尾字符码点：{[hex(ord(c)) for c in content[-2:]]}")
        tokens = ((choice.get("logprobs") or {}).get("content")) or []
        if not tokens and not args.no_logprobs:
            print("   logprobs：接口未返回")
        for i, t in enumerate(tokens, 1):
            print(f"   {i:>3}. {show_bytes(t['bytes']) if t.get('bytes') is not None else repr(t.get('token'))}")


def main():
    p = argparse.ArgumentParser(description="Token 实测工具")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("count", help="用本地 tiktoken 切分文本")
    c.add_argument("text")
    g = c.add_mutually_exclusive_group()
    g.add_argument("--model", default="gpt-4o")
    g.add_argument("--encoding")
    sub.add_parser("models", help="列出接口可用模型")
    pr = sub.add_parser("probe", help="按多个输出上限调用接口，观察截断")
    pr.add_argument("text")
    pr.add_argument("--max", type=int, nargs="+", default=[1, 2, 3, 4])
    pr.add_argument("--model")
    pr.add_argument("--param", default="max_completion_tokens", help="OpenAI 新参数；兼容厂商可能只认 max_tokens")
    pr.add_argument("--no-logprobs", action="store_true")
    pr.add_argument("--extra", type=json.loads, default={}, help='附加请求参数（JSON），如 \'{"reasoning_effort": "minimal"}\'')
    args = p.parse_args()

    if args.cmd == "count":
        return cmd_count(args)
    cred = load_credentials()
    if cred is None:
        sys.exit(SETUP_HINT)
    {"models": cmd_models, "probe": cmd_probe}[args.cmd](cred, args)


if __name__ == "__main__":
    main()
