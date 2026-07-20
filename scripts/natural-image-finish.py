#!/usr/bin/env python3
"""Apply a restrained, reproducible photographic finish to approved raster assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageOps


PRESETS = {
    "light": {
        "noise_sigma": 0.8,
        "blur_sigma": 0.35,
        "sharpen_amount": 0.10,
        "contrast": 1.01,
        "brightness": 1.002,
        "ffmpeg_noise": 0.35,
        "jpeg_quality": 94,
    },
    "medium": {
        "noise_sigma": 1.35,
        "blur_sigma": 0.55,
        "sharpen_amount": 0.16,
        "contrast": 1.02,
        "brightness": 1.003,
        "ffmpeg_noise": 0.65,
        "jpeg_quality": 92,
    },
    "strong": {
        "noise_sigma": 2.1,
        "blur_sigma": 0.8,
        "sharpen_amount": 0.22,
        "contrast": 1.03,
        "brightness": 1.005,
        "ffmpeg_noise": 1.0,
        "jpeg_quality": 90,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Natural photographic finish for approved text-free product image assets."
    )
    parser.add_argument("input", nargs="?", help="Input image path")
    parser.add_argument("-o", "--output", help="Output image path")
    parser.add_argument("--preset", choices=sorted(PRESETS), default="light")
    parser.add_argument("--noise", type=float, default=None, help="Gaussian noise sigma override")
    parser.add_argument("--blur", type=float, default=None, help="Gaussian blur sigma override")
    parser.add_argument("--seed", type=int, default=None, help="Deterministic random seed")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="FFmpeg executable")
    parser.add_argument("--report", help="Write processing report JSON")
    parser.add_argument("--self-check", action="store_true", help="Check imports and print versions")
    return parser.parse_args()


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_seed(file_path: Path) -> int:
    return int(sha256_file(file_path)[:8], 16)


def dependency_versions(ffmpeg_path: str) -> dict[str, str]:
    result = subprocess.run(
        [ffmpeg_path, "-version"],
        check=True,
        capture_output=True,
        text=True,
    )
    ffmpeg_version = result.stdout.splitlines()[0].strip() if result.stdout else "unknown"
    return {
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "opencv": cv2.__version__,
        "pillow": Image.__version__,
        "ffmpeg": ffmpeg_version,
    }


def validate_source(image: Image.Image) -> None:
    bands = image.getbands()
    if "A" in bands:
        alpha = image.getchannel("A")
        low, high = alpha.getextrema()
        if low < high or low < 255:
            raise ValueError(
                "Transparent or partially transparent assets are not eligible for natural image finishing."
            )
    if image.width < 256 or image.height < 256:
        raise ValueError("Input image is too small for a controlled photographic finish.")


def process_pixels(image: Image.Image, params: dict[str, float], seed: int) -> Image.Image:
    rgb = ImageOps.exif_transpose(image).convert("RGB")
    source = np.asarray(rgb, dtype=np.float32)
    rng = np.random.default_rng(seed)
    noise = rng.normal(0.0, params["noise_sigma"], source.shape).astype(np.float32)
    noisy = np.clip(source + noise, 0, 255).astype(np.uint8)

    blurred = cv2.GaussianBlur(noisy, (3, 3), params["blur_sigma"])
    amount = params["sharpen_amount"]
    finished = cv2.addWeighted(noisy, 1.0 + amount, blurred, -amount, 0)

    result = Image.fromarray(finished, mode="RGB")
    result = ImageEnhance.Contrast(result).enhance(params["contrast"])
    result = ImageEnhance.Brightness(result).enhance(params["brightness"])
    return result


def ffmpeg_finish(
    intermediate: Path,
    output: Path,
    ffmpeg_path: str,
    params: dict[str, float],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    suffix = output.suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise ValueError("Output must use PNG, JPEG, or WebP.")

    filters = (
        f"noise=alls={params['ffmpeg_noise']}:allf=t+u,"
        f"eq=contrast=1.002:brightness=0.0005"
    )
    command = [ffmpeg_path, "-hide_banner", "-loglevel", "error", "-i", str(intermediate), "-vf", filters]
    if suffix in {".jpg", ".jpeg"}:
        command.extend(["-q:v", str(max(2, round((100 - params["jpeg_quality"]) / 3) + 2))])
    elif suffix == ".webp":
        command.extend(["-quality", str(round(params["jpeg_quality"]))])
    command.extend(["-y", str(output)])
    subprocess.run(command, check=True, capture_output=True)


def write_json(file_path: Path, value: dict[str, Any]) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = file_path.with_suffix(f"{file_path.suffix}.tmp")
    temp_path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.replace(temp_path, file_path)


def run_self_check(ffmpeg_path: str) -> dict[str, Any]:
    params = dict(PRESETS["light"])
    with tempfile.TemporaryDirectory(prefix="sellerpilot-natural-finish-self-check-") as temp_dir:
        root = Path(temp_dir)
        source_path = root / "source.png"
        intermediate = root / "intermediate.png"
        output_path = root / "output.png"
        source = Image.new("RGB", (256, 256), color=(132, 148, 164))
        source.save(source_path, format="PNG")
        validate_source(source)
        process_pixels(source, params, seed=7).save(intermediate, format="PNG")
        ffmpeg_finish(intermediate, output_path, ffmpeg_path, params)
        if not output_path.is_file():
            raise RuntimeError("Natural image finish self-check did not create an output image.")
        with Image.open(output_path) as rendered:
            if rendered.size != (256, 256):
                raise RuntimeError("Natural image finish self-check changed the output dimensions.")
        if sha256_file(source_path) == sha256_file(output_path):
            raise RuntimeError("Natural image finish self-check did not transform the image payload.")
    return {
        "status": "pass",
        "width": 256,
        "height": 256,
        "operations_checked": 5,
    }


def main() -> int:
    args = parse_args()
    ffmpeg_path = shutil.which(args.ffmpeg) or (args.ffmpeg if Path(args.ffmpeg).exists() else "")
    if not ffmpeg_path:
        raise RuntimeError("FFmpeg is not available in the prepared runtime.")

    if args.self_check:
        print(json.dumps({
            "status": "ready",
            "versions": dependency_versions(ffmpeg_path),
            "pipeline_smoke": run_self_check(ffmpeg_path),
        }, indent=2))
        return 0

    if not args.input or not args.output:
        raise ValueError("Both input and --output are required.")

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"Input image does not exist: {input_path}")
    if input_path == output_path:
        raise ValueError("Input and output paths must differ so the approved source remains immutable.")

    params = dict(PRESETS[args.preset])
    if args.noise is not None:
        if not 0.0 <= args.noise <= 4.0:
            raise ValueError("--noise must be between 0 and 4.")
        params["noise_sigma"] = args.noise
    if args.blur is not None:
        if not 0.0 <= args.blur <= 1.5:
            raise ValueError("--blur must be between 0 and 1.5.")
        params["blur_sigma"] = args.blur

    seed = args.seed if args.seed is not None else stable_seed(input_path)
    with Image.open(input_path) as image:
        validate_source(image)
        width, height = image.size
        finished = process_pixels(image, params, seed)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="sellerpilot-natural-finish-") as temp_dir:
        intermediate = Path(temp_dir) / "pixel-finish.png"
        encoded = Path(temp_dir) / f"encoded{output_path.suffix.lower()}"
        finished.save(intermediate, format="PNG", optimize=False)
        ffmpeg_finish(intermediate, encoded, ffmpeg_path, params)
        os.replace(encoded, output_path)

    report = {
        "schema_version": "sellerpilot.natural_image_finish_asset.v1",
        "status": "pass",
        "input": str(input_path),
        "output": str(output_path),
        "input_sha256": sha256_file(input_path),
        "output_sha256": sha256_file(output_path),
        "width": width,
        "height": height,
        "preset": args.preset,
        "seed": seed,
        "parameters": params,
        "operations": [
            "deterministic_gaussian_sensor_noise",
            "restrained_micro_blur",
            "restrained_unsharp_recovery",
            "micro_contrast_and_brightness",
            "ffmpeg_temporal_uniform_grain_and_output_encode",
        ],
        "versions": dependency_versions(ffmpeg_path),
    }
    if args.report:
        write_json(Path(args.report).expanduser().resolve(), report)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}), file=sys.stderr)
        raise SystemExit(1)
