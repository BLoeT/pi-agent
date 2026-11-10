"""Environment parsing for the native image service, independent of the HTTP server."""
from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class ImagegenConfig:
    reuse_model: bool
    port: int
    output_dir: str
    video_output_dir: str
    default_width: int
    default_height: int
    default_engine: str
    quantize: str
    default_image_strength: float
    video_cmd: str
    video_t2v_model: str
    video_i2v_model: str
    video_default_frames: int
    video_default_fps: int
    video_default_width: int
    video_default_height: int
    video_default_steps: int
    video_default_guidance: float
    video_default_guidance_2: float
    video_timeout: int

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        root = Path(__file__).resolve().parents[1]
        port = int(env.get("IMAGEGEN_PORT", "8086"))
        output_dir = env.get("IMAGEGEN_OUTPUT_DIR", str(root / "workspace/generated-images"))
        video_output_dir = env.get("IMAGEGEN_VIDEO_OUTPUT_DIR", str(root / "workspace/generated-videos"))
        default_width = int(env.get("IMAGEGEN_WIDTH", "1024"))
        default_height = int(env.get("IMAGEGEN_HEIGHT", "1024"))
        default_engine = env.get("IMAGEGEN_ENGINE", "flux2")
        quantize = env.get("IMAGEGEN_QUANTIZE", "8")
        default_image_strength = float(env.get("IMAGEGEN_IMAGE_STRENGTH", "0.4"))
        video_cmd = env.get("IMAGEGEN_VIDEO_CMD", "mlxgen")
        video_t2v_model = env.get("IMAGEGEN_VIDEO_T2V_MODEL", "AbstractFramework/wan2.2-t2v-a14b-diffusers-8bit")
        video_i2v_model = env.get("IMAGEGEN_VIDEO_I2V_MODEL", "AbstractFramework/wan2.2-i2v-a14b-diffusers-8bit")
        video_default_frames = int(env.get("IMAGEGEN_VIDEO_FRAMES", "41"))
        video_default_fps = int(env.get("IMAGEGEN_VIDEO_FPS", "10"))
        video_default_width = int(env.get("IMAGEGEN_VIDEO_WIDTH", "448"))
        video_default_height = int(env.get("IMAGEGEN_VIDEO_HEIGHT", "256"))
        video_default_steps = int(env.get("IMAGEGEN_VIDEO_STEPS", "20"))
        video_default_guidance = float(env.get("IMAGEGEN_VIDEO_GUIDANCE", "4"))
        video_default_guidance_2 = float(env.get("IMAGEGEN_VIDEO_GUIDANCE2", "3"))
        video_timeout = int(env.get("IMAGEGEN_VIDEO_TIMEOUT", "3600"))
        if not 1 <= port <= 65535:
            raise ValueError("Ungültiger Imagegen-Port")
        if min(default_width, default_height, video_default_frames, video_default_fps, video_timeout) < 1:
            raise ValueError("Bild-/Video-Standardwerte müssen positiv sein")
        return cls(
            reuse_model=env.get("IMAGEGEN_REUSE_MODEL", "0") == "1",
            port=port,
            output_dir=output_dir,
            video_output_dir=video_output_dir,
            default_width=default_width,
            default_height=default_height,
            default_engine=default_engine,
            quantize=quantize,
            default_image_strength=default_image_strength,
            video_cmd=video_cmd,
            video_t2v_model=video_t2v_model,
            video_i2v_model=video_i2v_model,
            video_default_frames=video_default_frames,
            video_default_fps=video_default_fps,
            video_default_width=video_default_width,
            video_default_height=video_default_height,
            video_default_steps=video_default_steps,
            video_default_guidance=video_default_guidance,
            video_default_guidance_2=video_default_guidance_2,
            video_timeout=video_timeout,
        )
