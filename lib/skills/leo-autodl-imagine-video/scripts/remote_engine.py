import os
import json
import time
import random
from pathlib import Path
import paramiko
import requests
import urllib3

urllib3.disable_warnings()

from config_manager import get_default_output_dir

ASPECT_RATIO_MAP = {
    "1:1": "1:1 (Square)",
    "2:3": "2:3 (Portrait Photo)",
    "3:2": "3:2 (Photo)",
    "3:4": "3:4 (Portrait Standard)",
    "4:3": "4:3 (Standard)",
    "9:16": "9:16 (Portrait Widescreen)",
    "16:9": "16:9 (Widescreen)",
    "21:9": "21:9 (Ultrawide)",
}


DEFAULT_RENDER_TIMEOUT = 1800
MEDIA_NODE = "VRGDG_MiniMaxH3ReferenceMediaFromPaths"
INJECTED_MEDIA_NODE_ID = "9001"


def bind_reference_media(wf: dict, remote_imgs: list, remote_vids: list) -> bool:
    """
    把参考图/视频绑定到工作流。没有媒体节点、但有 MiniMaxH3ReferenceToVideo 时（如生图模板），
    按已验证的生视频模板同样的连线补一个。没有可绑定的节点时返回 False。
    """
    nodes = [n for n in wf.values() if isinstance(n, dict)]
    media = [n for n in nodes if n.get("class_type") == MEDIA_NODE]
    if not media:
        targets = [n for n in nodes if n.get("class_type") == "MiniMaxH3ReferenceToVideo"]
        if not targets:
            return False
        wf[INJECTED_MEDIA_NODE_ID] = {"class_type": MEDIA_NODE, "inputs": {"image_paths": "[]", "video_references": "[]"}}
        media = [wf[INJECTED_MEDIA_NODE_ID]]
        for node in targets:
            for i in range(9):
                node["inputs"][f"ref_images.ref_image_{i}"] = [INJECTED_MEDIA_NODE_ID, i]
            for i in range(3):
                node["inputs"][f"ref_videos.ref_video_{i}"] = [INJECTED_MEDIA_NODE_ID, 9 + i]
    for node in media:
        if remote_imgs:
            node["inputs"]["image_paths"] = json.dumps(remote_imgs)
        if remote_vids:
            node["inputs"]["video_references"] = json.dumps(remote_vids)
    return True


def apply_workflow_patches(wf: dict, patches: dict) -> dict:
    """
    对 ComfyUI API 工作流 JSON 进行动态节点属性覆盖或新增节点。
    支持三种格式：
    1. 点号路径: {"141.inputs.model_name": "minimax/FeiHou_...", "174.inputs.reuse_threshold": 0.1}
    2. 冒号简写 (兼容 _api_config): {"139:prompt": "...", "141:value": 5}
    3. 完整节点注入: {"160": {"class_type": "LoraLoaderModelOnly", "inputs": {...}}}
    """
    if not patches:
        return wf
    for key, val in patches.items():
        if ":" in key and "." not in key:
            nid, field = key.split(":", 1)
            if nid in wf and isinstance(wf[nid], dict):
                wf[nid].setdefault("inputs", {})[field] = val
        elif "." in key:
            parts = key.split(".")
            curr = wf
            for p in parts[:-1]:
                if p not in curr or not isinstance(curr[p], dict):
                    curr[p] = {}
                curr = curr[p]
            curr[parts[-1]] = val
        else:
            if val is None and key in wf:
                del wf[key]
            elif isinstance(val, dict):
                wf[key] = val
    return wf


