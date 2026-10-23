# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "paramiko",
#   "requests",
# ]
# ///

import sys
import os
import json
import argparse
from pathlib import Path

# 确保脚本目录在 sys.path 中
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from config_manager import load_config, update_credentials, get_config_path
from remote_engine import AutoDLRemoteEngine


class AutoDLMediaClient:
    """
    通用 AutoDL 媒体生成客户端 (适用于任意 Agent)
    自动从 ~/.shrimp/skills/leo-autodl-imagine-video/config.json 读取配置并执行远程任务
    """

    def __init__(self, output_dir: str = None):
        self.config = load_config()
        self.output_dir = output_dir or str(Path.cwd() / "output")
        self.engine = AutoDLRemoteEngine(self.config) if self.config else None

    def probe(self) -> dict:
        """检查远程连接、GPU 状态与 ComfyUI 服务 (GET http://127.0.0.1:6006/system_stats)"""
        if not self.engine:
            return {
                "ok": False,
                "error_type": "NO_CONFIG",
                "message": f"未找到配置文件（应存放在 {get_config_path()}）。请先执行 update_config 设置 SSH 指令与密码。"
            }
        return self.engine.probe()

    def update_config(
        self,
        ssh_cmd: str = None,
        password: str = None,
        host: str = None,
        port: int = None,
        token: str = None,
        instance_uuid: str = None
    ) -> dict:
        """更新并持久化云端主机与 OpenAPI 配置"""
        self.config = update_credentials(
            ssh_cmd=ssh_cmd,
            password=password,
            host=host,
            port=port,
            token=token,
            instance_uuid=instance_uuid
        )
        self.engine = AutoDLRemoteEngine(self.config)
        return self.probe()

    def power_on(self, wait_seconds: int = 40) -> dict:
        """通过 AutoDL 官方 OpenAPI 远程开机实例并自动同步新端口"""
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.power_on(wait_seconds=wait_seconds)

    def power_off(self) -> dict:
        """通过 AutoDL 官方 OpenAPI 远程关机实例（释放 GPU 停止计费）"""
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.power_off()

    def refresh(self) -> dict:
        """从 AutoDL 官方 OpenAPI 刷新最新动态 SSH 端口与密码"""
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.refresh_credentials_from_api()

    def list_models(self, category: str = "all") -> dict:
        """
        查询远端 ComfyUI 挂载的模型列表 (GET /object_info/{node_class})
        category: "all" | "checkpoints" | "diffusion_models" | "clips" | "vaes" | "loras"
        """
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.list_models(category=category)

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
        output_dir: str = None
    ) -> dict:
        """调用 MiniMax H3 渲染音画同步视频（支持文生视频与参考图生视频）"""
        target_dir = output_dir or self.output_dir
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接，请先提供 SSH 指令与密码。"}
        return self.engine.generate_video(
            prompt=prompt,
            duration=duration,
            aspect_ratio=aspect_ratio,
            megapixels=megapixels,
            steps=steps,
            seed=seed,
            reference_images=reference_images,
            diffusion_model=diffusion_model,
            clip_model=clip_model,
            video_vae=video_vae,
            audio_vae=audio_vae,
            crf=crf,
            filename_prefix=filename_prefix,
            output_dir=target_dir
        )

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
        output_dir: str = None
    ) -> dict:
        """调用云端 SDXL/Checkpoint 渲染高质量图片（支持挂载 LoRA）"""
        target_dir = output_dir or self.output_dir
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接，请先提供 SSH 指令与密码。"}
        return self.engine.generate_image(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            steps=steps,
            cfg=cfg,
            sampler_name=sampler_name,
            scheduler=scheduler,
            denoise=denoise,
            seed=seed,
            checkpoint=checkpoint,
            lora_name=lora_name,
            lora_strength=lora_strength,
            batch_size=batch_size,
            filename_prefix=filename_prefix,
            output_dir=target_dir
        )

    def shutdown(self) -> dict:
        """远程关闭云端实例（优先走官方 API，兜底走 SSH）"""
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.power_off()


