#!/usr/bin/env python3
"""FASHN AI Virtual Try-On Test Script.

Supports single test and matrix test modes.
Uses FASHN API v1 with tryon-v1.6 model.
"""

import argparse
import base64
import os
import sys
import time
from pathlib import Path

import requests

API_BASE = "https://api.fashn.ai/v1"
API_KEY = os.environ.get("FASHN_API_KEY", "")


def get_headers():
    return {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }


def image_to_data_uri(path: str) -> str:
    """Convert a local image file to a data URI."""
    p = Path(path)
    suffix = p.suffix.lower().lstrip(".")
    if suffix == "jpg":
        suffix = "jpeg"
    with open(p, "rb") as f:
        encoded = base64.b64encode(f.read()).decode()
    return f"data:image/{suffix};base64,{encoded}"


def resolve_image(path_or_url: str) -> str:
    """Return a URL or convert local path to data URI."""
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        return path_or_url
    if path_or_url.startswith("data:"):
        return path_or_url
    return image_to_data_uri(path_or_url)


def submit_tryon(model_image: str, garment_image: str, category: str = "one-pieces",
                 mode: str = "quality", garment_photo_type: str = "auto") -> str:
    """Submit a try-on request. Returns prediction ID."""
    inputs = {
        "model_image": resolve_image(model_image),
        "garment_image": resolve_image(garment_image),
        "category": category,
        "mode": mode,
        "garment_photo_type": garment_photo_type,
    }
    payload = {
        "model_name": "tryon-v1.6",
        "inputs": inputs,
    }
    resp = requests.post(
        f"{API_BASE}/run",
        headers=get_headers(),
        json=payload,
        timeout=60,
    )
    if resp.status_code != 200:
        print(f"  API error {resp.status_code}: {resp.text[:500]}")
        resp.raise_for_status()
    data = resp.json()
    pred_id = data.get("id")
    if not pred_id:
        raise RuntimeError(f"No prediction ID in response: {data}")
    return pred_id


def poll_result(pred_id: str, timeout: int = 300, interval: int = 5) -> str:
    """Poll for result. Returns output image URL."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = requests.get(
            f"{API_BASE}/status/{pred_id}",
            headers=get_headers(),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        status = data.get("status")
        if status == "completed":
            output = data.get("output")
            if isinstance(output, list) and output:
                return output[0]
            if isinstance(output, str):
                return output
            raise RuntimeError(f"Unexpected output format: {data}")
        elif status == "failed":
            error = data.get("error", "unknown error")
            raise RuntimeError(f"Prediction {pred_id} failed: {error}")
        time.sleep(interval)
    raise TimeoutError(f"Prediction {pred_id} timed out after {timeout}s")


def download_image(url: str, output_path: str):
    """Download an image from URL to local file."""
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(resp.content)
    print(f"  Saved: {output_path}")


def run_single(args):
    """Run a single try-on test."""
    print(f"Submitting try-on...")
    print(f"  Model: {args.model_photo}")
    print(f"  Dress: {args.dress_image}")
    pred_id = submit_tryon(
        args.model_photo, args.dress_image,
        category=args.category, mode=args.mode,
        garment_photo_type=args.garment_photo_type,
    )
    print(f"  Prediction ID: {pred_id}")
    print(f"  Polling for result...")
    output_url = poll_result(pred_id)
    print(f"  Output URL: {output_url}")
    download_image(output_url, args.output)
    print("Done!")


def run_matrix(args):
    """Run matrix test: N models x M dresses."""
    models = [line.strip() for line in open(args.models_file) if line.strip() and not line.startswith("#")]
    dresses = [line.strip() for line in open(args.dresses_file) if line.strip() and not line.startswith("#")]

    print(f"Matrix test: {len(models)} models x {len(dresses)} dresses = {len(models) * len(dresses)} tests")
    print(f"Credits that will be used: {len(models) * len(dresses)}")

    os.makedirs(args.output_dir, exist_ok=True)

    for mi, model in enumerate(models):
        for di, dress in enumerate(dresses):
            label = f"m{mi:02d}_d{di:02d}"
            output_path = os.path.join(args.output_dir, f"{label}.png")
            print(f"\n[{label}] Submitting...")
            print(f"  Model: {model}")
            print(f"  Dress: {dress}")
            try:
                pred_id = submit_tryon(
                    model, dress,
                    category=args.category, mode=args.mode,
                    garment_photo_type=args.garment_photo_type,
                )
                print(f"  Prediction ID: {pred_id}")
                output_url = poll_result(pred_id)
                download_image(output_url, output_path)
            except Exception as e:
                print(f"  ERROR: {e}")


def check_credits():
    """Check remaining credits."""
    resp = requests.get(
        f"{API_BASE}/credits",
        headers=get_headers(),
        timeout=30,
    )
    print(f"Credits: {resp.json()}")


def main():
    parser = argparse.ArgumentParser(description="FASHN AI Try-On Test Script")
    parser.add_argument("--category", default="one-pieces", help="Garment category")
    parser.add_argument("--mode", default="quality", help="Generation mode")
    parser.add_argument("--garment-photo-type", default="auto", help="Garment photo type")
    parser.add_argument("--check-credits", action="store_true", help="Check remaining credits")

    # Single mode
    parser.add_argument("--model-photo", help="Model photo path or URL")
    parser.add_argument("--dress-image", help="Dress image path or URL")
    parser.add_argument("--output", help="Output path for single test")

    # Matrix mode
    parser.add_argument("--models-file", help="File with model photo URLs/paths")
    parser.add_argument("--dresses-file", help="File with dress image URLs/paths")
    parser.add_argument("--output-dir", help="Output directory for matrix test")

    args = parser.parse_args()

    if not API_KEY:
        print("ERROR: FASHN_API_KEY environment variable not set")
        sys.exit(1)

    if args.check_credits:
        check_credits()
        return

    if args.models_file and args.dresses_file and args.output_dir:
        run_matrix(args)
    elif args.model_photo and args.dress_image and args.output:
        run_single(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
