#!/usr/bin/env python3
"""Fetch the wedding-dress catalog from salon-siluet.ru.

Replaces the previous David's Bridal catalog with dresses from the Russian
salon "Силуэт" (https://salon-siluet.ru/). Uses the public WooCommerce Store
API to enumerate products, then scrapes each product page for the
WooCommerce attribute table (силуэт / материал / рукава / детали). Downloads
the first product image as the card thumbnail.

Outputs:
    catalog/<slug>.jpg                 — card thumbnails (committed)
    catalog/catalog.json               — source-of-truth catalog
    frontend/api/catalog.json          — static API copy (with image_url)

Usage:
    python3 scripts/fetch-siluet-catalog.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
CATALOG_DIR = ROOT / "catalog"
FRONTEND_API_JSON = ROOT / "frontend" / "api" / "catalog.json"

API_BASE = "https://salon-siluet.ru/wp-json/wc/store/v1/products"
# Wedding-dress category. ID, not slug — the Store API "category" param is
# numeric. We can confirm via the wp-sitemap.xml; 43 is the only wedding-dress
# category on the salon's WooCommerce install.
CATEGORY_ID = 43
USER_AGENT = (
    "Mozilla/5.0 (TryWeddingDress catalog importer; "
    "https://tryweddingdress.com; contact@tryweddingdress.com)"
)
HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "ru,en;q=0.8"}

# WooCommerce attribute label → catalog.json key.
# Multi-value attribute strings (e.g. "А-силуэт, Пышное") are split on commas
# and the FIRST value is used so the filter UI gets a small, stable value
# domain instead of every possible combination as a distinct value.
ATTR_LABEL_TO_KEY = {
    "Силуэт / Стиль": "style",
    "Силуэт/Стиль": "style",
    "Силуэт": "style",
    "Материал": "fabric",
    "Ткань": "fabric",
    "Рукава": "sleeves",
    "Детали": "details",
}

VENDOR_NAME = "Силуэт"
SOURCE_HOST = "salon-siluet.ru"


def fetch_all_products() -> list[dict[str, Any]]:
    products: list[dict[str, Any]] = []
    page = 1
    while True:
        params = {
            "per_page": 100,
            "page": page,
            "catalog_visibility": "catalog",
        }
        r = requests.get(API_BASE, params=params, headers=HEADERS, timeout=30)
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        products.extend(batch)
        if len(batch) < 100:
            break
        page += 1
        time.sleep(0.5)
    return products


def parse_attributes(html: str) -> dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    out: dict[str, str] = {}
    for row in soup.select(".woocommerce-product-attributes-item"):
        label = row.select_one(".woocommerce-product-attributes-item__label")
        value = row.select_one(".woocommerce-product-attributes-item__value")
        if not label or not value:
            continue
        key_ru = label.get_text(strip=True)
        key = ATTR_LABEL_TO_KEY.get(key_ru)
        if not key:
            continue
        raw = value.get_text(" ", strip=True)
        first = raw.split(",")[0].strip()
        if first:
            out[key] = first
    return out


def fetch_product_page(url: str) -> dict[str, str]:
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            r.raise_for_status()
            return parse_attributes(r.text)
        except requests.RequestException as e:
            if attempt == 2:
                print(f"  ! attrs failed for {url}: {e}", file=sys.stderr)
                return {}
            time.sleep(1 + attempt)
    return {}


def download_image(url: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 1024:
        return True
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30, stream=True)
            r.raise_for_status()
            tmp = dest.with_suffix(dest.suffix + ".tmp")
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        f.write(chunk)
            tmp.replace(dest)
            return True
        except (requests.RequestException, OSError) as e:
            if attempt == 2:
                print(f"  ! img failed for {url}: {e}", file=sys.stderr)
                return False
            time.sleep(1 + attempt)
    return False


def slug_from(p: dict[str, Any]) -> str:
    s = p.get("slug") or ""
    # Drop the boilerplate prefix "svadebnoe-plate-" for shorter IDs / file names.
    s = re.sub(r"^svadebnoe-plate-", "", s)
    return s


def normalize_price(prices: dict[str, Any]) -> tuple[float | None, str]:
    if not prices:
        return None, "RUB"
    price_str = prices.get("price")
    minor_unit = prices.get("currency_minor_unit", 0)
    currency = prices.get("currency_code") or "RUB"
    if not price_str:
        return None, currency
    try:
        return float(price_str) / (10 ** int(minor_unit)), currency
    except (ValueError, TypeError):
        return None, currency


def main() -> int:
    CATALOG_DIR.mkdir(exist_ok=True)
    print(f"→ Fetching products from {API_BASE} (category id={CATEGORY_ID})…")
    products = fetch_all_products()
    print(f"  got {len(products)} products")

    # Drop accessories — the store has hair pins, veils, capes under the same
    # broad "catalog" route. Wedding dresses always live under /svadebnie-platya/.
    before = len(products)
    products = [
        p for p in products if "/svadebnie-platya/" in (p.get("permalink") or "")
    ]
    print(f"  filtered to {len(products)} wedding dresses ({before - len(products)} accessories dropped)")

    # Sort so JSON ordering is deterministic across runs.
    products.sort(key=lambda p: p.get("slug", ""))

    catalog: list[dict[str, Any]] = []
    skipped: list[str] = []

    # Parallelise attribute scraping (network-bound, salon site is fast).
    with ThreadPoolExecutor(max_workers=6) as ex:
        future_to_p = {
            ex.submit(fetch_product_page, p["permalink"]): p for p in products
        }
        attrs_by_id: dict[int, dict[str, str]] = {}
        for fut in as_completed(future_to_p):
            p = future_to_p[fut]
            try:
                attrs_by_id[p["id"]] = fut.result()
            except Exception as e:  # pragma: no cover
                print(f"  ! attrs error for {p.get('slug')}: {e}", file=sys.stderr)
                attrs_by_id[p["id"]] = {}

    # Download images sequentially-ish (small thread pool to be polite).
    with ThreadPoolExecutor(max_workers=4) as ex:
        future_to_p = {}
        for p in products:
            images = p.get("images") or []
            if not images:
                continue
            src = images[0].get("src")
            if not src:
                continue
            slug = slug_from(p)
            dest = CATALOG_DIR / f"{slug}.jpg"
            future_to_p[ex.submit(download_image, src, dest)] = (p, dest)
        ok_by_id: dict[int, Path] = {}
        for fut in as_completed(future_to_p):
            p, dest = future_to_p[fut]
            try:
                if fut.result():
                    ok_by_id[p["id"]] = dest
            except Exception as e:  # pragma: no cover
                print(f"  ! download error for {p.get('slug')}: {e}", file=sys.stderr)

    for p in products:
        slug = slug_from(p)
        if not slug:
            skipped.append(f"(no slug) id={p.get('id')}")
            continue
        if p["id"] not in ok_by_id:
            skipped.append(f"{slug}: no image")
            continue
        price, currency = normalize_price(p.get("prices") or {})
        attrs = attrs_by_id.get(p["id"], {})
        item: dict[str, Any] = {
            "id": f"siluet_{slug}",
            "name": p.get("name", "").strip(),
            "name_ru": p.get("name", "").strip(),
            "image": f"{slug}.jpg",
            "vendor": VENDOR_NAME,
            "source": SOURCE_HOST,
            "source_url": p.get("permalink"),
        }
        if price is not None:
            item["price"] = price
            item["currency"] = currency
        for key in ("style", "fabric", "sleeves", "details"):
            if key in attrs:
                item[key] = attrs[key]
        # Description: prefer attributes summary so the dress modal has
        # readable copy (the WooCommerce description is empty for most items).
        attr_labels_ru = {
            "style": "Силуэт",
            "fabric": "Ткань",
            "sleeves": "Рукава",
            "details": "Детали",
        }
        desc_parts = [item["name"]]
        if attrs:
            attr_pretty = " · ".join(
                f"{attr_labels_ru[k]}: {v}" for k, v in attrs.items() if k in attr_labels_ru
            )
            if attr_pretty:
                desc_parts.append(attr_pretty)
        item["description"] = " — ".join(desc_parts)
        catalog.append(item)

    print(f"→ Built {len(catalog)} catalog items ({len(skipped)} skipped)")
    if skipped:
        print("  Skipped:", *skipped[:10], sep="\n    ")

    # Write source catalog
    (CATALOG_DIR / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    # Write static API copy with derived image_url
    api_items = [
        {**item, "image_url": f"/catalog-images/{item['image']}"} for item in catalog
    ]
    FRONTEND_API_JSON.write_text(
        json.dumps(api_items, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"✓ Wrote {CATALOG_DIR/'catalog.json'} and {FRONTEND_API_JSON}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
