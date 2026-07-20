#!/usr/bin/env python3
"""Apply an adaptive, reproducible natural finish to ecommerce raster assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageOps
import scipy
from scipy import ndimage


PRESETS = {
    "light": {
        "noise_sigma": 0.8,
        "chroma_noise_ratio": 0.16,
        "blur_sigma": 0.35,
        "sharpen_amount": 0.10,
        "contrast": 1.01,
        "brightness": 1.002,
        "tone_curve": 0.004,
        "ffmpeg_noise": 0.35,
        "jpeg_quality": 94,
        "spectral_peak_threshold": 12.0,
        "spectral_notch_strength": 0.08,
        "vignette": 0.006,
    },
    "medium": {
        "noise_sigma": 1.35,
        "chroma_noise_ratio": 0.18,
        "blur_sigma": 0.55,
        "sharpen_amount": 0.16,
        "contrast": 1.02,
        "brightness": 1.003,
        "tone_curve": 0.006,
        "ffmpeg_noise": 0.65,
        "jpeg_quality": 92,
        "spectral_peak_threshold": 10.0,
        "spectral_notch_strength": 0.10,
        "vignette": 0.010,
    },
    "strong": {
        "noise_sigma": 2.1,
        "chroma_noise_ratio": 0.20,
        "blur_sigma": 0.8,
        "sharpen_amount": 0.22,
        "contrast": 1.03,
        "brightness": 1.005,
        "tone_curve": 0.008,
        "ffmpeg_noise": 1.0,
        "jpeg_quality": 90,
        "spectral_peak_threshold": 8.0,
        "spectral_notch_strength": 0.12,
        "vignette": 0.014,
    },
}

PROFILES = {
    "photographic_scene": {
        "noise_sigma": 1.2,
        "chroma_noise_ratio": 0.18,
        "blur_sigma": 0.45,
        "sharpen_amount": 0.14,
        "contrast": 1.016,
        "brightness": 1.002,
        "tone_curve": 0.006,
        "ffmpeg_noise": 0.55,
        "jpeg_quality": 93,
        "spectral_peak_threshold": 10.0,
        "spectral_notch_strength": 0.10,
        "vignette": 0.010,
    },
    "studio_product": {
        "noise_sigma": 0.55,
        "chroma_noise_ratio": 0.12,
        "blur_sigma": 0.20,
        "sharpen_amount": 0.10,
        "contrast": 1.008,
        "brightness": 1.001,
        "tone_curve": 0.003,
        "ffmpeg_noise": 0.20,
        "jpeg_quality": 96,
        "spectral_peak_threshold": 13.0,
        "spectral_notch_strength": 0.06,
        "vignette": 0.004,
    },
    "macro_detail": {
        "noise_sigma": 0.38,
        "chroma_noise_ratio": 0.10,
        "blur_sigma": 0.12,
        "sharpen_amount": 0.20,
        "contrast": 1.010,
        "brightness": 1.000,
        "tone_curve": 0.002,
        "ffmpeg_noise": 0.16,
        "jpeg_quality": 97,
        "spectral_peak_threshold": 18.0,
        "spectral_notch_strength": 0.04,
        "vignette": 0.0,
    },
    "graphic_text": {
        "noise_sigma": 0.10,
        "chroma_noise_ratio": 0.04,
        "blur_sigma": 0.0,
        "sharpen_amount": 0.03,
        "contrast": 1.002,
        "brightness": 1.000,
        "tone_curve": 0.0,
        "ffmpeg_noise": 0.0,
        "jpeg_quality": 98,
        "spectral_peak_threshold": 999.0,
        "spectral_notch_strength": 0.0,
        "vignette": 0.0,
    },
    "transparent_asset": {
        "noise_sigma": 0.28,
        "chroma_noise_ratio": 0.08,
        "blur_sigma": 0.10,
        "sharpen_amount": 0.08,
        "contrast": 1.004,
        "brightness": 1.000,
        "tone_curve": 0.001,
        "ffmpeg_noise": 0.0,
        "jpeg_quality": 100,
        "spectral_peak_threshold": 999.0,
        "spectral_notch_strength": 0.0,
        "vignette": 0.0,
    },
    "hybrid_commerce": {
        "noise_sigma": 0.48,
        "chroma_noise_ratio": 0.10,
        "blur_sigma": 0.16,
        "sharpen_amount": 0.10,
        "contrast": 1.006,
        "brightness": 1.001,
        "tone_curve": 0.002,
        "ffmpeg_noise": 0.12,
        "jpeg_quality": 97,
        "spectral_peak_threshold": 15.0,
        "spectral_notch_strength": 0.04,
        "vignette": 0.002,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Adaptive natural finish for generated ecommerce images."
    )
    parser.add_argument("input", nargs="?", help="Input image path")
    parser.add_argument("-o", "--output", help="Output image path")
    parser.add_argument("--preset", choices=sorted(PRESETS), default=None)
    parser.add_argument("--profile", choices=["auto", *sorted(PROFILES)], default="auto")
    parser.add_argument("--role-hint", default="", help="Structured image role/title hint")
    parser.add_argument(
        "--contains-visible-text",
        choices=["auto", "true", "false"],
        default="auto",
    )
    parser.add_argument("--preserve-text", action="store_true")
    parser.add_argument("--allow-alpha", action="store_true")
    parser.add_argument("--noise", type=float, default=None, help="Gaussian noise sigma override")
    parser.add_argument("--blur", type=float, default=None, help="Gaussian blur sigma override")
    parser.add_argument("--seed", type=int, default=None, help="Deterministic random seed")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="FFmpeg executable")
    parser.add_argument("--report", help="Write processing report JSON")
    parser.add_argument("--inspect", action="store_true", help="Inspect and classify without processing")
    parser.add_argument("--self-check", action="store_true", help="Check imports and pipeline")
    return parser.parse_args()


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


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
        "scipy": scipy.__version__,
        "opencv": cv2.__version__,
        "pillow": Image.__version__,
        "ffmpeg": ffmpeg_version,
    }


def bool_from_text(value: str) -> bool | None:
    normalized = str(value or "auto").strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    return None


def text_protection_mask(rgb: np.ndarray) -> tuple[np.ndarray, dict[str, float | int]]:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    gradient = cv2.morphologyEx(
        gray,
        cv2.MORPH_GRADIENT,
        cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
    )
    _, binary = cv2.threshold(gradient, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    height, width = gray.shape
    image_area = max(1, height * width)
    mask = np.zeros_like(gray, dtype=np.uint8)
    components = 0
    for index in range(1, count):
        x, y, component_width, component_height, area = stats[index]
        if area < 3 or area > image_area * 0.012:
            continue
        if component_height < max(3, height * 0.004) or component_height > height * 0.09:
            continue
        aspect = component_width / max(1, component_height)
        if aspect < 0.08 or aspect > 12:
            continue
        mask[labels == index] = 255
        components += 1
    if components:
        kernel_size = max(3, int(round(min(width, height) * 0.004)) | 1)
        mask = cv2.dilate(
            mask,
            cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size)),
            iterations=1,
        )
    coverage = float(np.count_nonzero(mask)) / image_area
    return mask, {
        "component_count": components,
        "coverage": round(coverage, 6),
    }


def radial_power_spectrum(log_power: np.ndarray) -> list[float]:
    height, width = log_power.shape
    y, x = np.indices((height, width))
    center_y = (height - 1) / 2.0
    center_x = (width - 1) / 2.0
    radius = np.sqrt((x - center_x) ** 2 + (y - center_y) ** 2).astype(np.int32)
    max_radius = max(1, min(width, height) // 2)
    sums = np.bincount(radius.ravel(), weights=log_power.ravel(), minlength=max_radius + 1)
    counts = np.bincount(radius.ravel(), minlength=max_radius + 1)
    radial = sums[:max_radius] / np.maximum(1, counts[:max_radius])
    if len(radial) > 32:
        sample_points = np.linspace(0, len(radial) - 1, 32).astype(np.int32)
        radial = radial[sample_points]
    return [round(float(value), 5) for value in radial]


def spectral_artifact_diagnostics(rgb: np.ndarray) -> dict[str, Any]:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gray = gray - float(np.mean(gray))
    window_y = np.hanning(gray.shape[0])[:, None]
    window_x = np.hanning(gray.shape[1])[None, :]
    spectrum = np.fft.fftshift(np.fft.fft2(gray * window_y * window_x))
    power = np.abs(spectrum) ** 2
    log_power = np.log1p(power)
    height, width = gray.shape
    y, x = np.indices((height, width))
    center_y = height // 2
    center_x = width // 2
    radius = np.sqrt((x - center_x) ** 2 + (y - center_y) ** 2)
    valid = (radius > min(width, height) * 0.035) & (radius < min(width, height) * 0.46)
    valid_values = log_power[valid]
    baseline = float(np.median(valid_values)) if valid_values.size else 0.0
    spread = float(np.median(np.abs(valid_values - baseline))) + 1e-6 if valid_values.size else 1.0
    normalized_peak = float((np.max(valid_values) - baseline) / spread) if valid_values.size else 0.0

    local_max = log_power == ndimage.maximum_filter(log_power, size=9, mode="nearest")
    candidates = np.argwhere(local_max & valid)
    peaks: list[dict[str, float | int]] = []
    if candidates.size:
        scores = log_power[candidates[:, 0], candidates[:, 1]]
        order = np.argsort(scores)[::-1][:8]
        for index in order:
            row, col = candidates[index]
            score = float((log_power[row, col] - baseline) / spread)
            if score < 4.0:
                continue
            peaks.append({
                "x": int(col - center_x),
                "y": int(row - center_y),
                "radius": round(float(radius[row, col]), 3),
                "score": round(score, 3),
            })

    angles = np.arctan2(y - center_y, x - center_x)
    bins = np.linspace(-np.pi, np.pi, 33)
    angular = []
    weights = log_power * valid
    for left, right in zip(bins[:-1], bins[1:]):
        mask = valid & (angles >= left) & (angles < right)
        angular.append(float(np.mean(weights[mask])) if np.any(mask) else 0.0)
    angular_mean = float(np.mean(angular)) if angular else 0.0
    angular_std = float(np.std(angular)) if angular else 0.0
    high_mask = radius > min(width, height) * 0.34
    mid_mask = (radius > min(width, height) * 0.12) & (radius <= min(width, height) * 0.34)
    high_frequency_rolloff = float(np.mean(log_power[high_mask]) / max(1e-6, np.mean(log_power[mid_mask]))) if np.any(high_mask) and np.any(mid_mask) else 0.0

    return {
        "periodic_peak_score": round(normalized_peak, 3),
        "periodic_peak_count": len(peaks),
        "dominant_peaks": peaks[:4],
        "directional_anisotropy": round(angular_std / max(1e-6, angular_mean), 5),
        "high_frequency_rolloff": round(high_frequency_rolloff, 5),
        "radial_power_sample": radial_power_spectrum(log_power),
    }


def suppress_periodic_luminance_artifacts(
    rgb: np.ndarray,
    params: dict[str, float],
    preserve_text: bool,
    preserve_alpha: bool,
) -> tuple[np.ndarray, dict[str, Any]]:
    diagnostics = spectral_artifact_diagnostics(rgb)
    strength = float(params.get("spectral_notch_strength", 0.0))
    threshold = float(params.get("spectral_peak_threshold", 999.0))
    should_suppress = (
        strength > 0
        and not preserve_text
        and not preserve_alpha
        and diagnostics["periodic_peak_score"] >= threshold
        and diagnostics["periodic_peak_count"] > 0
    )
    if not should_suppress:
        return rgb, {
            **diagnostics,
            "suppression_applied": False,
            "reason": "no_periodic_artifact_above_profile_threshold",
        }

    ycrcb = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb).astype(np.float32)
    luminance = ycrcb[:, :, 0]
    height, width = luminance.shape
    spectrum = np.fft.fftshift(np.fft.fft2(luminance - float(np.mean(luminance))))
    yy, xx = np.indices((height, width))
    center_y = height // 2
    center_x = width // 2
    attenuation = np.ones((height, width), dtype=np.float32)
    radius = max(3.0, min(width, height) * 0.008)
    used_peaks = []
    for peak in diagnostics["dominant_peaks"][:4]:
        offset_x = int(peak["x"])
        offset_y = int(peak["y"])
        if offset_x == 0 and offset_y == 0:
            continue
        for sign in (1, -1):
            px = center_x + offset_x * sign
            py = center_y + offset_y * sign
            if px < 0 or py < 0 or px >= width or py >= height:
                continue
            distance2 = (xx - px) ** 2 + (yy - py) ** 2
            notch = np.exp(-distance2 / (2.0 * radius * radius))
            attenuation *= (1.0 - strength * notch).astype(np.float32)
        used_peaks.append(peak)
    filtered = np.real(np.fft.ifft2(np.fft.ifftshift(spectrum * attenuation)))
    filtered = filtered + float(np.mean(luminance))
    ycrcb[:, :, 0] = np.clip(filtered, 0, 255)
    output = cv2.cvtColor(ycrcb.astype(np.uint8), cv2.COLOR_YCrCb2RGB)
    after = spectral_artifact_diagnostics(output)
    return output, {
        **diagnostics,
        "suppression_applied": True,
        "notch_strength": round(strength, 4),
        "notch_radius": round(radius, 3),
        "peaks_used": used_peaks,
        "post_periodic_peak_score": after["periodic_peak_score"],
    }


def apply_signal_dependent_sensor_grain(
    rgb: np.ndarray,
    params: dict[str, float],
    rng: np.random.Generator,
) -> tuple[np.ndarray, dict[str, float]]:
    sigma = float(params["noise_sigma"])
    if sigma <= 0:
        return rgb.copy(), {
            "luminance_sigma": 0.0,
            "chroma_sigma": 0.0,
            "spatial_variance_min": 1.0,
            "spatial_variance_max": 1.0,
        }
    ycrcb = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb).astype(np.float32)
    y = ycrcb[:, :, 0]
    signal = np.sqrt(np.clip(y, 0, 255) / 255.0)
    variance_field = rng.normal(0.0, 1.0, y.shape).astype(np.float32)
    variance_field = ndimage.gaussian_filter(variance_field, sigma=max(6.0, min(y.shape) / 44.0), mode="reflect")
    variance_field -= float(np.mean(variance_field))
    variance_std = float(np.std(variance_field)) or 1.0
    variance_field = np.clip(1.0 + 0.18 * (variance_field / variance_std), 0.72, 1.28)
    luminance_sigma = sigma * (0.36 + 0.72 * signal) * variance_field
    read_noise = rng.normal(0.0, sigma * 0.22, y.shape).astype(np.float32)
    shot_noise = rng.normal(0.0, 1.0, y.shape).astype(np.float32) * luminance_sigma
    ycrcb[:, :, 0] = np.clip(y + read_noise + shot_noise, 0, 255)
    chroma_sigma = sigma * float(params.get("chroma_noise_ratio", 0.12))
    if chroma_sigma > 0:
        ycrcb[:, :, 1] = np.clip(ycrcb[:, :, 1] + rng.normal(0.0, chroma_sigma, y.shape), 0, 255)
        ycrcb[:, :, 2] = np.clip(ycrcb[:, :, 2] + rng.normal(0.0, chroma_sigma, y.shape), 0, 255)
    return cv2.cvtColor(ycrcb.astype(np.uint8), cv2.COLOR_YCrCb2RGB), {
        "luminance_sigma": round(float(np.mean(luminance_sigma)), 4),
        "chroma_sigma": round(float(chroma_sigma), 4),
        "spatial_variance_min": round(float(np.min(variance_field)), 4),
        "spatial_variance_max": round(float(np.max(variance_field)), 4),
    }


def apply_filmic_tone_curve(rgb: np.ndarray, params: dict[str, float]) -> tuple[np.ndarray, dict[str, float]]:
    amount = float(params.get("tone_curve", 0.0))
    if amount <= 0:
        return rgb, {"tone_curve_amount": 0.0}
    normalized = rgb.astype(np.float32) / 255.0
    centered = normalized - 0.5
    curve = normalized + amount * centered * (1.0 - 4.0 * centered * centered)
    curve = np.clip(curve, 0.0, 1.0)
    return (curve * 255.0).astype(np.uint8), {"tone_curve_amount": round(amount, 5)}


def apply_subtle_lens_vignette(rgb: np.ndarray, params: dict[str, float]) -> tuple[np.ndarray, dict[str, float | bool]]:
    amount = float(params.get("vignette", 0.0))
    if amount <= 0:
        return rgb, {"applied": False, "amount": 0.0}
    height, width = rgb.shape[:2]
    y, x = np.indices((height, width))
    center_y = (height - 1) / 2.0
    center_x = (width - 1) / 2.0
    radius = np.sqrt(((x - center_x) / max(1.0, center_x)) ** 2 + ((y - center_y) / max(1.0, center_y)) ** 2)
    mask = 1.0 - amount * np.clip(radius ** 1.7, 0.0, 1.0)
    output = np.clip(rgb.astype(np.float32) * mask[:, :, None], 0, 255).astype(np.uint8)
    return output, {"applied": True, "amount": round(amount, 5)}


def inspect_image(image: Image.Image, role_hint: str = "", visible_text_hint: bool | None = None) -> dict[str, Any]:
    oriented = ImageOps.exif_transpose(image)
    alpha_present = "A" in oriented.getbands()
    alpha_non_opaque = False
    if alpha_present:
        low, _ = oriented.getchannel("A").getextrema()
        alpha_non_opaque = low < 255
    rgb = np.asarray(oriented.convert("RGB"), dtype=np.uint8)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 80, 180)
    edge_density = float(np.count_nonzero(edges)) / max(1, gray.size)
    white_ratio = float(np.count_nonzero(np.all(rgb >= 242, axis=2))) / max(1, gray.size)
    luminance_std = float(np.std(gray))
    saturation = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)[:, :, 1]
    mean_saturation = float(np.mean(saturation))
    _, text_metrics = text_protection_mask(rgb)
    spectral_metrics = spectral_artifact_diagnostics(rgb)

    role = str(role_hint or "").strip().lower()
    graphic_role = bool(re.search(
        r"(?:^|[^a-z])(?:infographic|comparison|parameter|spec|dimension|instruction|layout|card|copy|text|typography|poster|chart|diagram)(?:$|[^a-z])|包装|参数|对比|尺寸|步骤|文字|信息图",
        role,
    ))
    scene_role = bool(re.search(
        r"scene|lifestyle|editorial|environment|outdoor|garden|cafe|home|office|use.case|场景|生活|户外|花园|通勤|使用",
        role,
    ))
    detail_role = bool(re.search(r"macro|detail|texture|close.?up|细节|微距|纹理", role))
    studio_role = bool(re.search(r"hero|main|studio|product.photo|white.background|主图|棚拍|白底", role))
    detected_text = text_metrics["coverage"] >= 0.012 and text_metrics["component_count"] >= 8
    if visible_text_hint is not None:
        contains_visible_text = visible_text_hint
    else:
        contains_visible_text = graphic_role or (
            detected_text and not (scene_role or detail_role or studio_role)
        )

    if alpha_non_opaque:
        visual_class = "transparent_asset"
    elif graphic_role or visible_text_hint is True:
        visual_class = "graphic_text"
    elif detail_role:
        visual_class = "macro_detail"
    elif scene_role:
        visual_class = "photographic_scene"
    elif studio_role or white_ratio >= 0.48:
        visual_class = "studio_product"
    elif contains_visible_text:
        visual_class = "graphic_text"
    elif edge_density >= 0.14 and luminance_std >= 50:
        visual_class = "hybrid_commerce"
    else:
        visual_class = "photographic_scene"

    return {
        "width": oriented.width,
        "height": oriented.height,
        "mode": oriented.mode,
        "alpha_present": alpha_present,
        "alpha_non_opaque": alpha_non_opaque,
        "contains_visible_text": bool(contains_visible_text),
        "text_detection": text_metrics,
        "pixel_metrics": {
            "edge_density": round(edge_density, 6),
            "white_ratio": round(white_ratio, 6),
            "luminance_std": round(luminance_std, 4),
            "mean_saturation": round(mean_saturation, 4),
            "periodic_peak_score": spectral_metrics["periodic_peak_score"],
            "directional_anisotropy": spectral_metrics["directional_anisotropy"],
            "high_frequency_rolloff": spectral_metrics["high_frequency_rolloff"],
        },
        "spectral_artifacts": spectral_metrics,
        "role_hint": role_hint,
        "role_signals": {
            "graphic": graphic_role,
            "scene": scene_role,
            "detail": detail_role,
            "studio": studio_role,
        },
        "visual_class": visual_class,
        "recommended_profile": visual_class,
    }


def validate_source(image: Image.Image, allow_alpha: bool) -> None:
    if image.width < 256 or image.height < 256:
        raise ValueError("Input image is too small for a controlled natural finish.")
    if "A" in image.getbands():
        low, _ = image.getchannel("A").getextrema()
        if low < 255 and not allow_alpha:
            raise ValueError("Transparent assets require --allow-alpha so alpha preservation is explicit.")


def process_pixels(
    image: Image.Image,
    params: dict[str, float],
    seed: int,
    preserve_text: bool,
) -> tuple[Image.Image, dict[str, Any]]:
    oriented = ImageOps.exif_transpose(image)
    alpha = oriented.getchannel("A") if "A" in oriented.getbands() else None
    alpha_requires_preservation = False
    if alpha is not None:
        low, _ = alpha.getextrema()
        alpha_requires_preservation = low < 255
    original = np.asarray(oriented.convert("RGB"), dtype=np.uint8)
    rng = np.random.default_rng(seed)
    deperiodized, spectral_policy = suppress_periodic_luminance_artifacts(
        original,
        params,
        preserve_text=preserve_text,
        preserve_alpha=alpha_requires_preservation,
    )
    noisy, grain_metrics = apply_signal_dependent_sensor_grain(deperiodized, params, rng)
    toned, tone_metrics = apply_filmic_tone_curve(noisy, params)
    vignetted, vignette_metrics = apply_subtle_lens_vignette(toned, params)

    if params["blur_sigma"] > 0:
        blurred = cv2.GaussianBlur(vignetted, (3, 3), params["blur_sigma"])
    else:
        blurred = vignetted
    amount = params["sharpen_amount"]
    finished = cv2.addWeighted(vignetted, 1.0 + amount, blurred, -amount, 0)

    result = Image.fromarray(finished, mode="RGB")
    result = ImageEnhance.Contrast(result).enhance(params["contrast"])
    result = ImageEnhance.Brightness(result).enhance(params["brightness"])
    processed = np.asarray(result, dtype=np.uint8).copy()

    text_mask, text_metrics = text_protection_mask(original)
    protection_mode = "not_required"
    if preserve_text and np.any(text_mask):
        processed[text_mask > 0] = original[text_mask > 0]
        protection_mode = "detected_text_regions_restored"
    elif preserve_text:
        processed = original.copy()
        protection_mode = "conservative_full_frame_restored"
    result = Image.fromarray(processed, mode="RGB")
    if alpha is not None:
        result.putalpha(alpha)
    return result, {
        "text_protection_applied": bool(preserve_text),
        "text_protection_mode": protection_mode,
        "text_protection": text_metrics,
        "alpha_preserved": alpha_requires_preservation,
        "sensor_grain": grain_metrics,
        "tone_curve": tone_metrics,
        "vignette": vignette_metrics,
        "spectral_policy": spectral_policy,
    }


def ffmpeg_finish(
    intermediate: Path,
    output: Path,
    ffmpeg_path: str,
    params: dict[str, float],
    protect_exact_pixels: bool,
    preserve_alpha: bool,
) -> dict[str, Any]:
    output.parent.mkdir(parents=True, exist_ok=True)
    suffix = output.suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise ValueError("Output must use PNG, JPEG, or WebP.")

    command = [ffmpeg_path, "-hide_banner", "-loglevel", "error", "-i", str(intermediate)]
    filters_applied = not protect_exact_pixels and not preserve_alpha and params["ffmpeg_noise"] > 0
    if filters_applied:
        filters = (
            f"noise=alls={params['ffmpeg_noise']}:allf=t+u,"
            "eq=contrast=1.002:brightness=0.0005"
        )
        command.extend(["-vf", filters])
    if preserve_alpha and suffix == ".png":
        command.extend(["-pix_fmt", "rgba"])
    if suffix in {".jpg", ".jpeg"}:
        command.extend(["-q:v", str(max(2, round((100 - params["jpeg_quality"]) / 3) + 2))])
    elif suffix == ".webp":
        command.extend(["-q:v", str(round(params["jpeg_quality"]))])
    command.extend(["-y", str(output)])
    subprocess.run(command, check=True, capture_output=True)
    return {
        "filters_applied": filters_applied,
        "exact_pixel_protection": protect_exact_pixels,
        "alpha_preservation": preserve_alpha,
    }


def write_json(file_path: Path, value: dict[str, Any]) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = file_path.with_suffix(f"{file_path.suffix}.tmp")
    temp_path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.replace(temp_path, file_path)


def run_self_check(ffmpeg_path: str) -> dict[str, Any]:
    checked_profiles = []
    with tempfile.TemporaryDirectory(prefix="sellerpilot-natural-finish-self-check-") as temp_dir:
        root = Path(temp_dir)
        for index, profile in enumerate(("photographic_scene", "graphic_text", "transparent_asset"), start=1):
            source_path = root / f"source-{index}.png"
            intermediate = root / f"intermediate-{index}.png"
            output_path = root / f"output-{index}.png"
            source = Image.new("RGBA" if profile == "transparent_asset" else "RGB", (256, 256), color=(132, 148, 164, 180) if profile == "transparent_asset" else (132, 148, 164))
            source.save(source_path, format="PNG")
            validate_source(source, allow_alpha=profile == "transparent_asset")
            result, protection = process_pixels(
                source,
                dict(PROFILES[profile]),
                seed=7,
                preserve_text=profile == "graphic_text",
            )
            result.save(intermediate, format="PNG")
            ffmpeg_finish(
                intermediate,
                output_path,
                ffmpeg_path,
                PROFILES[profile],
                protect_exact_pixels=profile == "graphic_text",
                preserve_alpha=profile == "transparent_asset",
            )
            with Image.open(output_path) as rendered:
                if rendered.size != (256, 256):
                    raise RuntimeError("Natural image finish self-check changed output dimensions.")
                if profile == "transparent_asset" and "A" not in rendered.getbands():
                    raise RuntimeError("Natural image finish self-check lost alpha.")
                if profile == "transparent_asset" and rendered.getchannel("A").tobytes() != source.getchannel("A").tobytes():
                    raise RuntimeError("Natural image finish self-check changed alpha pixels.")
            checked_profiles.append({"profile": profile, "status": "pass", **protection})
    return {
        "status": "pass",
        "profiles_checked": checked_profiles,
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

    if not args.input:
        raise ValueError("Input is required.")
    input_path = Path(args.input).expanduser().resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"Input image does not exist: {input_path}")

    visible_text_hint = bool_from_text(args.contains_visible_text)
    with Image.open(input_path) as opened:
        image = ImageOps.exif_transpose(opened.copy())
    recognition = inspect_image(image, args.role_hint, visible_text_hint)
    if args.inspect:
        print(json.dumps({
            "schema_version": "sellerpilot.natural_image_inspection.v1",
            "status": "pass",
            "input": str(input_path),
            "recognition": recognition,
        }, indent=2))
        return 0

    if not args.output:
        raise ValueError("--output is required unless --inspect is used.")
    output_path = Path(args.output).expanduser().resolve()
    if input_path == output_path:
        raise ValueError("Input and output paths must differ so the approved source remains immutable.")
    validate_source(image, allow_alpha=args.allow_alpha)

    selected_profile = recognition["recommended_profile"] if args.profile == "auto" else args.profile
    params = dict(PRESETS[args.preset] if args.preset else PROFILES[selected_profile])
    if args.noise is not None:
        if not 0.0 <= args.noise <= 4.0:
            raise ValueError("--noise must be between 0 and 4.")
        params["noise_sigma"] = args.noise
    if args.blur is not None:
        if not 0.0 <= args.blur <= 1.5:
            raise ValueError("--blur must be between 0 and 1.5.")
        params["blur_sigma"] = args.blur

    preserve_text = args.preserve_text or recognition["contains_visible_text"] or selected_profile == "graphic_text"
    preserve_alpha = recognition["alpha_non_opaque"]
    seed = args.seed if args.seed is not None else stable_seed(input_path)
    finished, protection = process_pixels(image, params, seed, preserve_text=preserve_text)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="sellerpilot-natural-finish-") as temp_dir:
        intermediate = Path(temp_dir) / "pixel-finish.png"
        encoded = Path(temp_dir) / f"encoded{output_path.suffix.lower()}"
        finished.save(intermediate, format="PNG", optimize=False)
        ffmpeg_policy = ffmpeg_finish(
            intermediate,
            encoded,
            ffmpeg_path,
            params,
            protect_exact_pixels=preserve_text,
            preserve_alpha=preserve_alpha,
        )
        os.replace(encoded, output_path)

    alpha_verification = {
        "required": preserve_alpha,
        "status": "not_required",
        "input_alpha_sha256": None,
        "output_alpha_sha256": None,
    }
    if preserve_alpha:
        input_alpha_sha256 = sha256_bytes(image.getchannel("A").tobytes())
        with Image.open(output_path) as rendered:
            if "A" not in rendered.getbands():
                output_path.unlink(missing_ok=True)
                raise RuntimeError("Adaptive natural finish lost the required alpha channel.")
            output_alpha_sha256 = sha256_bytes(rendered.getchannel("A").tobytes())
        if input_alpha_sha256 != output_alpha_sha256:
            output_path.unlink(missing_ok=True)
            raise RuntimeError("Adaptive natural finish changed protected alpha pixels.")
        alpha_verification = {
            "required": True,
            "status": "pass",
            "input_alpha_sha256": input_alpha_sha256,
            "output_alpha_sha256": output_alpha_sha256,
        }

    operations = [
        "adaptive_image_classification",
        "spectral_periodic_artifact_diagnostics",
        "conditional_fft_periodic_artifact_suppression",
        "signal_dependent_luminance_chroma_sensor_grain",
        "subtle_filmic_tone_curve",
        "profile_subtle_lens_vignette",
        "profile_bounded_micro_blur_and_detail_recovery",
        "profile_micro_contrast_and_brightness",
        "ffmpeg_temporal_uniform_grain_and_output_encode",
    ]
    if protection["text_protection_applied"]:
        operations.append("text_region_pixel_restoration")
    if protection["alpha_preserved"]:
        operations.append("alpha_channel_preservation")

    report = {
        "schema_version": "sellerpilot.natural_image_finish_asset.v2",
        "status": "pass",
        "input": str(input_path),
        "output": str(output_path),
        "input_sha256": sha256_file(input_path),
        "output_sha256": sha256_file(output_path),
        "width": recognition["width"],
        "height": recognition["height"],
        "preset": args.preset,
        "selected_profile": selected_profile,
        "seed": seed,
        "parameters": params,
        "recognition": recognition,
        "protection": protection,
        "alpha_verification": alpha_verification,
        "ffmpeg_policy": ffmpeg_policy,
        "operations": operations,
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
