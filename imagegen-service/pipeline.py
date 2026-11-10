"""Image/video generation pipelines. HTTP framing and process cancellation live elsewhere."""
import glob
import os
from pathlib import Path
import re
import secrets
import subprocess
import time
import uuid
from engines import ENGINES, ENGINE_ALIASES
from jobs import job_context, run_generation
from worker_client import ModelWorker


class ImagePipeline:
    def __init__(self, config):
        self.config = config
        self.worker = ModelWorker()
        Path(config.output_dir).mkdir(parents=True, exist_ok=True)
        Path(config.video_output_dir).mkdir(parents=True, exist_ok=True)

    def _make_output_path(self, ext=".png"):
        timestamp = int(time.time())
        img_id = str(uuid.uuid4())[:8]
        filename = f"{timestamp}_{img_id}{ext}"
        output = os.path.join(self.config.output_dir, filename)
        if getattr(job_context,"outputs",None) is not None: job_context.outputs.append(output)
        return output


    def _make_video_output_path(self):
        timestamp = int(time.time())
        vid_id = str(uuid.uuid4())[:8]
        filename = f"{timestamp}_{vid_id}.mp4"
        output = os.path.join(self.config.video_output_dir, filename)
        if getattr(job_context,"outputs",None) is not None: job_context.outputs.append(output)
        return output


    def _find_latest_file(self, directory, ext, since_ts):
        """Finde die neueste Datei mit ext in einem Verzeichnis, die nach since_ts erstellt wurde."""
        try:
            files = glob.glob(os.path.join(directory, f"*{ext}"))
            files = [f for f in files if os.path.getmtime(f) >= since_ts]
            if files:
                return max(files, key=os.path.getmtime)
        except Exception:
            pass
        return None


    def _resolve_engine(self, engine):
        eng = (engine or self.config.default_engine).strip().lower()
        eng = ENGINE_ALIASES.get(eng, eng)
        return eng


    def generate_image(self, prompt, width=None, height=None, steps=None, seed=None,
                       model=None, guidance=None, init_image=None, negative_prompt=None,
                       engine=None, image_strength=None):
        """
        Bild generieren.

        Ohne init_image:  Text2img
        Mit init_image:   Img2img (Bild bearbeiten)
        engine "rmbg":    Hintergrund entfernen (braucht init_image)

        engine: flux2 (default) | krea2 | qwen2.1 | z-image-turbo | rmbg
        """
        eng = self._resolve_engine(engine)
        if eng not in ENGINES:
            return None, (f"Unbekannte Engine '{engine}'. "
                          f"Verfügbar: {', '.join(ENGINES.keys())}")
        cfg = ENGINES[eng]

        is_img = bool(init_image)

        if cfg.get("needs_source") and not is_img:
            return None, ("Engine 'rmbg' (Hintergrund entfernen) braucht ein Quellbild "
                          "(Parameter source_image setzen).")
        if is_img and not cfg.get("img2img"):
            return None, (f"Engine '{eng}' unterstützt kein Bild-bearbeiten (img2img). "
                          f"Verwende eine andere Engine oder 'rmbg'.")
        if not is_img and not cfg.get("text2img"):
            return None, f"Engine '{eng}' unterstützt keine Text2img-Generierung."

        cmd_name = cfg["img2img"] if is_img else cfg["text2img"]

        # Modell auflösen
        if is_img:
            base_model = cfg.get("default_img_model") or cfg.get("default_model")
        else:
            base_model = cfg.get("default_model")
        m = (model or base_model).strip()
        if m not in cfg.get("model_map", {}) and m != base_model:
            return None, "Modell nicht für diese Engine freigegeben"
        m = cfg.get("model_map", {}).get(m, m)

        # Fix-Prompt (rmbg)
        eff_prompt = cfg.get("force_prompt") or (prompt or "").strip()
        if not eff_prompt:
            return None, "Prompt erforderlich"

        w = width or self.config.default_width
        h = height or self.config.default_height

        # Steps: explizit > engine-default > Tool-Default (nicht setzen)
        eff_steps = steps if steps is not None else cfg.get("default_steps")

        since_ts = time.time()
        output_path = self._make_output_path()

        # Reuse only the verified Flux2 text pipeline. Other engines retain their CLI.
        # Enabled explicitly in the local environment after the cold/warm comparison.
        if (self.config.reuse_model and eng == "flux2" and not is_img
                and m in ("flux2-klein-4b", "flux2-klein-9b")):
            try:
                result = self.worker.generate({
                    "model": m, "quantize": int(self.config.quantize), "prompt": eff_prompt,
                    "width": w, "height": h, "steps": eff_steps or 4,
                    "seed": seed if seed is not None else secrets.randbelow(2**32),
                    "guidance": 1.0, "output": output_path}, cancel_event=getattr(job_context,"cancel",None))
                return result.get("path"), result.get("error")
            except Exception as error:
                return None, str(error)

        # A CLI pipeline must not compete with a cached image model for Metal memory.
        self.worker.close()

        # Quellbild-Argumente
        img_args = []
        if is_img:
            strength = image_strength if image_strength is not None else self.config.default_image_strength
            style = cfg.get("img_image_style", "strength")
            if style == "strength":
                img_args = ["--image", init_image, str(strength)]
            elif style == "image-paths":
                img_args = ["--image-paths", init_image]
            elif style == "image-path":
                img_args = ["--image-path", init_image]
            else:
                return None, f"Engine '{eng}': Quellbild-Übergabe nicht definiert."

        cmd = [
            cmd_name,
            "--prompt", eff_prompt,
            "--model", m,
            "--width", str(w),
            "--height", str(h),
            "--output", output_path,
            "-q", self.config.quantize,
        ]
        cmd += img_args

        if eff_steps is not None:
            cmd += ["--steps", str(eff_steps)]
        if seed is not None:
            cmd += ["--seed", str(seed)]
        if guidance is not None and cfg.get("supports_guidance"):
            cmd += ["--guidance", str(guidance)]
        if negative_prompt and cfg.get("supports_negative"):
            cmd += ["--negative-prompt", negative_prompt]

        mode = f"{eng} {'img2img' if is_img else 'text2img'}"
        print(f"[imagegen] {mode}: {eff_prompt[:80]}")
        print(f"[imagegen] cmd: {' '.join(cmd)}")

        try:
            result = run_generation(cmd,timeout=1200,cwd=self.config.output_dir)

            if result.returncode != 0:
                err = result.stderr.strip() or result.stdout.strip()
                print(f"[imagegen] ERROR (rc={result.returncode}): {err}")
                return None, err or f"{cmd_name} failed (rc={result.returncode})"

            stdout = result.stdout.strip()

            # 1) explizit gesetzte --output existiert?
            if Path(output_path).exists():
                print(f"[imagegen] Output vorhanden: {output_path}")
                return output_path, None

            # 2) neueste PNG in Output-Dir
            found = self._find_latest_file(self.config.output_dir, ".png", since_ts)
            if found:
                print(f"[imagegen] Bild gefunden: {found}")
                return found, None

            # 3) aus stdout ziehen
            png_match = re.search(r'(\S+\.(?:png|jpg|jpeg))', stdout)
            if png_match and Path(png_match.group(1)).exists():
                return png_match.group(1), None

            return None, "Output-Datei nicht gefunden nach Generation"

        except subprocess.TimeoutExpired:
            return None, "Timeout nach 300s"
        except FileNotFoundError:
            return None, f"{cmd_name} nicht gefunden. Bitte mflux installieren."
        except Exception as e:
            return None, str(e)


    def generate_video(self, prompt, frames=None, fps=None, width=None, height=None,
                       steps=None, guidance=None, guidance_2=None, seed=None,
                       negative_prompt=None, init_image=None):
        """
        Video generieren mit Wan 2.2 A14B (mlxgen generate).

        Ohne init_image:  Text-to-Video  (Model: wan2.2-t2v-a14b)
        Mit init_image:   Image-to-Video (Model: wan2.2-i2v-a14b, startet aus dem Bild)

        Frames werden von der CLI automatisch auf 4n+1 gerundet.
        """
        eff_prompt = (prompt or "").strip()
        if not eff_prompt:
            return None, "Prompt erforderlich"

        is_i2v = bool(init_image)
        model = self.config.video_i2v_model if is_i2v else self.config.video_t2v_model

        n_frames = frames or self.config.video_default_frames
        n_fps = fps or self.config.video_default_fps
        w = width or self.config.video_default_width
        h = height or self.config.video_default_height
        n_steps = steps or self.config.video_default_steps
        g = guidance if guidance is not None else self.config.video_default_guidance
        g2 = guidance_2 if guidance_2 is not None else self.config.video_default_guidance_2

        since_ts = time.time()
        output_path = self._make_video_output_path()

        cmd = [
            self.config.video_cmd, "generate",
            "--model", model,
            "--prompt", eff_prompt,
            "--width", str(w),
            "--height", str(h),
            "--frames", str(n_frames),
            "--steps", str(n_steps),
            "--guidance", str(g),
            "--guidance-2", str(g2),
            "--fps", str(n_fps),
            "--output", output_path,
        ]
        if is_i2v:
            cmd += ["--image", init_image]
        if seed is not None:
            cmd += ["--seed", str(seed)]
        if negative_prompt and g > 1:
            cmd += ["--negative-prompt", negative_prompt]

        self.worker.close()
        mode = "img2vid" if is_i2v else "text2vid"
        print(f"[videogen] {mode} (Wan 2.2 A14B): {eff_prompt[:80]}")
        print(f"[videogen] cmd: {' '.join(cmd)}")

        try:
            result = run_generation(cmd,timeout=self.config.video_timeout,cwd=self.config.video_output_dir)

            if result.returncode != 0:
                err = result.stderr.strip() or result.stdout.strip()
                print(f"[videogen] ERROR (rc={result.returncode}): {err}")
                return None, err or f"mlxgen failed (rc={result.returncode})"

            stdout = result.stdout.strip()

            # 1) explizit gesetzter --output existiert?
            if Path(output_path).exists():
                print(f"[videogen] Output vorhanden: {output_path}")
                return output_path, None

            # 2) neueste MP4 in Output-Dir
            found = self._find_latest_file(self.config.video_output_dir, ".mp4", since_ts)
            if found:
                print(f"[videogen] Video gefunden: {found}")
                return found, None

            # 3) aus stdout ziehen
            vid_match = re.search(r'(\S+\.mp4)', stdout)
            if vid_match and Path(vid_match.group(1)).exists():
                return vid_match.group(1), None

            return None, "Output-Datei nicht gefunden nach Video-Generation"

        except subprocess.TimeoutExpired:
            return None, f"Timeout nach {self.config.video_timeout}s — Video-Generation dauert zu lang"
        except FileNotFoundError:
            return None, f"'{self.config.video_cmd}' nicht gefunden. Bitte mlxgen installieren."
        except Exception as e:
            return None, str(e)

