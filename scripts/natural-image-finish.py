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
        "material_texture_strength": 0.16,
        "surface_mottle_strength": 0.10,
        "highlight_rolloff": 0.06,
        "white_balance_strength": 0.035,
        "local_contrast_strength": 0.045,
        "midtone_contrast": 0.018,
        "shadow_toe": 0.010,
        "lens_edge_softness": 0.010,
        "lens_highlight_bloom": 0.006,
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
        "material_texture_strength": 0.28,
        "surface_mottle_strength": 0.18,
        "highlight_rolloff": 0.10,
        "white_balance_strength": 0.050,
        "local_contrast_strength": 0.065,
        "midtone_contrast": 0.026,
        "shadow_toe": 0.014,
        "lens_edge_softness": 0.014,
        "lens_highlight_bloom": 0.010,
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
        "material_texture_strength": 0.42,
        "surface_mottle_strength": 0.28,
        "highlight_rolloff": 0.15,
        "white_balance_strength": 0.070,
        "local_contrast_strength": 0.090,
        "midtone_contrast": 0.036,
        "shadow_toe": 0.020,
        "lens_edge_softness": 0.020,
        "lens_highlight_bloom": 0.014,
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
        "material_texture_strength": 0.34,
        "surface_mottle_strength": 0.22,
        "highlight_rolloff": 0.12,
        "white_balance_strength": 0.052,
        "local_contrast_strength": 0.074,
        "midtone_contrast": 0.030,
        "shadow_toe": 0.016,
        "lens_edge_softness": 0.018,
        "lens_highlight_bloom": 0.012,
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
        "material_texture_strength": 0.24,
        "surface_mottle_strength": 0.12,
        "highlight_rolloff": 0.08,
        "white_balance_strength": 0.034,
        "local_contrast_strength": 0.044,
        "midtone_contrast": 0.018,
        "shadow_toe": 0.008,
        "lens_edge_softness": 0.008,
        "lens_highlight_bloom": 0.006,
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
        "material_texture_strength": 0.18,
        "surface_mottle_strength": 0.06,
        "highlight_rolloff": 0.03,
        "white_balance_strength": 0.020,
        "local_contrast_strength": 0.055,
        "midtone_contrast": 0.012,
        "shadow_toe": 0.004,
        "lens_edge_softness": 0.0,
        "lens_highlight_bloom": 0.0,
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
        "material_texture_strength": 0.0,
        "surface_mottle_strength": 0.0,
        "highlight_rolloff": 0.0,
        "white_balance_strength": 0.0,
        "local_contrast_strength": 0.0,
        "midtone_contrast": 0.0,
        "shadow_toe": 0.0,
        "lens_edge_softness": 0.0,
        "lens_highlight_bloom": 0.0,
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
        "material_texture_strength": 0.08,
        "surface_mottle_strength": 0.02,
        "highlight_rolloff": 0.0,
        "white_balance_strength": 0.0,
        "local_contrast_strength": 0.010,
        "midtone_contrast": 0.0,
        "shadow_toe": 0.0,
        "lens_edge_softness": 0.0,
        "lens_highlight_bloom": 0.0,
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
        "material_texture_strength": 0.22,
        "surface_mottle_strength": 0.12,
        "highlight_rolloff": 0.06,
        "white_balance_strength": 0.030,
        "local_contrast_strength": 0.040,
        "midtone_contrast": 0.014,
        "shadow_toe": 0.006,
        "lens_edge_softness": 0.006,
        "lens_highlight_bloom": 0.004,
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


def smoothstep(edge0: float, edge1: float, value: np.ndarray | float) -> np.ndarray:
    x = np.clip((value - edge0) / max(1e-6, edge1 - edge0), 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def smooth_material_mask(rgb: np.ndarray) -> tuple[np.ndarray, dict[str, float]]:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.float32)
    grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    gradient = cv2.magnitude(grad_x, grad_y)
    low_gradient = 1.0 - smoothstep(5.0, 30.0, gradient)
    mid_to_high_luma = smoothstep(52.0, 118.0, gray) * (1.0 - smoothstep(248.0, 255.0, gray))
    low_to_mid_saturation = 1.0 - smoothstep(96.0, 190.0, hsv[:, :, 1])
    mask = np.clip(low_gradient * mid_to_high_luma * (0.42 + 0.58 * low_to_mid_saturation), 0.0, 1.0)
    mask = ndimage.gaussian_filter(mask, sigma=1.2, mode="reflect")
    coverage = float(np.mean(mask > 0.28))
    return mask.astype(np.float32), {
        "coverage": round(coverage, 6),
        "mean_strength": round(float(np.mean(mask)), 6),
        "max_strength": round(float(np.max(mask)), 6),
    }


