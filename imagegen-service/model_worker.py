"""Private stdio worker for the pinned mflux Flux2 text pipeline.
One cached model, process exits after idle timeout to release Metal memory.
No HTTP listener or new dependencies.
"""
import contextlib
import gc
import json
import os
import select
import sys
import time


def release_temporary_memory(mx):
    """Free only unused allocator buffers; live model weights remain loaded."""
    mx.synchronize()
    gc.collect()
    before = mx.get_cache_memory()
    mx.clear_cache()
    return {"cache_before_bytes": before, "cache_after_bytes": mx.get_cache_memory(),
            "active_bytes": mx.get_active_memory(), "peak_bytes": mx.get_peak_memory()}


def main():
    protocol = sys.stdout
    # Model libraries print progress to stdout: keep it out of the JSON protocol.
    with contextlib.redirect_stdout(sys.stderr):
        import mlx.core as mx
        from mflux.models.common.resolution.config_resolution import ConfigResolution
        from mflux.models.flux2.variants import Flux2Klein
        model = None
        key = None
        idle = float(os.getenv("IMAGEGEN_MODEL_IDLE_SECONDS", "60"))
        while select.select([sys.stdin], [], [], idle)[0]:
            line = sys.stdin.readline()
            if not line:
                break
            started = time.monotonic()
            try:
                job = json.loads(line)
                requested = (job["model"], job["quantize"])
                if requested != key:
                    # Parent restarts the process on model switches; do not accumulate models.
                    if model is not None:
                        raise ValueError("Worker model changed")
                    model = Flux2Klein(model_config=ConfigResolution.resolve(job["model"]), quantize=job["quantize"])
                    key = requested
                image = model.generate_image(
                    seed=job["seed"], prompt=job["prompt"], width=job["width"], height=job["height"],
                    guidance=job["guidance"], num_inference_steps=job["steps"],
                    scheduler="flow_match_euler_discrete")
                image.save(path=job["output"], export_json_metadata=False)
                del image
                # mflux intermediates may leave a large free Metal allocator pool.
                # Reclaim that pool between jobs while preserving warm model weights.
                try:
                    memory = release_temporary_memory(mx)
                    print(json.dumps({"event": "image_worker_memory", **memory}), flush=True)
                except Exception as cleanup_error:
                    print(json.dumps({"event": "image_worker_cleanup_failed", "type": type(cleanup_error).__name__}), flush=True)
                result = {"path": job["output"], "ms": round((time.monotonic()-started)*1000)}
            except Exception as error:
                result = {"error": f"{type(error).__name__}: {error}"}
                protocol.write(json.dumps(result) + "\n")
                protocol.flush()
                break
            protocol.write(json.dumps(result) + "\n")
            protocol.flush()


if __name__ == "__main__":
    main()