def main():
    parser = argparse.ArgumentParser(description="leo-autodl-imagine-video Universal Agent CLI")
    # 生命周期与配置命令
    parser.add_argument("--probe", action="store_true", help="探测云端实例状态 (GPU + ComfyUI)")
    parser.add_argument("--power-on", action="store_true", help="通过 AutoDL 官方 API 远程开机")
    parser.add_argument("--power-off", action="store_true", help="通过 AutoDL 官方 API 远程关机 (停止计费)")
    parser.add_argument("--refresh", action="store_true", help="从 AutoDL 官方 API 刷新最新动态 SSH 端口凭证")
    parser.add_argument("--shutdown", action="store_true", help="远程关闭云端实例 (同 --power-off)")
    parser.add_argument("--list-models", type=str, nargs="?", const="all", help="查询云端挂载的模型列表: all | checkpoints | diffusion_models | clips | vaes | loras")
    parser.add_argument("--update-config", action="store_true", help="更新 SSH 主机、密码或 API Token")
    parser.add_argument("--ssh", type=str, help="SSH 登录指令，如 'ssh -p 12345 root@connect.xxx.com'")
    parser.add_argument("--password", type=str, help="云端机器密码")
    parser.add_argument("--token", type=str, help="AutoDL 官方 API Token (JWT)")
    parser.add_argument("--instance-uuid", type=str, help="实例 UUID，如 'pro-7927c3f34e28'")

    # 媒体生成命令与通用参数
    parser.add_argument("--video", action="store_true", help="生成视频任务 (MiniMax H3 音画同步)")
    parser.add_argument("--image", action="store_true", help="生成图片任务 (SDXL / Checkpoint)")
    parser.add_argument("--prompt", type=str, help="正向提示词内容")
    parser.add_argument("--negative-prompt", type=str, default="low quality, bad quality, blurry, deformed, watermark, text, signature, bad anatomy, extra digits", help="负向提示词 (生图专用)")
    parser.add_argument("--steps", type=int, help="采样步数 (视频默认 10，图片默认 20)")
    parser.add_argument("--seed", type=int, help="随机种子 (不填则随机生成)")
    parser.add_argument("--output-dir", type=str, default="output", help="本地保存目录 (默认 output)")
    parser.add_argument("--json", action="store_true", help="输出纯 JSON 格式供外部 Agent 解析")

    # 视频生成专属参数
    parser.add_argument("--duration", type=float, default=3.0, help="视频时长（秒，默认 3.0，推荐 3~10）")
    parser.add_argument("--aspect-ratio", type=str, default="16:9 (Widescreen)", help="视频宽高比: 16:9 | 9:16 | 1:1 | 4:3 | 3:4 | 2:3 | 3:2 | 21:9")
    parser.add_argument("--megapixels", type=float, default=0.9, help="视频目标总像素百万数 (默认 0.9 ≈ 1280x736)")
    parser.add_argument("--ref-images", type=str, help="参考图本地路径列表（逗号分隔，用于图生视频/多图参考生视频）")
    parser.add_argument("--diffusion-model", type=str, default="minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors", help="视频扩散主模型名称")
    parser.add_argument("--clip-model", type=str, default="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", help="视频文本编码器名称")
    parser.add_argument("--video-vae", type=str, default="minimax_h3_video_vae_fp16.safetensors", help="视频 VAE 解码器名称")
    parser.add_argument("--audio-vae", type=str, default="minimax_h3_audio_vae_fp32.safetensors", help="音频 VAE 解码器名称")
    parser.add_argument("--crf", type=int, default=19, help="MP4 H.264 编码质量 CRF (默认 19)")

    # 图片生成专属参数
    parser.add_argument("--width", type=int, default=1024, help="图片宽度（默认 1024，32 的倍数）")
    parser.add_argument("--height", type=int, default=1024, help="图片高度（默认 1024，32 的倍数）")
    parser.add_argument("--cfg", type=float, default=7.0, help="CFG 提示词相关性系数（默认 7.0）")
    parser.add_argument("--sampler", type=str, default="dpmpp_2m", help="采样器名称 (默认 dpmpp_2m，可选 euler, euler_ancestral, dpmpp_sde, uni_pc 等)")
    parser.add_argument("--scheduler", type=str, default="karras", help="调度器名称 (默认 karras，可选 normal, simple, sgm_uniform, beta 等)")
    parser.add_argument("--denoise", type=float, default=1.0, help="去噪幅度 (默认 1.0)")
    parser.add_argument("--checkpoint", type=str, default="Juggernaut-XI-byRunDiffusion.safetensors", help="生图底模权重名称")
    parser.add_argument("--lora", type=str, default=None, help="可选挂载的 LoRA 权重名称")
    parser.add_argument("--lora-strength", type=float, default=0.8, help="LoRA 权重强度 (默认 0.8)")
    parser.add_argument("--batch-size", type=int, default=1, help="单次生成张数 (默认 1)")

    args = parser.parse_args()
    client = AutoDLMediaClient(output_dir=args.output_dir)

    result = None
    if args.update_config:
        result = client.update_config(
            ssh_cmd=args.ssh,
            password=args.password,
            token=args.token,
            instance_uuid=args.instance_uuid
        )
    elif args.power_on:
        result = client.power_on()
    elif args.power_off or args.shutdown:
        result = client.power_off()
    elif args.refresh:
        result = client.refresh()
    elif args.list_models:
        result = client.list_models(category=args.list_models)
    elif args.probe:
        result = client.probe()
    elif args.video:
        if not args.prompt:
            result = {"ok": False, "message": "生成视频必须提供 --prompt 参数"}
        else:
            steps = args.steps or 10
            ref_imgs = [p.strip() for p in args.ref_images.split(",") if p.strip()] if args.ref_images else None
            result = client.generate_video(
                prompt=args.prompt,
                duration=args.duration,
                aspect_ratio=args.aspect_ratio,
                megapixels=args.megapixels,
                steps=steps,
                seed=args.seed,
                reference_images=ref_imgs,
                diffusion_model=args.diffusion_model,
                clip_model=args.clip_model,
                video_vae=args.video_vae,
                audio_vae=args.audio_vae,
                crf=args.crf,
                output_dir=args.output_dir
            )
    elif args.image:
        if not args.prompt:
            result = {"ok": False, "message": "生成图片必须提供 --prompt 参数"}
        else:
            steps = args.steps or 20
            result = client.generate_image(
                prompt=args.prompt,
                negative_prompt=args.negative_prompt,
                width=args.width,
                height=args.height,
                steps=steps,
                cfg=args.cfg,
                sampler_name=args.sampler,
                scheduler=args.scheduler,
                denoise=args.denoise,
                seed=args.seed,
                checkpoint=args.checkpoint,
                lora_name=args.lora,
                lora_strength=args.lora_strength,
                batch_size=args.batch_size,
                output_dir=args.output_dir
            )
    else:
        result = client.probe()

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        if result.get("ok"):
            print(f"[SUCCESS] {result.get('message', '操作成功')}")
            if "output_files" in result:
                for f in result["output_files"]:
                    abs_f = str(Path(f).resolve()).replace("\\", "/")
                    print(f"  -> 输出文件已保存在: {abs_f}")
                    if abs_f.endswith(".mp4"):
                        print(f"  -> Markdown 预览: [▶️ 播放视频](file:///{abs_f})")
                    else:
                        print(f"  -> Markdown 预览: ![Generated Image](/{abs_f})")
            if "models" in result:
                for cat, items in result["models"].items():
                    print(f"\n[{cat}] (共 {len(items)} 个):")
                    for m in items[:25]:
                        print(f"  - {m}")
                    if len(items) > 25:
                        print(f"  ... 及其他 {len(items) - 25} 个模型 (添加 --json 查看全量)")
        else:
            print(f"[FAILED] {result.get('message', '操作失败')}")
            if result.get("error_type"):
                print(f"  错误类型: {result['error_type']}")


if __name__ == "__main__":
    main()