def image_visual_metrics(rgb: np.ndarray) -> dict[str, float]:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    edges = cv2.Canny(gray, 80, 180)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    neutral = (hsv[:, :, 1] < 86) & (gray > 28) & (gray < 246)
    if np.any(neutral):
        a_cast = float(np.mean(lab[:, :, 1][neutral] - 128.0))
        b_cast = float(np.mean(lab[:, :, 2][neutral] - 128.0))
    else:
        a_cast = float(np.mean(lab[:, :, 1] - 128.0))
        b_cast = float(np.mean(lab[:, :, 2] - 128.0))
    laplacian = cv2.Laplacian(gray, cv2.CV_32F)
    return {
        "edge_density": round(float(np.count_nonzero(edges)) / max(1, gray.size), 6),
        "dark_ratio": round(float(np.count_nonzero(gray <= 48)) / max(1, gray.size), 6),
        "highlight_ratio": round(float(np.count_nonzero(gray >= 218)) / max(1, gray.size), 6),
        "warm_highlight_ratio": round(float(np.count_nonzero((gray >= 188) & (hsv[:, :, 1] <= 82))) / max(1, gray.size), 6),
        "luminance_std": round(float(np.std(gray)), 4),
        "mean_saturation": round(float(np.mean(hsv[:, :, 1])), 4),
        "local_contrast_laplacian": round(float(np.mean(np.abs(laplacian))) / 255.0, 6),
        "lab_neutral_a_cast": round(a_cast, 4),
        "lab_neutral_b_cast": round(b_cast, 4),
        "white_balance_deviation": round(float(np.sqrt(a_cast * a_cast + b_cast * b_cast)), 4),
    }


def classify_visual_state(
    selected_profile: str,
    contains_visible_text: bool,
    alpha_non_opaque: bool,
    metrics: dict[str, float],
    smooth_surface: dict[str, float],
    role_signals: dict[str, bool],
    spectral_metrics: dict[str, Any],
) -> dict[str, Any]:
    if alpha_non_opaque or selected_profile == "transparent_asset":
        return {"primary": "transparent_cutout_asset", "secondary": [], "confidence": 1.0}
    if contains_visible_text or selected_profile == "graphic_text":
        return {"primary": "graphic_text_layout", "secondary": [], "confidence": 1.0}

    secondary: list[str] = []
    smooth_coverage = float(smooth_surface.get("coverage", 0.0))
    if metrics["highlight_ratio"] > 0.34 or metrics["warm_highlight_ratio"] > 0.26:
        secondary.append("high_key_soft_product")
    if metrics["dark_ratio"] > 0.32:
        secondary.append("low_key_moody_scene")
    if (
        metrics["edge_density"] < 0.030
        and metrics["local_contrast_laplacian"] < 0.018
        and float(spectral_metrics.get("high_frequency_rolloff", 1.0)) < 0.90
    ):
        secondary.append("flat_ai_render")
    if metrics["highlight_ratio"] > 0.08 and metrics["local_contrast_laplacian"] > 0.020:
        secondary.append("glossy_reflective_surface")
    if selected_profile == "macro_detail" or role_signals.get("detail"):
        secondary.append("macro_texture_detail")
    if role_signals.get("scene"):
        secondary.append("lifestyle_camera_scene")
    if selected_profile == "studio_product" or role_signals.get("studio"):
        secondary.append("studio_clean_product")
    if smooth_coverage > 0.34:
        secondary.append("matte_or_smooth_surface")

    if "flat_ai_render" in secondary:
        primary = "flat_ai_render"
    elif "high_key_soft_product" in secondary:
        primary = "high_key_soft_product"
    elif "low_key_moody_scene" in secondary:
        primary = "low_key_moody_scene"
    elif "glossy_reflective_surface" in secondary:
        primary = "glossy_reflective_surface"
    elif "macro_texture_detail" in secondary:
        primary = "macro_texture_detail"
    elif "lifestyle_camera_scene" in secondary:
        primary = "lifestyle_camera_scene"
    else:
        primary = "studio_clean_product" if selected_profile == "studio_product" else "balanced_camera_finish"

    unique_secondary = []
    for item in secondary:
        if item not in unique_secondary:
            unique_secondary.append(item)
    confidence = min(0.98, 0.42 + 0.08 * len(unique_secondary))
    return {
        "primary": primary,
        "secondary": unique_secondary,
        "confidence": round(confidence, 3),
    }


def apply_camera_white_balance(
    rgb: np.ndarray,
    params: dict[str, float],
    preserve_text: bool,
) -> tuple[np.ndarray, dict[str, Any]]:
    strength = float(params.get("white_balance_strength", 0.0))
    if preserve_text or strength <= 0:
        return rgb.copy(), {
            "applied": False,
            "strength": round(strength, 4),
            "reason": "protected_text_or_zero_strength" if preserve_text else "zero_strength",
        }
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    neutral = (hsv[:, :, 1] < 82) & (gray > 42) & (gray < 242)
    sample = rgb[neutral] if np.any(neutral) else rgb.reshape(-1, 3)
    means = np.maximum(1.0, np.mean(sample.astype(np.float32), axis=0))
    target = float(np.mean(means))
    correction = 1.0 + np.clip((target / means) - 1.0, -0.12, 0.12) * strength
    corrected = np.clip(rgb.astype(np.float32) * correction[None, None, :], 0, 255).astype(np.uint8)
    return corrected, {
        "applied": True,
        "strength": round(strength, 4),
        "neutral_sample_coverage": round(float(np.count_nonzero(neutral)) / max(1, gray.size), 6),
        "channel_means": [round(float(value), 4) for value in means],
        "correction": [round(float(value), 5) for value in correction],
    }


