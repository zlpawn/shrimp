import os
import json
import time
import random
from pathlib import Path
import paramiko
import requests
import urllib3

urllib3.disable_warnings()

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
        返回值示例: {"ok": True, "status": "running" | "stopped" | "starting" | "stopping"}
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

    def power_on(self, wait_seconds: int = 40) -> dict:
        """
        通过官方 OpenAPI 远程开机实例（有卡模式 payload="gpu"）并自动刷新动态 SSH 端口
        POST https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/power_on
        Body: {"instance_uuid": "<uuid>", "payload": "gpu"}
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

    def power_off(self) -> dict:
        """
        通过官方 OpenAPI 远程关机实例（释放 GPU 并停止计费）
        POST https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/power_off
        Body: {"instance_uuid": "<uuid>"}
        """
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

    # ==================== 2. SSH 与 ComfyUI HTTP 引擎 ====================

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
        return client

    def probe(self) -> dict:
        """
        探测云端实例连通性、GPU 算力与 ComfyUI 服务 (GET http://127.0.0.1:6006/system_stats)
        具备自动自愈能力：若 SSH 连接失败且配置了 OpenAPI Token，自动查询实例状态并刷新动态端口
        """
        if not self.host or not self.password:
            if self.token and self.instance_uuid:
                self.refresh_credentials_from_api()
            if not self.host or not self.password:
                return {
                    "ok": False,
                    "error_type": "CONFIG_MISSING",
                    "message": "未配置 AutoDL 实例连接信息。请提供 SSH 登录指令与密码。"
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
                client.exec_command("nohup bash /root/zealman-app/start-comfyui.sh > /dev/null 2>&1 &")
                time.sleep(3)
                stdin, stdout, stderr = client.exec_command(f"curl -s http://127.0.0.1:{self.remote_port}/system_stats")
                comfy_stats = stdout.read().decode("utf-8", errors="replace").strip()
                if comfy_stats and "comfyui_version" in comfy_stats:
                    comfy_running = True

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

    def list_models(self, category: str = "all") -> dict:
        """
        查询远端 ComfyUI 实例挂载的模型清单 (调用 GET http://127.0.0.1:6006/object_info/{node_class})
        category 可选: "all" | "checkpoints" | "diffusion_models" | "clips" | "vaes" | "loras"
        """
        probe_res = self.probe()
        if not probe_res["ok"]:
            return probe_res

        node_map = {
            "checkpoints": ("CheckpointLoaderSimple", "ckpt_name"),
            "diffusion_models": ("DiffusionModelLoaderKJ", "model_name"),
            "clips": ("CLIPLoader", "clip_name"),
            "vaes": ("VAELoader", "vae_name"),
            "loras": ("LoraLoader", "lora_name"),
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
                        inventory[key] = req_fields[field_name][0]
            return {
                "ok": True,
                "models": inventory,
                "message": f"成功获取云端模型列表 ({', '.join(f'{k}: {len(v)}个' for k, v in inventory.items())})"
            }
        except Exception as e:
            return {"ok": False, "message": f"查询模型列表异常: {e}"}
        finally:
            client.close()

    # ==================== 3. 视频生成 API (MiniMax H3 音画同步) ====================

    def generate_video(
        self,
        prompt: str,
        duration: float = 3.0,
        aspect_ratio: str = "16:9 (Widescreen)",
        megapixels: float = 0.9,
        steps: int = 10,
        seed: int = None,
        reference_images: list = None,
        diffusion_model: str = "minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors",
        clip_model: str = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        video_vae: str = "minimax_h3_video_vae_fp16.safetensors",
        audio_vae: str = "minimax_h3_audio_vae_fp32.safetensors",
        crf: int = 19,
        filename_prefix: str = "MiniMaxH3_BuiltInAudio_Builder",
        output_dir: str = "output"
    ) -> dict:
        """
        调用远端 ComfyUI API (POST /prompt) 执行 MiniMax H3 音画一体视频生成工作流
        支持纯文生视频 (Text-to-Video+Audio) 与参考图生视频 (Reference-to-Video+Audio)
        """
        probe_res = self.probe()
        if not probe_res["ok"]:
            return probe_res

        if seed is None:
            seed = random.randint(100000, 999999999)

        resolved_ratio = ASPECT_RATIO_MAP.get(aspect_ratio.strip(), aspect_ratio)

        client = self.connect_ssh()
        try:
            # 优先读取本地沉淀的标准工作流模板，若不存在则读取远端模板
            local_wf_path = self.skill_root / "references" / "workflows" / "minimax_h3_video_audio_api.json"
            if local_wf_path.exists():
                wf = json.loads(local_wf_path.read_text(encoding="utf-8"))
            else:
                load_cmd = "cat /root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/minimax_built_in_audio_builder_api.json"
                _, stdout, _ = client.exec_command(load_cmd)
                wf_str = stdout.read().decode("utf-8", errors="replace")
                if not wf_str:
                    return {"ok": False, "message": "未找到 MiniMax H3 工作流模板"}
                wf = json.loads(wf_str)

            # 若提供了本地参考图，通过 SFTP 上传至远端 /root/ComfyUI/input/ 并注入节点 180
            remote_ref_images = []
            if reference_images:
                sftp_up = client.open_sftp()
                try:
                    for local_img in reference_images:
                        p = Path(local_img)
                        if p.exists():
                            remote_target = f"/root/ComfyUI/input/{p.name}"
                            sftp_up.put(str(p), remote_target)
                            remote_ref_images.append(remote_target)
                finally:
                    sftp_up.close()

            # 注入节点参数
            wf["115"]["inputs"]["aspect_ratio"] = resolved_ratio
            wf["115"]["inputs"]["megapixels"] = float(megapixels)
            wf["141"]["inputs"]["model_name"] = diffusion_model
            wf["128"]["inputs"]["clip_name"] = clip_model
            wf["119"]["inputs"]["vae_name"] = video_vae
            wf["120"]["inputs"]["vae_name"] = audio_vae
            wf["138"]["inputs"]["value"] = prompt
            wf["132"]["inputs"]["value"] = float(duration)
            wf["124"]["inputs"]["steps"] = int(steps)
            wf["129"]["inputs"]["noise_seed"] = int(seed)
            wf["142"]["inputs"]["crf"] = int(crf)
            wf["142"]["inputs"]["filename_prefix"] = filename_prefix
            if "180" in wf:
                wf["180"]["inputs"]["image_paths"] = json.dumps(remote_ref_images)

            payload_json = json.dumps({"prompt": wf})
            submit_cmd = f"""/root/miniconda3/bin/python -c '
import urllib.request, json, sys
data = sys.stdin.read().encode("utf-8")
req = urllib.request.Request("http://127.0.0.1:{self.remote_port}/prompt", data=data, headers={{"Content-Type": "application/json"}})
resp = urllib.request.urlopen(req)
print(resp.read().decode())
' """
            stdin, stdout, stderr = client.exec_command(submit_cmd)
            stdin.write(payload_json)
            stdin.channel.shutdown_write()

            submit_res = stdout.read().decode("utf-8", errors="replace").strip()
            res_data = json.loads(submit_res)
            prompt_id = res_data.get("prompt_id")
            if not prompt_id:
                return {"ok": False, "message": f"任务提交失败: {submit_res}"}

            start_time = time.time()
            video_files = []
            while time.time() - start_time < 300:
                time.sleep(2)
                stdin, stdout, stderr = client.exec_command(f"curl -s http://127.0.0.1:{self.remote_port}/history/{prompt_id}")
                history_str = stdout.read().decode("utf-8", errors="replace").strip()
                if prompt_id in history_str:
                    history = json.loads(history_str)
                    outputs = history[prompt_id].get("outputs", {})
                    for nid, nout in outputs.items():
                        if "videos" in nout:
                            for it in nout["videos"]:
                                video_files.append(it["filename"])
                        if "gifs" in nout:
                            for it in nout["gifs"]:
                                video_files.append(it["filename"])
                    break

            if not video_files:
                return {"ok": False, "message": f"渲染超时或未捕获输出视频 (Prompt ID: {prompt_id})"}

            out_path = Path(output_dir)
            out_path.mkdir(parents=True, exist_ok=True)
            sftp = client.open_sftp()
            local_paths = []
            for vf in video_files:
                remote_file = f"/root/ComfyUI/output/{vf}"
                local_file = str(out_path / vf)
                sftp.get(remote_file, local_file)
                local_paths.append(local_file)
            sftp.close()

            elapsed = round(time.time() - start_time, 1)
            return {
                "ok": True,
                "task_type": "video",
                "prompt": prompt,
                "prompt_id": prompt_id,
                "seed": seed,
                "duration_seconds": duration,
                "aspect_ratio": resolved_ratio,
                "steps": steps,
                "diffusion_model": diffusion_model,
                "elapsed_seconds": elapsed,
                "output_files": local_paths,
                "message": f"视频生成完成 (耗时 {elapsed}s)"
            }
        except Exception as e:
            return {"ok": False, "message": f"视频生成失败: {str(e)}"}
        finally:
            client.close()

    # ==================== 4. 图片生成 API (SDXL / Checkpoint + 可选 LoRA) ====================

    def generate_image(
        self,
        prompt: str,
        negative_prompt: str = "low quality, bad quality, blurry, deformed, watermark, text, signature, bad anatomy, extra digits",
        width: int = 1024,
        height: int = 1024,
        steps: int = 20,
        cfg: float = 7.0,
        sampler_name: str = "dpmpp_2m",
        scheduler: str = "karras",
        denoise: float = 1.0,
        seed: int = None,
        checkpoint: str = "Juggernaut-XI-byRunDiffusion.safetensors",
        lora_name: str = None,
        lora_strength: float = 0.8,
        batch_size: int = 1,
        filename_prefix: str = "LeoAutoDL_Image",
        output_dir: str = "output"
    ) -> dict:
        """
        调用远端 ComfyUI API (POST /prompt) 执行标准文生图工作流 (支持挂载 LoRA)
        """
        probe_res = self.probe()
        if not probe_res["ok"]:
            return probe_res

        if seed is None:
            seed = random.randint(100000, 999999999)

        client = self.connect_ssh()
        try:
            model_ref = ["4", 0]
            clip_ref = ["4", 1]

            wf = {
                "4": {
                    "inputs": {"ckpt_name": checkpoint},
                    "class_type": "CheckpointLoaderSimple"
                },
                "5": {
                    "inputs": {"width": int(width), "height": int(height), "batch_size": int(batch_size)},
                    "class_type": "EmptyLatentImage"
                },
            }

            if lora_name:
                wf["10"] = {
                    "inputs": {
                        "lora_name": lora_name,
                        "strength_model": float(lora_strength),
                        "strength_clip": float(lora_strength),
                        "model": ["4", 0],
                        "clip": ["4", 1]
                    },
                    "class_type": "LoraLoader"
                }
                model_ref = ["10", 0]
                clip_ref = ["10", 1]

            wf["6"] = {
                "inputs": {"text": prompt, "clip": clip_ref},
                "class_type": "CLIPTextEncode"
            }
            wf["7"] = {
                "inputs": {"text": negative_prompt, "clip": clip_ref},
                "class_type": "CLIPTextEncode"
            }
            wf["3"] = {
                "inputs": {
                    "seed": int(seed),
                    "steps": int(steps),
                    "cfg": float(cfg),
                    "sampler_name": sampler_name,
                    "scheduler": scheduler,
                    "denoise": float(denoise),
                    "model": model_ref,
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["5", 0]
                },
                "class_type": "KSampler"
            }
            wf["8"] = {
                "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
                "class_type": "VAEDecode"
            }
            wf["9"] = {
                "inputs": {"filename_prefix": filename_prefix, "images": ["8", 0]},
                "class_type": "SaveImage"
            }

            payload_json = json.dumps({"prompt": wf})
            submit_cmd = f"""/root/miniconda3/bin/python -c '
import urllib.request, json, sys
data = sys.stdin.read().encode("utf-8")
req = urllib.request.Request("http://127.0.0.1:{self.remote_port}/prompt", data=data, headers={{"Content-Type": "application/json"}})
resp = urllib.request.urlopen(req)
print(resp.read().decode())
' """
            stdin, stdout, stderr = client.exec_command(submit_cmd)
            stdin.write(payload_json)
            stdin.channel.shutdown_write()

            submit_res = stdout.read().decode("utf-8", errors="replace").strip()
            res_data = json.loads(submit_res)
            prompt_id = res_data.get("prompt_id")
            if not prompt_id:
                return {"ok": False, "message": f"生图任务提交失败: {submit_res}"}

            start_time = time.time()
            image_files = []
            while time.time() - start_time < 120:
                time.sleep(1)
                stdin, stdout, stderr = client.exec_command(f"curl -s http://127.0.0.1:{self.remote_port}/history/{prompt_id}")
                history_str = stdout.read().decode("utf-8", errors="replace").strip()
                if prompt_id in history_str:
                    history = json.loads(history_str)
                    outputs = history[prompt_id].get("outputs", {})
                    for nid, nout in outputs.items():
                        if "images" in nout:
                            for it in nout["images"]:
                                image_files.append(it["filename"])
                    break

            if not image_files:
                return {"ok": False, "message": f"生图超时或未捕获图片 (Prompt ID: {prompt_id})"}

            out_path = Path(output_dir)
            out_path.mkdir(parents=True, exist_ok=True)
            sftp = client.open_sftp()
            local_paths = []
            for imgf in image_files:
                remote_file = f"/root/ComfyUI/output/{imgf}"
                local_file = str(out_path / imgf)
                sftp.get(remote_file, local_file)
                local_paths.append(local_file)
            sftp.close()

            elapsed = round(time.time() - start_time, 1)
            return {
                "ok": True,
                "task_type": "image",
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "prompt_id": prompt_id,
                "seed": seed,
                "width": width,
                "height": height,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler_name,
                "scheduler": scheduler,
                "checkpoint": checkpoint,
                "lora_name": lora_name,
                "elapsed_seconds": elapsed,
                "output_files": local_paths,
                "message": f"图片生成完成 (耗时 {elapsed}s)"
            }
        except Exception as e:
            return {"ok": False, "message": f"生图失败: {str(e)}"}
        finally:
            client.close()
