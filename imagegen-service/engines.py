"""Supported image pipelines and aliases. Pure metadata; no model loads."""

ENGINES = {
    "flux1": {
        "label": "FLUX (schnell/dev)",
        "text2img": None,
        "img2img": "mflux-generate-kontext",
        "default_model": "schnell",
        "model_map": {"schnell": "schnell", "dev": "dev",
                      "schnell": "schnell", "dev": "dev"},
        "models": ["schnell", "dev"],
        "supports_negative": True,
        "supports_guidance": True,
        "img_image_style": "strength",
    },
    "flux2": {
        "label": "FLUX2 Klein (4b/9b)",
        "text2img": "mflux-generate-flux2",
        "img2img": "mflux-generate-flux2-edit",
        "default_model": "flux2-klein-4b",
        "model_map": {"4b": "flux2-klein-4b", "9b": "flux2-klein-9b",
                      "flux2-klein-4b": "flux2-klein-4b",
                      "flux2-klein-9b": "flux2-klein-9b"},
        "models": ["4b", "9b"],
        "supports_negative": False,
        "supports_guidance": False,
        "img_image_style": "image-paths",
    },
    "krea2": {
        "label": "Krea-2",
        "text2img": "mflux-generate-krea2",
        "img2img": "mflux-generate-krea2",
        "default_model": "krea-2",
        "model_map": {"krea2": "krea-2", "krea-2": "krea-2"},
        "models": ["krea-2"],
        "supports_negative": True,
        "supports_guidance": True,
        "img_image_style": "strength",
    },
    "qwen2.1": {
        "label": "Qwen-Image 2.1",
        "text2img": "mflux-generate-qwen-2.1",
        "img2img": "mflux-generate-qwen-2.1-edit",
        "default_model": "qwen-image-2.1",
        "model_map": {"qwen-image-2.1": "qwen-image-2.1", "qwen2.1": "qwen-image-2.1"},
        "models": ["qwen-image-2.1"],
        "supports_negative": True,
        "supports_guidance": True,
        "img_image_style": "image-paths",
    },
    "z-image-turbo": {
        "label": "z-image-turbo",
        "text2img": "mflux-generate-z-image-turbo",
        "img2img": "mflux-generate-z-image-turbo",
        "default_model": "z-image-turbo",
        "model_map": {"z-image-turbo": "z-image-turbo"},
        "models": ["z-image-turbo"],
        "supports_negative": True,
        "supports_guidance": True,
        "img_image_style": "strength",
    },
    "rmbg": {
        "label": "Hintergrund entfernen (transparent)",
        "text2img": None,
        "img2img": "mflux-generate-fibo-edit",
        "default_model": "fibo-edit-rmbg",
        "model_map": {"fibo-edit-rmbg": "fibo-edit-rmbg"},
        "models": ["fibo-edit-rmbg"],
        "supports_negative": True,
        "supports_guidance": True,
        "img_image_style": "image-path",
        "force_prompt": ("Remove the background of the main subject. "
                        "Isolate the subject on a fully transparent background. "
                        "Keep the subject sharp, clean and well preserved."),
        "needs_source": True,
    },
}


ENGINE_ALIASES = {
    "qwen": "qwen2.1",
    "krea": "krea2",
    "z-image-turbo": "z-image-turbo",
}