def apply_photoshop_local_contrast(
    rgb: np.ndarray,
    params: dict[str, float],
    preserve_text: bool,
) -> tuple[np.ndarray, dict[str, Any]]:
    strength = float(params.get("local_contrast_strength", 0.0))
    if preserve_text or strength <= 0:
        return rgb.copy(), {
            "applied": False,
            "strength": round(strength, 4),
            "reason": "protected_text_or_zero_strength" if preserve_text else "zero_strength",
        }
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    luminance = lab[:, :, 0]
    sigma = max(2.0, min(luminance.shape) / 185.0)
    base = ndimage.gaussian_filter(luminance, sigma=sigma, mode="reflect")
    detail = luminance - base
    edge_guard = 1.0 - smoothstep(18.0, 70.0, np.abs(detail))
    local = luminance + detail * strength * (0.35 + 0.65 * edge_guard)
    lab[:, :, 0] = np.clip(local, 0, 255)
    output = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB)
    return output, {
        "applied": True,
        "strength": round(strength, 4),
        "sigma": round(float(sigma), 4),
        "detail_abs_mean": round(float(np.mean(np.abs(detail))) / 255.0, 6),
    }


def apply_camera_lens_post(
    rgb: np.ndarray,
    params: dict[str, float],
    preserve_text: bool,
) -> tuple[np.ndarray, dict[str, Any]]:
    edge_softness = float(params.get("lens_edge_softness", 0.0))
    bloom_strength = float(params.get("lens_highlight_bloom", 0.0))
    if preserve_text or (edge_softness <= 0 and bloom_strength <= 0):
        return rgb.copy(), {
            "applied": False,
            "edge_softness": round(edge_softness, 4),
            "highlight_bloom": round(bloom_strength, 4),
            "reason": "protected_text_or_zero_strength" if preserve_text else "zero_strength",
        }

    output = rgb.astype(np.float32)
    height, width = rgb.shape[:2]
    y, x = np.indices((height, width))
    center_y = (height - 1) / 2.0
    center_x = (width - 1) / 2.0
    radius = np.sqrt(((x - center_x) / max(1.0, center_x)) ** 2 + ((y - center_y) / max(1.0, center_y)) ** 2)
    edge_mask = smoothstep(0.58, 1.25, radius).astype(np.float32)
    if edge_softness > 0:
        blurred = cv2.GaussianBlur(rgb, (0, 0), sigmaX=0.55, sigmaY=0.55).astype(np.float32)
        mix = np.clip(edge_mask * edge_softness, 0.0, 0.12)
        output = output * (1.0 - mix[:, :, None]) + blurred * mix[:, :, None]
    if bloom_strength > 0:
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
        highlight = smoothstep(214.0, 255.0, gray).astype(np.float32)
        glow = cv2.GaussianBlur(rgb, (0, 0), sigmaX=max(1.2, min(height, width) / 360.0)).astype(np.float32)
        mix = np.clip(highlight * bloom_strength, 0.0, 0.08)
        output = output * (1.0 - mix[:, :, None]) + glow * mix[:, :, None]
    return np.clip(output, 0, 255).astype(np.uint8), {
        "applied": True,
        "edge_softness": round(edge_softness, 4),
        "highlight_bloom": round(bloom_strength, 4),
        "edge_mask_mean": round(float(np.mean(edge_mask)), 6),
    }


