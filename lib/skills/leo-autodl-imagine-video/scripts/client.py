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
import shutil
import argparse
from pathlib import Path

# 确保脚本目录在 sys.path 中
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from config_manager import load_config, update_credentials, get_config_path, get_default_output_dir
from remote_engine import AutoDLRemoteEngine


class AutoDLMediaClient:
    """
    MiniMax-H3 专用云端生图/生视频与 ComfyUI 工作流编排客户端 (适用于任意 Agent)
    - 默认配置: ~/.shrimp/skills/leo-autodl-imagine-video/config.json
    - 默认暂存输出目录: ~/.shrimp/skills/leo-autodl-imagine-video/outputs/
    - 支持直接运行成熟工作流模板、动态 Patch 任意节点，或拉取远端 U00~U43 社区工作流进行调优沉淀。
    """

    def __init__(self, output_dir: str = None):
        self.config = load_config()
        self.output_dir = str(Path(output_dir)) if output_dir else str(get_default_output_dir())
        self.engine = AutoDLRemoteEngine(self.config) if self.config else None

    def probe(self) -> dict:
        """探测远程连接、GPU 算力与 ComfyUI 状态 (GET http://127.0.0.1:6006/system_stats)"""
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

    def power_on(self, wait_seconds: int = 45) -> dict:
        """通过 AutoDL 官方 OpenAPI 远程开机实例并自动同步新端口"""
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.power_on(wait_seconds=wait_seconds)

    def power_off(self, confirm: bool = False) -> dict:
        """
        通过 AutoDL 官方 OpenAPI 远程关机实例（释放 GPU 停止计费）
        【铁律约束】：必须先获用户明确确认，传入 confirm=True 才能执行！
        """
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.power_off(confirm=confirm)

    def shutdown(self, confirm: bool = False) -> dict:
        """远程关闭云端实例（必须传入 confirm=True）"""
        return self.power_off(confirm=confirm)

    def refresh(self) -> dict:
        """从 AutoDL 官方 OpenAPI 刷新最新动态 SSH 端口与密码"""
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.refresh_credentials_from_api()

    def inspect_node(self, node_class: str) -> dict:
        """查询 ComfyUI 任意节点类型的输入槽位与枚举范围 (GET /object_info/{node_class})"""
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.inspect_node(node_class=node_class)

    def list_models(self, category: str = "all", filter_keyword: str = "minimax") -> dict:
        """查询远端挂载的 MiniMax-H3 模型、CLIP、VAE 与 LoRA 清单"""
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.list_models(category=category, filter_keyword=filter_keyword)

    def list_remote_workflows(self) -> dict:
        """列出 AutoDL 远端镜像预置的 43+ 个成熟 MiniMax-H3 工作流"""
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.list_remote_workflows()

    def fetch_remote_workflow(self, remote_path: str, save_to: str = None) -> dict:
        """从 AutoDL 远端下载指定的成熟工作流 JSON 到本地进行分析或复用"""
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.fetch_remote_workflow(remote_path=remote_path, save_to=save_to)

    def run_workflow(
        self,
        workflow,
        patches: dict = None,
        reference_images: list = None,
        reference_videos: list = None,
        output_dir: str = None
    ) -> dict:
        """直接执行任意自定义或预设 ComfyUI API 工作流 JSON，支持 patches 动态修改任意节点"""
        target_dir = output_dir or self.output_dir
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.run_workflow(
            workflow=workflow,
            patches=patches,
            reference_images=reference_images,
            reference_videos=reference_videos,
            output_dir=target_dir
        )

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
        output_dir: str = None
    ) -> dict:
        """调用 MiniMax-H3 生成单张高清图、多参考图合拍或电影分镜板"""
        target_dir = output_dir or self.output_dir
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.generate_image(
            prompt=prompt,
            width=width,
            height=height,
            steps=steps,
            cfg=cfg,
            sampler_name=sampler_name,
            scheduler=scheduler,
            seed=seed,
            reference_images=reference_images,
            ref_image_size=ref_image_size,
            diffusion_model=diffusion_model,
            clip_model=clip_model,
            video_vae=video_vae,
            workflow_template=workflow_template,
            extra_patches=extra_patches,
            output_dir=target_dir
        )

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
        output_dir: str = None
    ) -> dict:
        """调用 MiniMax-H3 生成音画同步视频（支持文生视频、参考图生视频、电影感高清流切换与节点微调）"""
        target_dir = output_dir or self.output_dir
        if not self.engine:
            return {"ok": False, "message": "未配置云端连接。"}
        return self.engine.generate_video(
            prompt=prompt,
            duration=duration,
            aspect_ratio=aspect_ratio,
            megapixels=megapixels,
            steps=steps,
            seed=seed,
            reference_images=reference_images,
            reference_videos=reference_videos,
            ref_image_size=ref_image_size,
            diffusion_model=diffusion_model,
            clip_model=clip_model,
            video_vae=video_vae,
            audio_vae=audio_vae,
            crf=crf,
            workflow_template=workflow_template,
            extra_patches=extra_patches,
            output_dir=target_dir
        )

    def export_asset(self, src_file: str, target_path: str, move: bool = True, clean_others: bool = False) -> dict:
        """将暂存目录中用户满意的最终产物移动/复制到指定目录，并可选清理其余无用草稿"""
        src = Path(src_file)
        if not src.is_absolute() and not src.exists():
            src = get_default_output_dir() / src_file
        if not src.exists():
            return {"ok": False, "message": f"未找到源媒体文件: {src}"}

        dst = Path(target_path)
        if dst.is_dir() or target_path.endswith(("/", "\\")) or not dst.suffix:
            dst.mkdir(parents=True, exist_ok=True)
            dst_file = dst / src.name
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst_file = dst

        if move:
            shutil.move(str(src), str(dst_file))
        else:
            shutil.copy2(str(src), str(dst_file))

        cleaned = []
        if clean_others:
            clean_res = self.clean_outputs(keep_files=[dst_file.name if not move else ""])
            cleaned = clean_res.get("deleted_files", [])

        return {
            "ok": True,
            "action": "moved" if move else "copied",
            "target_file": str(dst_file.resolve()),
            "cleaned_count": len(cleaned),
            "cleaned_files": cleaned,
            "message": f"已将最终资产{'移动' if move else '复制'}至: {dst_file.resolve()}" + (f"，并清理了 {len(cleaned)} 个无用缓存文件" if clean_others else "")
        }

    def clean_outputs(self, keep_files: list = None) -> dict:
        """清理暂存目录 ~/.shrimp/skills/leo-autodl-imagine-video/outputs/ 下所有无用的图片与视频"""
        staging = get_default_output_dir()
        keep_set = {Path(k).name for k in (keep_files or []) if k}
        deleted = []
        for item in staging.iterdir():
            if item.is_file() and item.name not in keep_set:
                try:
                    item.unlink()
                    deleted.append(str(item))
                except Exception:
                    pass
        return {
            "ok": True,
            "staging_dir": str(staging),
            "deleted_count": len(deleted),
            "deleted_files": deleted,
            "message": f"已清理暂存目录 {staging} 下共 {len(deleted)} 个无用媒体文件"
        }


