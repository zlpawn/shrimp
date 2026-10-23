import os
import json
import re
from pathlib import Path

DEFAULT_CONFIG_DIR = Path.home() / ".shrimp" / "skills" / "leo-autodl-imagine-video"
CONFIG_FILE = DEFAULT_CONFIG_DIR / "config.json"
DEFAULT_OUTPUT_DIR = DEFAULT_CONFIG_DIR / "outputs"


def get_config_path() -> Path:
    DEFAULT_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    return CONFIG_FILE


def get_default_output_dir() -> Path:
    DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return DEFAULT_OUTPUT_DIR


def load_config() -> dict:
    cfg_path = get_config_path()
    if not cfg_path.exists():
        return {}
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[ConfigManager] Error reading config: {e}")
        return {}


def save_config(config: dict) -> bool:
    cfg_path = get_config_path()
    try:
        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[ConfigManager] Error saving config: {e}")
        return False


def parse_ssh_command(ssh_cmd: str) -> dict:
    """
    解析类似 'ssh -p 52742 root@connect.westd.seetacloud.com' 的指令
    """
    pattern = r"ssh\s+(?:-p\s+(\d+)\s+)?([a-zA-Z0-9_\-]+)@([a-zA-Z0-9.\-]+)(?:\s+-p\s+(\d+))?"
    m = re.search(pattern, ssh_cmd.strip())
    if not m:
        raise ValueError(f"无法识别的 SSH 登录指令: {ssh_cmd}")
    port1, user, host, port2 = m.groups()
    port = int(port1 or port2 or 22)
    return {
        "host": host,
        "port": port,
        "user": user
    }


def update_credentials(
    ssh_cmd: str = None,
    password: str = None,
    host: str = None,
    port: int = None,
    user: str = "root",
    token: str = None,
    instance_uuid: str = None
) -> dict:
    config = load_config()
    if ssh_cmd:
        parsed = parse_ssh_command(ssh_cmd)
        config.update(parsed)
    if host:
        config["host"] = host
    if port:
        config["port"] = int(port)
    if user:
        config["user"] = user
    if password:
        config["password"] = password
    if token:
        config["token"] = token
    if instance_uuid:
        config["instance_uuid"] = instance_uuid

    if "remote_port" not in config:
        config["remote_port"] = 6006

    save_config(config)
    return config