def apply_material_microtexture(
    rgb: np.ndarray,
    params: dict[str, float],
    rng: np.random.Generator,
    preserve_text: bool,
) -> tuple[np.ndarray, dict[str, Any]]:
    strength = float(params.get("material_texture_strength", 0.0))
    mottle_strength = float(params.get("surface_mottle_strength", 0.0))
    if preserve_text or (strength <= 0 and mottle_strength <= 0):
        return rgb.copy(), {
            "applied": False,
            "reason": "protected_text_or_zero_strength" if preserve_text else "zero_strength",
            "material_texture_strength": round(strength, 4),
            "surface_mottle_strength": round(mottle_strength, 4),
        }

    mask, mask_metrics = smooth_material_mask(rgb)
    ycrcb = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb).astype(np.float32)
    y = ycrcb[:, :, 0]
    height, width = y.shape
    fine = rng.normal(0.0, 1.0, y.shape).astype(np.float32)
    fine = fine - ndimage.gaussian_filter(fine, sigma=1.05, mode="reflect")
    fine_std = float(np.std(fine)) or 1.0
    fine /= fine_std

    medium = rng.normal(0.0, 1.0, y.shape).astype(np.float32)
    medium = ndimage.gaussian_filter(medium, sigma=max(0.9, min(height, width) / 720.0), mode="reflect")
    medium -= ndimage.gaussian_filter(medium, sigma=max(2.2, min(height, width) / 210.0), mode="reflect")
    medium_std = float(np.std(medium)) or 1.0
    medium /= medium_std

    luma_boost = 0.55 + 0.45 * np.sqrt(np.clip(y, 0, 255) / 255.0)
    texture_delta = (0.58 * fine + 0.42 * medium) * mask * luma_boost * strength * 2.35

    mottle = rng.normal(0.0, 1.0, y.shape).astype(np.float32)
    mottle = ndimage.gaussian_filter(mottle, sigma=max(12.0, min(height, width) / 34.0), mode="reflect")
    mottle -= float(np.mean(mottle))
    mottle_std = float(np.std(mottle)) or 1.0
    mottle /= mottle_std
    mottle_delta = mottle * mask * mottle_strength * 2.4

    ycrcb[:, :, 0] = np.clip(y + texture_delta + mottle_delta, 0, 255)
    chroma_drift = ndimage.gaussian_filter(
        rng.normal(0.0, 1.0, y.shape).astype(np.float32),
        sigma=max(10.0, min(height, width) / 42.0),
        mode="reflect",
    )
    chroma_drift -= float(np.mean(chroma_drift))
    chroma_std = float(np.std(chroma_drift)) or 1.0
    chroma_drift /= chroma_std
    ycrcb[:, :, 1] = np.clip(ycrcb[:, :, 1] + chroma_drift * mask * mottle_strength * 0.42, 0, 255)
    ycrcb[:, :, 2] = np.clip(ycrcb[:, :, 2] - chroma_drift * mask * mottle_strength * 0.34, 0, 255)

    return cv2.cvtColor(ycrcb.astype(np.uint8), cv2.COLOR_YCrCb2RGB), {
        "applied": True,
        "material_texture_strength": round(strength, 4),
        "surface_mottle_strength": round(mottle_strength, 4),
        "mask": mask_metrics,
        "texture_delta_abs_mean": round(float(np.mean(np.abs(texture_delta))), 5),
        "mottle_delta_abs_mean": round(float(np.mean(np.abs(mottle_delta))), 5),
    }


def apply_highlight_shoulder(rgb: np.ndarray, params: dict[str, float], preserve_text: bool) -> tuple[np.ndarray, dict[str, Any]]:
    amount = float(params.get("highlight_rolloff", 0.0))
    if preserve_text or amount <= 0:
        return rgb, {
            "applied": False,
            "amount": round(amount, 4),
            "reason": "protected_text_or_zero_strength" if preserve_text else "zero_strength",
        }
    ycrcb = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb).astype(np.float32)
    y = ycrcb[:, :, 0]
    highlight = smoothstep(176.0, 252.0, y)
    shoulder = highlight * highlight * amount * 24.0
    ycrcb[:, :, 0] = np.clip(y - shoulder, 0, 255)
    ycrcb[:, :, 1] = np.clip(ycrcb[:, :, 1] - highlight * amount * 0.85, 0, 255)
    ycrcb[:, :, 2] = np.clip(ycrcb[:, :, 2] + highlight * amount * 0.65, 0, 255)
    return cv2.cvtColor(ycrcb.astype(np.uint8), cv2.COLOR_YCrCb2RGB), {
        "applied": True,
        "amount": round(amount, 4),
        "highlight_coverage": round(float(np.mean(highlight > 0.08)), 6),
        "mean_luma_reduction": round(float(np.mean(shoulder)), 5),
    }


def apply_filmic_tone_curve(rgb: np.ndarray, params: dict[str, float]) -> tuple[np.ndarray, dict[str, float]]:
    amount = float(params.get("tone_curve", 0.0))
    midtone = float(params.get("midtone_contrast", 0.0))
    shadow_toe = float(params.get("shadow_toe", 0.0))
    if amount <= 0 and midtone <= 0 and shadow_toe <= 0:
        return rgb, {
            "tone_curve_amount": 0.0,
            "midtone_contrast": 0.0,
            "shadow_toe": 0.0,
        }
    normalized = rgb.astype(np.float32) / 255.0
    centered = normalized - 0.5
    curve = normalized + amount * centered * (1.0 - 4.0 * centered * centered)
    if midtone > 0:
        mid_weight = np.clip(1.0 - 4.0 * centered * centered, 0.0, 1.0)
        curve = 0.5 + (curve - 0.5) * (1.0 + midtone * mid_weight)
    if shadow_toe > 0:
        shadow_weight = 1.0 - smoothstep(0.05, 0.42, curve)
        curve = curve - shadow_toe * shadow_weight * curve * (1.0 - curve)
    curve = np.clip(curve, 0.0, 1.0)
    return (curve * 255.0).astype(np.uint8), {
        "tone_curve_amount": round(amount, 5),
        "midtone_contrast": round(midtone, 5),
        "shadow_toe": round(shadow_toe, 5),
    }


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