class AutoDLRemoteEngine:
    API_BASE = "https://www.autodl.art"

    def __init__(self, config: dict):
        self.config = config
        self.host = config.get("host")
        self.port = int(config.get("port", 22))
        self.user = config.get("user", "root")
        self.password = config.get("password")
        self.remote_port = int(config.get("remote_port", 6006))
        self.token = config.get("token")
        self.instance_uuid = config.get("instance_uuid")
        self.skill_root = Path(__file__).resolve().parent.parent
        self.workflows_dir = self.skill_root / "references" / "workflows"

    def _api_headers(self) -> dict:
        return {
            "Authorization": self.token or "",
            "Content-Type": "application/json"
        }

    # ==================== 1. AutoDL 官方 OpenAPI 管理接口 ====================

    def get_instance_status(self) -> dict:
        """
        调用官方 OpenAPI 获取实例当前运行状态
        GET https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/status?instance_uuid={uuid}
        """
        if not self.token or not self.instance_uuid:
            return {"ok": False, "message": "未配置 token 或 instance_uuid"}
        url = f"{self.API_BASE}/api/v1/adl_dev/dev/instance/pro/status?instance_uuid={self.instance_uuid}"
        try:
            r = requests.get(url, headers=self._api_headers(), timeout=8)
            res = r.json()
            if res.get("code") == "Success":
                return {"ok": True, "status": res.get("data")}
            return {"ok": False, "message": res.get("msg", "获取状态失败")}
        except Exception as e:
            return {"ok": False, "message": f"API 请求异常: {e}"}

    def refresh_credentials_from_api(self) -> dict:
        """
        从官方 OpenAPI 刷新最新的动态 SSH 主机、端口与密码并同步到本地 config.json
        GET https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/snapshot?instance_uuid={uuid}
        """
        if not self.token or not self.instance_uuid:
            return {"ok": False, "message": "未配置 token 或 instance_uuid"}
        url = f"{self.API_BASE}/api/v1/adl_dev/dev/instance/pro/snapshot?instance_uuid={self.instance_uuid}"
        try:
            r = requests.get(url, headers=self._api_headers(), timeout=10)
            res = r.json()
            if res.get("code") == "Success":
                data = res.get("data", {})
                self.host = data.get("proxy_host", self.host)
                self.port = int(data.get("ssh_port", self.port))
                self.password = data.get("root_password", self.password)

                from config_manager import update_credentials
                update_credentials(host=self.host, port=self.port, password=self.password)
                return {
                    "ok": True,
                    "host": self.host,
                    "port": self.port,
                    "ssh_command": data.get("ssh_command"),
                    "message": f"凭证刷新成功: {self.host}:{self.port}"
                }
            return {"ok": False, "message": res.get("msg", "刷新凭证失败")}
        except Exception as e:
            return {"ok": False, "message": f"API 请求异常: {e}"}

    def power_on(self, wait_seconds: int = 45) -> dict:
        """
        通过官方 OpenAPI 远程开机实例（有卡模式 payload="gpu"）并自动刷新动态 SSH 端口
        POST https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/power_on
        """
        if not self.token or not self.instance_uuid:
            return {"ok": False, "message": "未配置 token 或 instance_uuid，无法调用开机 API"}
        url = f"{self.API_BASE}/api/v1/adl_dev/dev/instance/pro/power_on"
        payload = {"instance_uuid": self.instance_uuid, "payload": "gpu"}
        try:
            r = requests.post(url, headers=self._api_headers(), json=payload, timeout=10)
            res = r.json()
            if res.get("code") != "Success":
                return {"ok": False, "message": f"开机请求失败: {res.get('msg')}"}

            start_t = time.time()
            while time.time() - start_t < wait_seconds:
                time.sleep(3)
                status_res = self.get_instance_status()
                if status_res.get("status") == "running":
                    self.refresh_credentials_from_api()
                    return {
                        "ok": True,
                        "host": self.host,
                        "port": self.port,
                        "message": f"实例已成功开机！当前状态: running，连接地址: {self.host}:{self.port}"
                    }
            return {"ok": True, "message": "开机指令已下发，实例启动中，请稍候 10 秒后执行探活。"}
        except Exception as e:
            return {"ok": False, "message": f"开机调用异常: {e}"}

    def poll_power_on(self, interval_seconds: int = 3, max_attempts: int = 300, wait_seconds: int = 45) -> dict:
        """
        以指定间隔（默认 3 秒）持续高频轮询向官方 OpenAPI 发起开机请求，直到抢到物理 GPU 库存并成功开机
        """
        import time
        if not self.token or not self.instance_uuid:
            return {"ok": False, "message": "未配置 token 或 instance_uuid，无法调用开机 API"}
        url = f"{self.API_BASE}/api/v1/adl_dev/dev/instance/pro/power_on"
        payload = {"instance_uuid": self.instance_uuid, "payload": "gpu"}
        for attempt in range(1, max_attempts + 1):
            try:
                r = requests.post(url, headers=self._api_headers(), json=payload, timeout=10)
                res = r.json()
                if res.get("code") == "Success":
                    start_t = time.time()
                    while time.time() - start_t < wait_seconds:
                        time.sleep(3)
                        status_res = self.get_instance_status()
                        if status_res.get("status") == "running":
                            self.refresh_credentials_from_api()
                            # 持续探活直到 ComfyUI 进程完全就绪
                            probe_ok = False
                            for _ in range(12):
                                time.sleep(3)
                                p = self.probe()
                                if p.get("ok"):
                                    probe_ok = True
                                    break
                            return {
                                "ok": True,
                                "attempts": attempt,
                                "host": self.host,
                                "port": self.port,
                                "comfy_ready": probe_ok,
                                "message": f"第 {attempt} 次轮询抢卡成功！实例已开机且 ComfyUI 完全就绪，连接地址: {self.host}:{self.port}"
                            }
                    return {"ok": True, "attempts": attempt, "message": f"第 {attempt} 次开机指令已下发，实例启动中。"}
                msg = res.get("msg", "未知原因")
                if attempt % 6 == 1 or attempt == 1:
                    print(f"[{time.strftime('%H:%M:%S')}] 第 {attempt} 次抢卡轮询中: {msg}（{interval_seconds}s 后重试）", flush=True)
            except Exception as e:
                print(f"[{time.strftime('%H:%M:%S')}] 第 {attempt} 次请求异常: {e}", flush=True)
            time.sleep(interval_seconds)
        return {"ok": False, "attempts": max_attempts, "message": f"已达到最大轮询次数 {max_attempts} 次，暂未抢到显卡库存。"}

    def power_off(self, confirm: bool = False) -> dict:
        """
        通过官方 OpenAPI 远程关机实例（释放 GPU 并停止计费）
        【关机规则】：
        - 中途阶段（仅生图、多镜头中间分镜、交互调试）严禁私自关机，须先获用户确认；
        - 当整个完整视频（最终成片）已全部生成并下载回本地后，可直接传入 confirm=True 自动关机停费。
        POST https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/power_off
        """
        if not confirm:
            return {
                "ok": False,
                "error_type": "CONFIRMATION_REQUIRED",
                "message": "拒绝执行：若处于中途阶段（生图/分镜未全部完成）请先向用户确认；若完整视频已全部生成完毕，请传入 confirm=True 或 --confirm 执行关机。"
            }
        if not self.token or not self.instance_uuid:
            return self.shutdown_via_ssh()
        url = f"{self.API_BASE}/api/v1/adl_dev/dev/instance/pro/power_off"
        payload = {"instance_uuid": self.instance_uuid}
        try:
            r = requests.post(url, headers=self._api_headers(), json=payload, timeout=10)
            res = r.json()
            if res.get("code") == "Success":
                return {"ok": True, "message": "已通过 AutoDL 官方 API 成功关机，实例已停止计费！"}
            return self.shutdown_via_ssh()
        except Exception:
            return self.shutdown_via_ssh()

    def shutdown_via_ssh(self) -> dict:
        """通过 SSH 异步执行系统关机兜底"""
        client = None
        try:
            client = self.connect_ssh(timeout=5)
            client.exec_command("nohup bash -c 'sleep 1 && (poweroff || shutdown -h now)' > /dev/null 2>&1 &")
            return {
                "ok": True,
                "message": f"已成功向机器 ({self.host}:{self.port}) 发送系统关机指令！机器将在数秒内关机停止计费。"
            }
        except Exception as e:
            return {"ok": False, "message": f"发送关机指令失败: {e}"}
        finally:
            if client:
                client.close()

    # ==================== 2. SSH 与 ComfyUI 自省 / 工作流发现引擎 ====================

    def connect_ssh(self, timeout=8) -> paramiko.SSHClient:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=self.host,
            port=self.port,
            username=self.user,
            password=self.password,
            timeout=timeout
        )
        transport = client.get_transport()
        if transport:
            transport.set_keepalive(15)
        return client

    def probe(self) -> dict:
        """
        探测云端实例连通性、GPU 算力与 ComfyUI 服务 (GET http://127.0.0.1:6006/system_stats)
        具备自动自愈能力：若 SSH 连接失败且配置了 OpenAPI Token，自动查询实例状态并刷新动态端口
        """
        if not self.host or not self.password:
            if self.token and self.instance_uuid:
                refreshed = self.refresh_credentials_from_api()
                if not refreshed.get("ok"):
                    return {
                        "ok": False,
                        "error_type": "CREDENTIAL_REFRESH_FAILED",
                        "message": f"用 token 获取实例连接信息失败：{refreshed.get('message')}。请检查 token 和 instance_uuid 是否正确、是否过期。"
                    }
            if not self.host or not self.password:
                return {
                    "ok": False,
                    "error_type": "CONFIG_MISSING",
                    "message": "未配置 AutoDL 连接信息。请配置 token 和 instance_uuid（SSH 地址和密码会自动获取）。"
                }

        client = None
        try:
            client = self.connect_ssh(timeout=6)
        except Exception as e:
            if self.token and self.instance_uuid:
                status_res = self.get_instance_status()
                if status_res.get("ok"):
                    current_status = status_res.get("status")
                    if current_status != "running":
                        return {
                            "ok": False,
                            "error_type": "INSTANCE_STOPPED",
                            "message": f"当前 AutoDL 实例处于【{current_status}】状态。可执行 --power-on 或 client.power_on() 一键远程开机。"
                        }
                    else:
                        ref_res = self.refresh_credentials_from_api()
                        if ref_res.get("ok"):
                            try:
                                client = self.connect_ssh(timeout=6)
                            except Exception:
                                pass

            if not client:
                return {
                    "ok": False,
                    "error_type": "SSH_FAILED",
                    "message": f"无法连通 AutoDL 实例（Host: {self.host}, Port: {self.port}）。原因: {str(e)}。请向用户索取最新的 SSH 登录指令和密码，或使用 power_on 启动实例。"
                }

        try:
            stdin, stdout, stderr = client.exec_command("nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits")
            gpu_line = stdout.read().decode("utf-8", errors="replace").strip()

            stdin, stdout, stderr = client.exec_command(f"curl -s http://127.0.0.1:{self.remote_port}/system_stats")
            comfy_stats = stdout.read().decode("utf-8", errors="replace").strip()

            comfy_running = False
            if comfy_stats and "comfyui_version" in comfy_stats:
                comfy_running = True
            else:
                # 触发启动或等待开机自动拉起脚本（加载大量节点通常需要 15~35 秒）
                client.exec_command("nohup bash /root/zealman-app/start-comfyui.sh > /dev/null 2>&1 &")
                for _ in range(15):
                    time.sleep(3)
                    stdin, stdout, stderr = client.exec_command(f"curl -s http://127.0.0.1:{self.remote_port}/system_stats")
                    comfy_stats = stdout.read().decode("utf-8", errors="replace").strip()
                    if comfy_stats and "comfyui_version" in comfy_stats:
                        comfy_running = True
                        break

            gpu_name = "Unknown GPU"
            vram_total = "0"
            if gpu_line:
                parts = gpu_line.split(",")
                if len(parts) >= 2:
                    gpu_name = parts[0].strip()
                    vram_total = parts[1].strip() + " MiB"

            if not comfy_running:
                return {
                    "ok": False,
                    "error_type": "COMFY_DOWN",
                    "message": f"已成功连入服务器 ({gpu_name})，但 ComfyUI 进程未响应端口 {self.remote_port}，请检查远端服务。"
                }

            return {
                "ok": True,
                "host": self.host,
                "port": self.port,
                "gpu": gpu_name,
                "vram_total": vram_total,
                "comfy_port": self.remote_port,
                "message": f"连接正常！GPU: {gpu_name}, 显存: {vram_total}"
            }
        except Exception as e:
            return {"ok": False, "error_type": "PROBE_FAILED", "message": f"探测服务异常: {str(e)}"}
        finally:
            if client:
                client.close()

    def inspect_node(self, node_class: str) -> dict:
        """
        调用远端 ComfyUI GET /object_info/{node_class} 查看任意节点的完整输入槽位、参数范围与枚举项
        供 Agent 在动态构建或调整工作流时进行自省查询
        """
        probe_res = self.probe()
        if not probe_res["ok"]:
            return probe_res

        client = self.connect_ssh()
        try:
            _, stdout, _ = client.exec_command(f"curl -s http://127.0.0.1:{self.remote_port}/object_info/{node_class}")
            raw = stdout.read().decode("utf-8", errors="replace").strip()
            if not raw:
                return {"ok": False, "message": f"未找到节点 {node_class} 的定义"}
            data = json.loads(raw)
            if node_class not in data:
                return {"ok": False, "message": f"ComfyUI 中不存在节点类型: {node_class}"}
            return {
                "ok": True,
                "node_class": node_class,
                "schema": data[node_class],
                "message": f"成功获取节点 {node_class} 的 Schema 定义"
            }
        except Exception as e:
            return {"ok": False, "message": f"查询节点 Schema 异常: {e}"}
        finally:
            client.close()

    def list_models(self, category: str = "all", filter_keyword: str = "minimax") -> dict:
        """
        查询远端 ComfyUI 挂载的 MiniMax-H3 相关模型清单 (GET /object_info/{node_class})
        category 可选: "all" | "diffusion_models" | "clips" | "vaes" | "loras"
        filter_keyword: 默认过滤包含 "minimax" / "h3" / "qwen3vl" 的权重，传 "" 则返回全部
        """
        probe_res = self.probe()
        if not probe_res["ok"]:
            return probe_res

        node_map = {
            "diffusion_models": ("DiffusionModelLoaderKJ", "model_name"),
            "clips": ("CLIPLoader", "clip_name"),
            "vaes": ("VAELoader", "vae_name"),
            "loras": ("LoraLoaderModelOnly", "lora_name"),
        }
        targets = node_map.keys() if category == "all" else [category]
        client = self.connect_ssh()
        inventory = {}
        try:
            for key in targets:
                if key not in node_map:
                    continue
                node_cls, field_name = node_map[key]
                _, stdout, _ = client.exec_command(f"curl -s http://127.0.0.1:{self.remote_port}/object_info/{node_cls}")
                raw = stdout.read().decode("utf-8", errors="replace").strip()
                if raw:
                    data = json.loads(raw)
                    req_fields = data.get(node_cls, {}).get("input", {}).get("required", {})
                    if field_name in req_fields and isinstance(req_fields[field_name], list) and len(req_fields[field_name]) > 0:
                        items = req_fields[field_name][0]
                        if filter_keyword:
                            kw_list = [k.lower() for k in filter_keyword.split("|")] + ["h3", "qwen3vl", "taeh3"]
                            items = [m for m in items if any(k in m.lower() for k in kw_list)]
                        inventory[key] = items
            return {
                "ok": True,
                "models": inventory,
                "message": f"成功获取 MiniMax-H3 模型资产 ({', '.join(f'{k}: {len(v)}个' for k, v in inventory.items())})"
            }
        except Exception as e:
            return {"ok": False, "message": f"查询模型列表异常: {e}"}
        finally:
            client.close()

    def list_remote_workflows(self) -> dict:
        """
        列出 AutoDL 远端镜像预置的两大成熟 MiniMax-H3 工作流库：
        1. /root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/ (43+ 社区精调工作流 U00~U43)
        2. /root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/ (VRGDG 官方 API 模板)
        """
        probe_res = self.probe()
        if not probe_res["ok"]:
            return probe_res

        client = self.connect_ssh()
        try:
            cmd = (
                "ls -1 /root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/*.json 2>/dev/null; "
                "ls -1 /root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/*minimax*.json 2>/dev/null"
            )
            _, stdout, _ = client.exec_command(cmd)
            lines = [line.strip() for line in stdout.read().decode("utf-8", errors="replace").splitlines() if line.strip()]
            return {
                "ok": True,
                "count": len(lines),
                "remote_workflows": lines,
                "message": f"共发现 {len(lines)} 个远端预置 MiniMax-H3 成熟工作流"
            }
        except Exception as e:
            return {"ok": False, "message": f"列出远端工作流失败: {e}"}
        finally:
            client.close()

    def fetch_remote_workflow(self, remote_path: str, save_to: str = None) -> dict:
        """
        从 AutoDL 远端拉取指定成熟工作流 JSON 文件到本地，供 Agent 分析节点配置或转化为标准 API 模板沉淀
        """
        probe_res = self.probe()
        if not probe_res["ok"]:
            return probe_res

        client = self.connect_ssh()
        try:
            sftp = client.open_sftp()
            local_dst = Path(save_to) if save_to else (get_default_output_dir() / Path(remote_path).name)
            local_dst.parent.mkdir(parents=True, exist_ok=True)
            sftp.get(remote_path, str(local_dst))
            sftp.close()
            return {
                "ok": True,
                "remote_path": remote_path,
                "local_path": str(local_dst.resolve()),
                "message": f"已将远端工作流下载至: {local_dst.resolve()}"
            }
        except Exception as e:
            return {"ok": False, "message": f"拉取远端工作流失败: {e}"}
        finally:
            client.close()

    def _upload_media_files(self, client: paramiko.SSHClient, local_files: list) -> list:
        """通过 SFTP 将本地参考图或参考视频上传至远端 /root/ComfyUI/input/ 并返回远端绝对路径列表"""
        remote_paths = []
        if not local_files:
            return remote_paths
        sftp_up = client.open_sftp()
        try:
            for lf in local_files:
                p = Path(lf)
                remote_target = f"/root/ComfyUI/input/{p.name}"
                sftp_up.put(str(p), remote_target)
                remote_paths.append(remote_target)
        finally:
            sftp_up.close()
        return remote_paths

    def _comfy_post(self, client: paramiko.SSHClient, path: str, body: str = "{}") -> None:
        cmd = f"curl -s -X POST http://127.0.0.1:{self.remote_port}{path} -H 'Content-Type: application/json' -d '{body}'"
        _, stdout, _ = client.exec_command(cmd, timeout=15)
        stdout.read()

    def _cancel_prompt(self, client: paramiko.SSHClient, prompt_id: str) -> None:
        """超时后取消这个任务，否则它留在远端继续占显卡，还会挡住下一个任务。"""
        try:
            self._comfy_post(client, "/queue", json.dumps({"delete": [prompt_id]}))
            self._comfy_post(client, "/interrupt")
        except Exception:
            pass  # 连接已断；留给 --interrupt 处理

    def interrupt_queue(self) -> dict:
        """中断正在跑的任务并清空等待队列（本地进程被杀后，远端任务还会继续跑）"""
        try:
            client = self.connect_ssh()
        except Exception as e:
            return {"ok": False, "message": f"无法连接实例: {e}"}
        try:
            self._comfy_post(client, "/queue", json.dumps({"clear": True}))
            self._comfy_post(client, "/interrupt")
            _, stdout, _ = client.exec_command(f"curl -s http://127.0.0.1:{self.remote_port}/queue", timeout=15)
            queue = json.loads(stdout.read().decode("utf-8", errors="replace") or "{}")
            running, pending = len(queue.get("queue_running", [])), len(queue.get("queue_pending", []))
            return {"ok": True, "running": running, "pending": pending, "message": f"已中断并清空队列（运行中 {running}，等待 {pending}）"}
        except Exception as e:
            return {"ok": False, "message": f"中断失败: {e}"}
        finally:
            client.close()

    # ==================== 3. 通用 ComfyUI 工作流构建、微调与执行引擎 ====================

    def load_workflow_template(self, workflow_name_or_path: str) -> dict:
        """
        加载工作流 JSON：
        1. 优先匹配本地 references/workflows/<name>.json 或 references/workflows/u_series_api/<name>.json
        2. 其次匹配传入的本地文件绝对/相对路径
        """
        for base in (self.workflows_dir, self.workflows_dir / "u_series_api"):
            candidate = base / workflow_name_or_path
            if not candidate.suffix:
                candidate = base / f"{workflow_name_or_path}.json"
            if candidate.exists():
                return json.loads(candidate.read_text(encoding="utf-8"))

        direct = Path(workflow_name_or_path)
        if direct.exists():
            return json.loads(direct.read_text(encoding="utf-8"))

        raise FileNotFoundError(f"未找到工作流文件: {workflow_name_or_path} (已检查 {self.workflows_dir} 与本地路径)")

    def run_workflow(
        self,
        workflow,
        patches: dict = None,
        reference_images: list = None,
        reference_videos: list = None,
        output_dir: str = None,
        timeout_seconds: int = DEFAULT_RENDER_TIMEOUT
    ) -> dict:
        """
        通用 ComfyUI API 工作流执行器（支持任意自定义或预设 MiniMax-H3 工作流）：
        1. 加载基准或自定义工作流 JSON
        2. 自动通过 SFTP 上传参考图/参考视频并绑定至 VRGDG_MiniMaxH3ReferenceMediaFromPaths 节点
        3. 应用 patches 动态修改任意节点参数或注入新节点（如 LoRA、EasyCache 阈值、二采节点）
        4. 提交至 POST http://127.0.0.1:6006/prompt 并轮询 /history/{prompt_id}
        5. 将产出的图片/视频自动回传至暂存目录 ~/.shrimp/skills/leo-autodl-imagine-video/outputs/
        """
        missing = [f for f in (reference_images or []) + (reference_videos or []) if not Path(f).exists()]
        if missing:
            return {"ok": False, "error_type": "REF_FILE_MISSING", "message": f"参考文件不存在: {missing}"}

        probe_res = self.probe()
        if not probe_res["ok"]:
            return probe_res

        if isinstance(workflow, str):
            try:
                wf = self.load_workflow_template(workflow)
            except Exception as e:
                return {"ok": False, "message": str(e)}
        elif isinstance(workflow, dict):
            wf = json.loads(json.dumps(workflow))
        else:
            return {"ok": False, "message": "无效的 workflow 参数类型"}

        target_output_dir = Path(output_dir) if output_dir else get_default_output_dir()
        client = self.connect_ssh()
        try:
            # 1. 上传参考图与参考视频
            remote_imgs = self._upload_media_files(client, reference_images)
            remote_vids = self._upload_media_files(client, reference_videos)

            warnings = []
            if (remote_imgs or remote_vids) and not bind_reference_media(wf, remote_imgs, remote_vids):
                uploaded = [Path(f).name for f in (reference_images or []) + (reference_videos or [])]
                warnings.append(f"工作流没有可自动绑定参考素材的节点，{uploaded} 只上传到了 /root/ComfyUI/input/，要用 --patch 指定给对应节点。")

            # 2. 应用动态节点补丁 (Patches)
            if patches:
                wf = apply_workflow_patches(wf, patches)

            # 剥离非 ComfyUI 节点的元数据字段 (如 u_series_api 中的 _api_config)
            wf.pop("_api_config", None)

            # 3. 提交工作流至 ComfyUI POST /prompt
            payload_json = json.dumps({"prompt": wf})
            submit_cmd = f"""/root/miniconda3/bin/python -c '
import urllib.request, json, sys
data = sys.stdin.read().encode("utf-8")
req = urllib.request.Request("http://127.0.0.1:{self.remote_port}/prompt", data=data, headers={{"Content-Type": "application/json"}})
try:
    resp = urllib.request.urlopen(req)
    print(resp.read().decode())
except urllib.error.HTTPError as e:
    print(e.read().decode())
' """
            stdin, stdout, stderr = client.exec_command(submit_cmd)
            stdin.write(payload_json)
            stdin.channel.shutdown_write()

            submit_res = stdout.read().decode("utf-8", errors="replace").strip()
            res_data = json.loads(submit_res)
            prompt_id = res_data.get("prompt_id")
            if not prompt_id:
                return {"ok": False, "message": f"ComfyUI 工作流提交失败: {submit_res}"}

            # 4. 轮询 /history/{prompt_id}（带断线自愈重连）
            start_time = time.time()
            output_filenames = []
            finished = False
            while time.time() - start_time < timeout_seconds:
                time.sleep(4.0)
                history_str = ""
                try:
                    _, stdout, _ = client.exec_command(f"curl -s http://127.0.0.1:{self.remote_port}/history/{prompt_id}", timeout=15)
                    history_str = stdout.read().decode("utf-8", errors="replace").strip()
                except Exception as poll_e:
                    # SSH 抖动自愈：重新连接 SSH 保持轮询
                    try:
                        client.close()
                    except Exception:
                        pass
                    time.sleep(3)
                    try:
                        client = self.connect_ssh(timeout=10)
                    except Exception:
                        pass
                    continue

                if prompt_id in history_str:
                    try:
                        history = json.loads(history_str)
                    except Exception:
                        continue
                    item_hist = history.get(prompt_id, {})
                    status_info = item_hist.get("status", {})
                    if status_info.get("status_str") == "error":
                        return {"ok": False, "prompt_id": prompt_id, "message": f"ComfyUI 执行报错: {json.dumps(status_info, ensure_ascii=False)}"}
                    outputs = item_hist.get("outputs", {})
                    for nid, nout in outputs.items():
                        for media_key in ("videos", "gifs", "images"):
                            if media_key in nout:
                                for it in nout[media_key]:
                                    if it.get("type", "output") == "output":
                                        output_filenames.append(it["filename"])
                    finished = True
                    break

            if not finished:
                self._cancel_prompt(client, prompt_id)
                return {
                    "ok": False,
                    "error_type": "RENDER_TIMEOUT",
                    "prompt_id": prompt_id,
                    "message": f"渲染超过 {timeout_seconds} 秒，已取消远端任务。长工作流用 --timeout 加大时限。"
                }
            if not output_filenames:
                return {"ok": False, "error_type": "NO_OUTPUT", "prompt_id": prompt_id, "message": f"工作流已结束，但没有输出文件 (Prompt ID: {prompt_id})"}

            # 5. SFTP 下载产物至本地暂存目录（带重连重试）
            target_output_dir.mkdir(parents=True, exist_ok=True)
            local_paths = []
            for fname in output_filenames:
                remote_file = f"/root/ComfyUI/output/{fname}"
                local_file = str(target_output_dir / fname)
                for dl_attempt in range(3):
                    try:
                        sftp = client.open_sftp()
                        sftp.get(remote_file, local_file)
                        sftp.close()
                        local_paths.append(local_file)
                        break
                    except Exception as sftp_e:
                        try:
                            client.close()
                        except Exception:
                            pass
                        time.sleep(2)
                        client = self.connect_ssh(timeout=10)
                        if dl_attempt == 2:
                            raise sftp_e

            elapsed = round(time.time() - start_time, 1)
            result = {
                "ok": True,
                "prompt_id": prompt_id,
                "elapsed_seconds": elapsed,
                "staging_dir": str(target_output_dir),
                "output_files": local_paths,
                "message": f"MiniMax-H3 工作流执行完成 (耗时 {elapsed}s，产物已存入暂存目录 {target_output_dir})"
            }
            if warnings:
                result["warnings"] = warnings
            return result
        except Exception as e:
            return {"ok": False, "message": f"工作流执行异常: {str(e)}"}
        finally:
            client.close()

    # ==================== 4. MiniMax-H3 生图与生视频快捷入口 ====================

    def generate_image(
        self,
        prompt: str,
        width: int = 1280,
        height: int = 736,
        steps: int = 12,
        cfg: float = 1.0,
        sampler_name: str = "euler",
        scheduler: str = "beta",
        seed: int = None,
        reference_images: list = None,
        ref_image_size: str = "match",
        diffusion_model: str = "minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors",
        clip_model: str = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        video_vae: str = "minimax_h3_video_vae_fp16.safetensors",
        workflow_template: str = "minimax_h3_image_u33_api.json",
        extra_patches: dict = None,
        output_dir: str = None,
        timeout_seconds: int = DEFAULT_RENDER_TIMEOUT
    ) -> dict:
        """
        基于成熟工作流 minimax_h3_image_u33_api.json 执行 MiniMax-H3 生图 / 多图参考编辑 / 宫格分镜生成
        同时支持通过 extra_patches 动态调整任意节点
        """
        if seed is None:
            seed = random.randint(100000, 999999999)

        patches = {
            "1.inputs.model_name": diffusion_model,
            "2.inputs.clip_name": clip_model,
            "3.inputs.vae_name": video_vae,
            "4.inputs.prompt": prompt,
            "4.inputs.width": int(width),
            "4.inputs.height": int(height),
            "4.inputs.ref_image_size": ref_image_size,
            "6.inputs.seed": int(seed),
            "6.inputs.steps": int(steps),
            "6.inputs.cfg": float(cfg),
            "6.inputs.sampler_name": sampler_name,
            "6.inputs.scheduler": scheduler,
        }
        if extra_patches:
            patches.update(extra_patches)

        res = self.run_workflow(
            workflow=workflow_template,
            patches=patches,
            reference_images=reference_images,
            output_dir=output_dir,
            timeout_seconds=timeout_seconds
        )
        if res.get("ok"):
            res.update({
                "task_type": "minimax_h3_image",
                "workflow_template": workflow_template,
                "prompt": prompt,
                "seed": seed,
                "width": width,
                "height": height,
                "steps": steps,
                "diffusion_model": diffusion_model
            })
        return res

    def generate_video(
        self,
        prompt: str,
        duration: float = 3.0,
        aspect_ratio: str = "16:9 (Widescreen)",
        megapixels: float = 0.9,
        steps: int = 10,
        seed: int = None,
        reference_images: list = None,
        reference_videos: list = None,
        ref_image_size: str = "match",
        diffusion_model: str = None,
        clip_model: str = None,
        video_vae: str = None,
        audio_vae: str = "minimax_h3_audio_vae_fp32.safetensors",
        crf: int = 19,
        workflow_template: str = "minimax_h3_video_1pass_api.json",
        extra_patches: dict = None,
        output_dir: str = None,
        timeout_seconds: int = DEFAULT_RENDER_TIMEOUT
    ) -> dict:
        """
        基于成熟工作流 (默认 minimax_h3_video_1pass_api.json，或高清电影感流 minimax_h3_video_cinematic_lora_api.json)
        执行 MiniMax-H3 音画同步视频生成，支持传入 extra_patches 自由调整任意节点
        """
        if seed is None:
            seed = random.randint(100000, 999999999)

        resolved_ratio = ASPECT_RATIO_MAP.get(aspect_ratio.strip(), aspect_ratio)
        patches = {
            "115.inputs.aspect_ratio": resolved_ratio,
            "115.inputs.megapixels": float(megapixels),
            "138.inputs.value": prompt,
            "132.inputs.value": float(duration),
            "124.inputs.steps": int(steps),
            "129.inputs.noise_seed": int(seed),
            "136.inputs.ref_image_size": ref_image_size,
            "120.inputs.vae_name": audio_vae,
            "142.inputs.crf": int(crf),
        }
        if diffusion_model:
            patches["141.inputs.model_name"] = diffusion_model
        if clip_model:
            patches["128.inputs.clip_name"] = clip_model
        if video_vae:
            patches["119.inputs.vae_name"] = video_vae
        if extra_patches:
            patches.update(extra_patches)

        res = self.run_workflow(
            workflow=workflow_template,
            patches=patches,
            reference_images=reference_images,
            reference_videos=reference_videos,
            output_dir=output_dir,
            timeout_seconds=timeout_seconds
        )
        if res.get("ok"):
            res.update({
                "task_type": "minimax_h3_video",
                "workflow_template": workflow_template,
                "prompt": prompt,
                "seed": seed,
                "duration_seconds": duration,
                "aspect_ratio": resolved_ratio,
                "steps": steps
            })
        return res