def _parse_patches(patch_args: list) -> dict:
    """解析 CLI 传入的 --patch 参数（支持 JSON 字符串或 key=value 格式）"""
    if not patch_args:
        return {}
    merged = {}
    for item in patch_args:
        item = item.strip()
        if item.startswith("{"):
            merged.update(json.loads(item))
        elif "=" in item:
            k, v = item.split("=", 1)
            try:
                parsed_v = json.loads(v)
            except Exception:
                parsed_v = v
            merged[k.strip()] = parsed_v
    return merged


def main():
    parser = argparse.ArgumentParser(description="leo-autodl-imagine-video (MiniMax-H3 专属云端生图/生视频与工作流编排 CLI)")
    # 1. 实例生命周期与自愈
    parser.add_argument("--probe", action="store_true", help="探测云端实例状态 (GPU + ComfyUI)")
    parser.add_argument("--power-on", action="store_true", help="通过 AutoDL 官方 API 远程开机并同步动态端口")
    parser.add_argument("--power-off", action="store_true", help="通过 AutoDL 官方 API 远程关机 (必须配合 --confirm)")
    parser.add_argument("--shutdown", action="store_true", help="远程关闭云端实例 (必须配合 --confirm)")
    parser.add_argument("--confirm", action="store_true", help="确认已获用户明确同意执行关机")
    parser.add_argument("--refresh", action="store_true", help="从 AutoDL 官方 API 刷新最新动态 SSH 端口凭证")
    parser.add_argument("--update-config", action="store_true", help="更新 SSH 主机、密码或 API Token")
    parser.add_argument("--ssh", type=str, help="SSH 登录指令，如 'ssh -p 12345 root@connect.xxx.com'")
    parser.add_argument("--password", type=str, help="云端机器密码")
    parser.add_argument("--token", type=str, help="AutoDL 官方 API Token (JWT)")
    parser.add_argument("--instance-uuid", type=str, help="实例 UUID，如 'pro-7927c3f34e28'")

    # 2. ComfyUI 节点自省与远端成熟工作流库发现
    parser.add_argument("--inspect-node", type=str, help="查看 ComfyUI 某个节点的完整输入槽位与枚举值，如 'MiniMaxH3ReferenceToVideo'")
    parser.add_argument("--list-models", type=str, nargs="?", const="all", help="查询云端 MiniMax-H3 相关模型: all | diffusion_models | clips | vaes | loras")
    parser.add_argument("--list-remote-workflows", action="store_true", help="列出 AutoDL 远端镜像预置的 43+ 个成熟 MiniMax-H3 工作流")
    parser.add_argument("--fetch-remote-workflow", type=str, help="下载远端某个成熟工作流 JSON 文件到本地，供分析或沉淀")
    parser.add_argument("--save-to", type=str, default=None, help="配合 --fetch-remote-workflow 指定本地保存路径")

    # 3. 通用工作流执行与 MiniMax-H3 生图/生视频
    parser.add_argument("--run-workflow", type=str, help="直接执行指定的工作流 JSON 模板名或本地 JSON 文件路径")
    parser.add_argument("--video", action="store_true", help="执行 MiniMax-H3 音画同步生视频")
    parser.add_argument("--image", action="store_true", help="执行 MiniMax-H3 高清生图")
    parser.add_argument("--workflow", type=str, default=None, help="指定使用的工作流模板文件名（默认生图用 minimax_h3_image_u33_api.json，生视频用 minimax_h3_video_1pass_api.json）")
    parser.add_argument("--patch", action="append", help="动态覆盖工作流任意节点属性，如 --patch '174.inputs.reuse_threshold=0.15' 或 JSON 字符串（可多次传入）")

    # 4. MiniMax-H3 核心可调参数
    parser.add_argument("--prompt", type=str, help="提示词（支持画面+运镜+音效+台词，或 <Picture 1> 多图绑定指令）")
    parser.add_argument("--ref-images", type=str, help="参考图本地路径列表（逗号分隔，最多 9 张，自动上传至云端）")
    parser.add_argument("--ref-videos", type=str, help="参考视频本地路径列表（逗号分隔，最多 3 段，自动上传至云端）")
    parser.add_argument("--ref-image-size", type=str, default="match", choices=["match", "max"], help="参考图分辨率模式: match (默认适配画幅) | max (2048px 短边最高身份保真度)")
    parser.add_argument("--duration", type=float, default=3.0, help="视频时长（秒，默认 3.0，推荐 3~10）")
    parser.add_argument("--aspect-ratio", type=str, default="16:9 (Widescreen)", help="视频宽高比: 16:9 | 9:16 | 1:1 | 4:3 | 3:4 | 2:3 | 3:2 | 21:9")
    parser.add_argument("--megapixels", type=float, default=0.9, help="视频画面总像素百万数 (默认 0.9 ≈ 1280x736，高清可设 1.0~1.2)")
    parser.add_argument("--width", type=int, default=1280, help="生图宽度（默认 1280，32 的倍数，分镜图可设 2048）")
    parser.add_argument("--height", type=int, default=736, help="生图高度（默认 736，32 的倍数，分镜图可设 2048）")
    parser.add_argument("--steps", type=int, help="采样步数 (1-pass 视频默认 10，高清电影流默认 16，生图默认 12)")
    parser.add_argument("--cfg", type=float, default=1.0, help="CFG 系数 (MiniMax-H3 默认 1.0)")
    parser.add_argument("--sampler", type=str, default="euler", help="生图采样器 (默认 euler，视频默认 res_multistep)")
    parser.add_argument("--scheduler", type=str, default="beta", help="生图调度器 (默认 beta，视频默认 simple)")
    parser.add_argument("--seed", type=int, help="随机种子 (不填则随机生成)")
    parser.add_argument("--diffusion-model", type=str, default=None, help="切换 MiniMax-H3 扩散主模型变体 (如 FeiHou / Dasiwa / Singularity / fl2va)")
    parser.add_argument("--clip-model", type=str, default=None, help="切换 Qwen3-VL 32B 编码器变体 (如 nvfp4_awq 或 int8_convrot)")
    parser.add_argument("--video-vae", type=str, default=None, help="切换视频/图像 VAE (如 minimax_h3_video_vae_fp16 或 MiniMax-H3-X2-Detail-v1)")
    parser.add_argument("--audio-vae", type=str, default="minimax_h3_audio_vae_fp32.safetensors", help="音频 VAE 解码器名称")
    parser.add_argument("--crf", type=int, default=19, help="MP4 H.264 压制质量 CRF (默认 19，高清可设 17)")
    parser.add_argument("--output-dir", type=str, default=None, help="自定义输出目录 (默认 ~/.shrimp/skills/leo-autodl-imagine-video/outputs/)")

    # 5. 暂存资产导出与清理
    parser.add_argument("--export", type=str, help="要导出的暂存文件名或路径")
    parser.add_argument("--to", type=str, help="导出目标目录或文件路径")
    parser.add_argument("--copy", action="store_true", help="导出时使用复制而非移动")
    parser.add_argument("--clean-others", action="store_true", help="导出最终资产后自动清理暂存目录中其余无用的图片和视频")
    parser.add_argument("--clean-outputs", action="store_true", help="清理 ~/.shrimp/skills/leo-autodl-imagine-video/outputs/ 下所有无用的图片和视频")
    parser.add_argument("--json", action="store_true", help="输出纯 JSON 格式供外部 Agent 解析")

    args = parser.parse_args()
    client = AutoDLMediaClient(output_dir=args.output_dir)
    patches = _parse_patches(args.patch)
    ref_imgs = [p.strip() for p in args.ref_images.split(",") if p.strip()] if args.ref_images else None
    ref_vids = [p.strip() for p in args.ref_videos.split(",") if p.strip()] if args.ref_videos else None

    result = None
    if args.update_config:
        result = client.update_config(
            ssh_cmd=args.ssh,
            password=args.password,
            token=args.token,
            instance_uuid=args.instance_uuid
        )
    elif args.export:
        if not args.to:
            result = {"ok": False, "message": "使用 --export 导出资产时必须通过 --to 指定目标目录或文件路径"}
        else:
            result = client.export_asset(
                src_file=args.export,
                target_path=args.to,
                move=not args.copy,
                clean_others=args.clean_others
            )
    elif args.clean_outputs:
        result = client.clean_outputs()
    elif args.power_on:
        result = client.power_on()
    elif args.power_off or args.shutdown:
        result = client.power_off(confirm=args.confirm)
    elif args.refresh:
        result = client.refresh()
    elif args.inspect_node:
        result = client.inspect_node(node_class=args.inspect_node)
    elif args.list_models:
        result = client.list_models(category=args.list_models)
    elif args.list_remote_workflows:
        result = client.list_remote_workflows()
    elif args.fetch_remote_workflow:
        result = client.fetch_remote_workflow(remote_path=args.fetch_remote_workflow, save_to=args.save_to)
    elif args.run_workflow:
        result = client.run_workflow(
            workflow=args.run_workflow,
            patches=patches,
            reference_images=ref_imgs,
            reference_videos=ref_vids,
            output_dir=args.output_dir
        )
    elif args.video:
        if not args.prompt:
            result = {"ok": False, "message": "生成视频必须提供 --prompt 参数"}
        else:
            wf_tpl = args.workflow or "minimax_h3_video_1pass_api.json"
            steps = args.steps or (16 if "cinematic" in wf_tpl else 10)
            result = client.generate_video(
                prompt=args.prompt,
                duration=args.duration,
                aspect_ratio=args.aspect_ratio,
                megapixels=args.megapixels,
                steps=steps,
                seed=args.seed,
                reference_images=ref_imgs,
                reference_videos=ref_vids,
                ref_image_size=args.ref_image_size,
                diffusion_model=args.diffusion_model,
                clip_model=args.clip_model,
                video_vae=args.video_vae,
                audio_vae=args.audio_vae,
                crf=args.crf,
                workflow_template=wf_tpl,
                extra_patches=patches,
                output_dir=args.output_dir
            )
    elif args.image:
        if not args.prompt:
            result = {"ok": False, "message": "生成图片必须提供 --prompt 参数"}
        else:
            wf_tpl = args.workflow or "minimax_h3_image_u33_api.json"
            steps = args.steps or 12
            result = client.generate_image(
                prompt=args.prompt,
                width=args.width,
                height=args.height,
                steps=steps,
                cfg=args.cfg,
                sampler_name=args.sampler,
                scheduler=args.scheduler,
                seed=args.seed,
                reference_images=ref_imgs,
                ref_image_size=args.ref_image_size,
                diffusion_model=args.diffusion_model or "minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors",
                clip_model=args.clip_model or "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
                video_vae=args.video_vae or "minimax_h3_video_vae_fp16.safetensors",
                workflow_template=wf_tpl,
                extra_patches=patches,
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
                    print(f"  -> 暂存文件已保存在: {abs_f}")
                    if abs_f.endswith(".mp4"):
                        print(f"  -> Markdown 预览: [▶️ 播放视频](file:///{abs_f})")
                    else:
                        print(f"  -> Markdown 预览: ![Generated Image](/{abs_f})")
            if "target_file" in result:
                print(f"  -> 最终文件位置: {result['target_file']}")
            if "models" in result:
                for cat, items in result["models"].items():
                    print(f"\n[{cat}] (共 {len(items)} 个):")
                    for m in items:
                        print(f"  - {m}")
            if "remote_workflows" in result:
                for wf_path in result["remote_workflows"]:
                    print(f"  - {wf_path}")
        else:
            print(f"[FAILED] {result.get('message', '操作失败')}")
            if result.get("error_type"):
                print(f"  错误类型: {result['error_type']}")


if __name__ == "__main__":
    main()