def evaluate_camera_photoshop_naturalness_ab_review(
    before_metrics: dict[str, float],
    after_metrics: dict[str, float],
    delta: dict[str, float],
    selected_profile: str,
    visual_state: dict[str, Any],
    params: dict[str, float],
    preserve_text: bool,
    preserve_alpha: bool,
) -> dict[str, Any]:
    """Score whether the camera/Photoshop finish improved naturalness without over-processing.

    This is a perceptual A/B quality check, not detector targeting. It keeps the
    processor honest: enough real-camera texture and tone movement to soften a
    plastic render, but bounded changes for product identity, copy, and alpha.
    """
    primary_state = str(visual_state.get("primary") or "")
    secondary_states = [str(item) for item in visual_state.get("secondary", [])]
    state_names = {primary_state, *secondary_states}
    protected_asset = preserve_text or preserve_alpha or selected_profile in {"graphic_text", "transparent_asset"}

    profile_limits = {
        "photographic_scene": {"target_min_mae": 0.45, "warn_mae": 11.0, "block_mae": 18.0, "sat_warn": 8.5, "sat_block": 14.0, "luma_warn": 15.0, "luma_block": 25.0},
        "hybrid_commerce": {"target_min_mae": 0.35, "warn_mae": 9.0, "block_mae": 15.0, "sat_warn": 7.0, "sat_block": 12.0, "luma_warn": 13.0, "luma_block": 22.0},
        "studio_product": {"target_min_mae": 0.20, "warn_mae": 7.0, "block_mae": 12.0, "sat_warn": 6.0, "sat_block": 10.0, "luma_warn": 11.0, "luma_block": 18.0},
        "macro_detail": {"target_min_mae": 0.12, "warn_mae": 5.0, "block_mae": 9.0, "sat_warn": 5.0, "sat_block": 8.0, "luma_warn": 9.0, "luma_block": 14.0},
        "graphic_text": {"target_min_mae": 0.0, "warn_mae": 2.0, "block_mae": 4.0, "sat_warn": 2.0, "sat_block": 4.0, "luma_warn": 4.0, "luma_block": 7.0},
        "transparent_asset": {"target_min_mae": 0.0, "warn_mae": 3.0, "block_mae": 6.0, "sat_warn": 3.0, "sat_block": 6.0, "luma_warn": 5.0, "luma_block": 9.0},
    }
    limits = profile_limits.get(selected_profile, profile_limits["photographic_scene"])
    mae = float(delta.get("mean_absolute_rgb", 0.0))
    luma_delta = float(delta.get("luminance_std", 0.0))
    saturation_delta = float(delta.get("mean_saturation", 0.0))
    local_contrast_delta = float(delta.get("local_contrast_laplacian", 0.0))
    wb_delta = float(delta.get("white_balance_deviation", 0.0))
    before_wb = float(before_metrics.get("white_balance_deviation", 0.0))
    after_wb = float(after_metrics.get("white_balance_deviation", 0.0))
    before_local = float(before_metrics.get("local_contrast_laplacian", 0.0))

    score = 84.0
    improvements: list[str] = []
    warnings: list[str] = []
    blockers: list[str] = []

    if protected_asset:
        score += 6.0
        improvements.append("protected_asset_finish_kept_changes_bounded")
    elif mae >= limits["target_min_mae"]:
        score += 4.0
        improvements.append("visible_but_bounded_pixel_movement")
    else:
        warnings.append("natural_finish_may_be_too_subtle_for_visible_ab_difference")
        score -= 4.0

    needs_clarity = before_local < 0.022 or "flat_ai_render" in state_names or "high_key_soft_product" in state_names
    if local_contrast_delta > 0.00035 and needs_clarity:
        score += 6.0
        improvements.append("local_contrast_clarity_improved_for_flat_or_high_key_render")
    elif local_contrast_delta > 0.00012:
        score += 3.0
        improvements.append("local_contrast_clarity_slightly_improved")
    elif needs_clarity and not protected_asset:
        warnings.append("flat_or_high_key_image_received_little_local_contrast_lift")
        score -= 4.0
    if local_contrast_delta > 0.018:
        warnings.append("local_contrast_clarity_near_overprocessed_limit")
        score -= 5.0
    if local_contrast_delta > 0.032:
        blockers.append("local_contrast_clarity_overprocessed")
        score -= 18.0

    if before_wb > 2.5 and after_wb <= before_wb + 0.25:
        score += 4.0
        improvements.append("white_balance_or_color_temperature_not_worsened")
    elif wb_delta > 1.75 and not protected_asset:
        warnings.append("white_balance_deviation_worsened")
        score -= 6.0
    if wb_delta > 4.5:
        blockers.append("white_balance_color_temperature_shift_too_large")
        score -= 20.0

    saturation_metric_is_reliable = not protected_asset or mae > limits["warn_mae"]
    if not saturation_metric_is_reliable:
        score += 2.0
        improvements.append("protected_asset_saturation_delta_ignored_when_mean_pixel_change_is_low")
    elif abs(saturation_delta) <= limits["sat_warn"]:
        score += 3.0
        improvements.append("saturation_shift_within_camera_postproduction_bounds")
    else:
        warnings.append("saturation_shift_near_overprocessed_limit")
        score -= 7.0
    if saturation_metric_is_reliable and abs(saturation_delta) > limits["sat_block"]:
        blockers.append("saturation_shift_too_large_for_profile")
        score -= 18.0

    luma_metric_is_reliable = not protected_asset or mae > limits["warn_mae"]
    if not luma_metric_is_reliable:
        score += 2.0
        improvements.append("protected_asset_luminance_delta_ignored_when_mean_pixel_change_is_low")
    elif abs(luma_delta) <= limits["luma_warn"]:
        score += 3.0
        improvements.append("luminance_distribution_change_within_safe_bounds")
    else:
        warnings.append("luminance_distribution_shift_near_overprocessed_limit")
        score -= 7.0
    if luma_metric_is_reliable and abs(luma_delta) > limits["luma_block"]:
        blockers.append("luminance_distribution_shift_too_large_for_profile")
        score -= 18.0

    if mae > limits["warn_mae"]:
        warnings.append("mean_pixel_change_near_overprocessed_limit")
        score -= 8.0
    if mae > limits["block_mae"]:
        blockers.append("mean_pixel_change_too_large_for_profile")
        score -= 24.0

    if "flat_ai_render" in state_names or "matte_or_smooth_surface" in state_names:
        if float(params.get("material_texture_strength", 0.0)) > 0 and not protected_asset:
            score += 4.0
            improvements.append("smooth_material_texture_path_enabled")
        else:
            warnings.append("smooth_or_flat_render_did_not_receive_material_texture_path")
            score -= 3.0

    status = "pass"
    if blockers:
        status = "blocked"
    elif warnings:
        status = "warn"
    return {
        "status": status,
        "score": round(float(np.clip(score, 0.0, 100.0)), 2),
        "improvements": improvements,
        "warnings": warnings,
        "blockers": blockers,
        "limits": {
            "profile": selected_profile,
            "protected_asset": protected_asset,
            "target_min_mean_absolute_rgb": limits["target_min_mae"],
            "warn_mean_absolute_rgb": limits["warn_mae"],
            "block_mean_absolute_rgb": limits["block_mae"],
            "warn_abs_saturation_delta": limits["sat_warn"],
            "block_abs_saturation_delta": limits["sat_block"],
            "warn_abs_luminance_std_delta": limits["luma_warn"],
            "block_abs_luminance_std_delta": limits["luma_block"],
            "block_white_balance_deviation_delta": 4.5,
            "block_local_contrast_delta": 0.032,
        },
        "policy": "perceptual_camera_photoshop_quality_not_detector_targeting",
    }


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
    visual_metrics = image_visual_metrics(rgb)
    _, text_metrics = text_protection_mask(rgb)
    _, smooth_surface_metrics = smooth_material_mask(rgb)
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
    elif edge_density >= 0.14 and visual_metrics["luminance_std"] >= 50:
        visual_class = "hybrid_commerce"
    else:
        visual_class = "photographic_scene"
    visual_state = classify_visual_state(
        visual_class,
        bool(contains_visible_text),
        alpha_non_opaque,
        visual_metrics,
        smooth_surface_metrics,
        {
            "graphic": graphic_role,
            "scene": scene_role,
            "detail": detail_role,
            "studio": studio_role,
        },
        spectral_metrics,
    )

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
            "luminance_std": visual_metrics["luminance_std"],
            "mean_saturation": visual_metrics["mean_saturation"],
            "warm_highlight_ratio": visual_metrics["warm_highlight_ratio"],
            "dark_ratio": visual_metrics["dark_ratio"],
            "highlight_ratio": visual_metrics["highlight_ratio"],
            "local_contrast_laplacian": visual_metrics["local_contrast_laplacian"],
            "white_balance_deviation": visual_metrics["white_balance_deviation"],
            "lab_neutral_a_cast": visual_metrics["lab_neutral_a_cast"],
            "lab_neutral_b_cast": visual_metrics["lab_neutral_b_cast"],
            "periodic_peak_score": spectral_metrics["periodic_peak_score"],
            "directional_anisotropy": spectral_metrics["directional_anisotropy"],
            "high_frequency_rolloff": spectral_metrics["high_frequency_rolloff"],
        },
        "smooth_surface": smooth_surface_metrics,
        "visual_state": visual_state,
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


def adaptive_parameter_tuning(
    params: dict[str, float],
    selected_profile: str,
    recognition: dict[str, Any],
    preserve_text: bool,
    preserve_alpha: bool,
) -> tuple[dict[str, float], dict[str, Any]]:
    tuned = dict(params)
    metrics = recognition.get("pixel_metrics", {})
    smooth = recognition.get("smooth_surface", {})
    role_signals = recognition.get("role_signals", {})
    visual_state = recognition.get("visual_state", {})
    if preserve_text or preserve_alpha or selected_profile in {"graphic_text", "transparent_asset"}:
        return tuned, {
            "applied": False,
            "reason": "protected_text_or_alpha_profile",
            "risk_score": 0,
            "risk_factors": [],
        }

    edge_density = float(metrics.get("edge_density", 1.0))
    luminance_std = float(metrics.get("luminance_std", 999.0))
    mean_saturation = float(metrics.get("mean_saturation", 999.0))
    warm_highlight_ratio = float(metrics.get("warm_highlight_ratio", 0.0))
    high_frequency_rolloff = float(metrics.get("high_frequency_rolloff", 1.0))
    smooth_coverage = float(smooth.get("coverage", 0.0))
    risk_factors: list[str] = []
    if edge_density < 0.026:
        risk_factors.append("low_edge_density_over_smooth")
    if luminance_std < 58:
        risk_factors.append("compressed_luminance_variation")
    if mean_saturation < 68:
        risk_factors.append("low_saturation_beauty_product_palette")
    if warm_highlight_ratio > 0.18:
        risk_factors.append("large_warm_highlight_surface")
    if high_frequency_rolloff < 0.88:
        risk_factors.append("weak_high_frequency_texture")
    if smooth_coverage > 0.26:
        risk_factors.append("large_smooth_material_regions")
    if role_signals.get("scene") and role_signals.get("studio"):
        risk_factors.append("scene_studio_hybrid_product_render")
    state_names = [visual_state.get("primary"), *visual_state.get("secondary", [])]
    if "flat_ai_render" in state_names:
        risk_factors.append("visual_state_flat_ai_render")
    if "high_key_soft_product" in state_names:
        risk_factors.append("visual_state_high_key_soft_product")
    if "low_key_moody_scene" in state_names:
        risk_factors.append("visual_state_low_key_moody_scene")

    risk_score = len(risk_factors)
    if risk_score < 3:
        return tuned, {
            "applied": False,
            "reason": "naturalism_risk_below_threshold",
            "risk_score": risk_score,
            "risk_factors": risk_factors,
        }

    level = "moderate" if risk_score < 5 else "assertive"
    profile_weight = {
        "photographic_scene": 1.0,
        "hybrid_commerce": 0.85,
        "studio_product": 0.72,
        "macro_detail": 0.45,
    }.get(selected_profile, 0.5)
    level_weight = 1.0 if level == "moderate" else 1.34
    factor = profile_weight * level_weight

    tuned["noise_sigma"] = min(2.15, tuned.get("noise_sigma", 0.0) + 0.26 * factor)
    tuned["chroma_noise_ratio"] = min(0.24, tuned.get("chroma_noise_ratio", 0.0) + 0.018 * factor)
    tuned["material_texture_strength"] = min(0.68, tuned.get("material_texture_strength", 0.0) + 0.16 * factor)
    tuned["surface_mottle_strength"] = min(0.42, tuned.get("surface_mottle_strength", 0.0) + 0.09 * factor)
    tuned["highlight_rolloff"] = min(0.22, tuned.get("highlight_rolloff", 0.0) + 0.055 * factor)
    tuned["tone_curve"] = min(0.012, tuned.get("tone_curve", 0.0) + 0.0015 * factor)
    tuned["sharpen_amount"] = min(0.24, tuned.get("sharpen_amount", 0.0) + 0.018 * factor)
    tuned["ffmpeg_noise"] = min(1.0, tuned.get("ffmpeg_noise", 0.0) + 0.12 * factor)
    tuned["white_balance_strength"] = min(0.11, tuned.get("white_balance_strength", 0.0) + 0.018 * factor)
    tuned["local_contrast_strength"] = min(0.14, tuned.get("local_contrast_strength", 0.0) + 0.022 * factor)
    tuned["midtone_contrast"] = min(0.055, tuned.get("midtone_contrast", 0.0) + 0.010 * factor)
    tuned["shadow_toe"] = min(0.035, tuned.get("shadow_toe", 0.0) + 0.005 * factor)
    tuned["lens_edge_softness"] = min(0.045, tuned.get("lens_edge_softness", 0.0) + 0.006 * factor)
    tuned["lens_highlight_bloom"] = min(0.030, tuned.get("lens_highlight_bloom", 0.0) + 0.004 * factor)
    if "flat_ai_render" in state_names:
        tuned["local_contrast_strength"] = min(0.16, tuned["local_contrast_strength"] + 0.018)
        tuned["midtone_contrast"] = min(0.065, tuned["midtone_contrast"] + 0.010)
    if "high_key_soft_product" in state_names:
        tuned["highlight_rolloff"] = min(0.25, tuned["highlight_rolloff"] + 0.020)
        tuned["lens_highlight_bloom"] = min(0.032, tuned["lens_highlight_bloom"] + 0.004)
    if "low_key_moody_scene" in state_names:
        tuned["shadow_toe"] = min(0.040, tuned["shadow_toe"] + 0.008)
        tuned["noise_sigma"] = min(2.25, tuned["noise_sigma"] + 0.10)
    if selected_profile == "studio_product":
        tuned["blur_sigma"] = min(0.34, max(tuned.get("blur_sigma", 0.0), 0.24))

    return tuned, {
        "applied": True,
        "level": level,
        "risk_score": risk_score,
        "risk_factors": risk_factors,
        "visual_state": visual_state,
        "profile_weight": round(profile_weight, 4),
        "level_weight": round(level_weight, 4),
        "policy": "raise natural material texture only for smooth low-frequency product renders; keep text and alpha protected",
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
    selected_profile: str,
    recognition: dict[str, Any],
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
    white_balanced, white_balance_metrics = apply_camera_white_balance(
        deperiodized,
        params,
        preserve_text=preserve_text,
    )
    material_textured, material_texture_metrics = apply_material_microtexture(
        white_balanced,
        params,
        rng,
        preserve_text=preserve_text,
    )
    noisy, grain_metrics = apply_signal_dependent_sensor_grain(material_textured, params, rng)
    highlight_shaped, highlight_metrics = apply_highlight_shoulder(noisy, params, preserve_text=preserve_text)
    local_contrast, local_contrast_metrics = apply_photoshop_local_contrast(
        highlight_shaped,
        params,
        preserve_text=preserve_text,
    )
    toned, tone_metrics = apply_filmic_tone_curve(local_contrast, params)
    lens_finished, lens_metrics = apply_camera_lens_post(toned, params, preserve_text=preserve_text)
    vignetted, vignette_metrics = apply_subtle_lens_vignette(lens_finished, params)

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
    before_metrics = image_visual_metrics(original)
    after_metrics = image_visual_metrics(processed)
    realism_report = {
        "before": before_metrics,
        "after": after_metrics,
        "delta": {
            "mean_absolute_rgb": round(float(np.mean(np.abs(processed.astype(np.float32) - original.astype(np.float32)))), 5),
            "luminance_std": round(after_metrics["luminance_std"] - before_metrics["luminance_std"], 5),
            "mean_saturation": round(after_metrics["mean_saturation"] - before_metrics["mean_saturation"], 5),
            "local_contrast_laplacian": round(after_metrics["local_contrast_laplacian"] - before_metrics["local_contrast_laplacian"], 6),
            "white_balance_deviation": round(after_metrics["white_balance_deviation"] - before_metrics["white_balance_deviation"], 5),
        },
        "policy": "camera_photoshop_realism_finish_without_detector_targeting",
    }
    realism_report["naturalness_ab_review"] = evaluate_camera_photoshop_naturalness_ab_review(
        before_metrics,
        after_metrics,
        realism_report["delta"],
        selected_profile,
        recognition.get("visual_state", {}),
        params,
        preserve_text=preserve_text,
        preserve_alpha=alpha_requires_preservation,
    )
    result = Image.fromarray(processed, mode="RGB")
    if alpha is not None:
        result.putalpha(alpha)
    return result, {
        "text_protection_applied": bool(preserve_text),
        "text_protection_mode": protection_mode,
        "text_protection": text_metrics,
        "alpha_preserved": alpha_requires_preservation,
        "camera_white_balance": white_balance_metrics,
        "sensor_grain": grain_metrics,
        "material_microtexture": material_texture_metrics,
        "highlight_shoulder": highlight_metrics,
        "photoshop_local_contrast": local_contrast_metrics,
        "tone_curve": tone_metrics,
        "camera_lens_post": lens_metrics,
        "vignette": vignette_metrics,
        "camera_photoshop_realism": realism_report,
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
                selected_profile=profile,
                recognition=inspect_image(source, "", profile == "graphic_text"),
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
    params, parameter_adaptation = adaptive_parameter_tuning(
        params,
        selected_profile,
        recognition,
        preserve_text=preserve_text,
        preserve_alpha=preserve_alpha,
    )
    seed = args.seed if args.seed is not None else stable_seed(input_path)
    finished, protection = process_pixels(
        image,
        params,
        seed,
        preserve_text=preserve_text,
        selected_profile=selected_profile,
        recognition=recognition,
    )

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
        "visual_state_camera_photoshop_realism_classification",
        "camera_white_balance_and_color_temperature",
        "signal_dependent_luminance_chroma_sensor_grain",
        "smooth_material_region_microtexture",
        "surface_mottle_and_chroma_drift",
        "highlight_shoulder_rolloff",
        "photoshop_style_local_contrast_clarity",
        "subtle_filmic_tone_curve",
        "camera_lens_edge_softness_and_highlight_bloom",
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
        "parameter_adaptation": parameter_adaptation,
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
