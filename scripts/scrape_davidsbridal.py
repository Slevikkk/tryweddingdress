"""Scrape wedding dresses from davidsbridal.com category pages."""
import re
import json
import time
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

CATEGORY_URLS = [
    ("A-Line", "https://www.davidsbridal.com/brides/wedding-dresses/a-line"),
    ("Mermaid", "https://www.davidsbridal.com/brides/wedding-dresses/mermaid-trumpet"),
    ("Ball Gown", "https://www.davidsbridal.com/brides/wedding-dresses/ball-gown"),
    ("Sheath", "https://www.davidsbridal.com/brides/wedding-dresses/sheath"),
]

OUT_DIR = Path(__file__).resolve().parent.parent / "catalog_v2"
OUT_DIR.mkdir(exist_ok=True)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "ignore")


def extract_products(html: str) -> list[dict]:
    products = []
    for m in re.finditer(r'\{"id":"gid://shopify/Product/\d+"', html):
        start = m.start()
        depth = 0
        for j in range(start, len(html)):
            c = html[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    end = j + 1
                    break
        try:
            obj = json.loads(html[start:end])
        except Exception:
            continue
        products.append(obj)
    return products


def is_dress(p: dict) -> bool:
    title = (p.get("title") or "").lower()
    handle = (p.get("handle") or "").lower()
    bad = [
        "pants", "jumpsuit", "separate", "skirt-only", "top-only",
        "veil", "shoes", "earring", "necklace", "bracelet", "robe",
        "garter", "sash", "belt", "kid", "flower-girl",
    ]
    if any(b in title for b in bad) or any(b in handle for b in bad):
        return False
    if "dress" in title or "gown" in title:
        return True
    return False


def normalize_color(raw: str) -> str:
    raw_l = raw.lower()
    if "ivory" in raw_l and "champagne" in raw_l:
        return "Ivory"
    if "ivory" in raw_l:
        return "Ivory"
    if "white" in raw_l:
        return "White"
    if "champagne" in raw_l:
        return "Champagne"
    if "blush" in raw_l or "pink" in raw_l or "rose" in raw_l:
        return "Blush"
    if "navy" in raw_l or "blue" in raw_l:
        return "Navy Blue"
    if "black" in raw_l:
        return "Black"
    if "coral" in raw_l or "peach" in raw_l:
        return "Coral"
    if "red" in raw_l or "burgundy" in raw_l:
        return "Red"
    if "gold" in raw_l:
        return "Gold"
    return raw.split("/")[0].strip().title()


def to_catalog(p: dict, style: str) -> dict | None:
    title = p.get("title") or ""
    if not is_dress(p):
        return None
    imgs = (p.get("images") or {}).get("edges") or []
    if not imgs:
        return None
    image_url = imgs[0]["node"]["url"]
    variants = (p.get("variants") or {}).get("nodes") or []
    color_raw = "White"
    price = None
    sku = None
    if variants:
        v0 = variants[0]
        sku = v0.get("sku")
        price = v0.get("price", {}).get("amount")
        for opt in v0.get("selectedOptions", []):
            if opt["name"] == "Color":
                color_raw = opt["value"]
                break
    return {
        "id": f"db_{sku}" if sku else f"db_{p.get('handle')}",
        "name": title,
        "style": style,
        "color": normalize_color(color_raw),
        "color_raw": color_raw,
        "vendor": p.get("vendor"),
        "price": float(price) if price else None,
        "currency": "USD",
        "image_url": image_url,
        "handle": p.get("handle"),
        "source_url": f"https://www.davidsbridal.com/products/{p.get('handle')}",
        "source": "davidsbridal.com",
    }


def main():
    all_dresses: list[dict] = []
    for style, url in CATEGORY_URLS:
        print(f"\n=== {style}: {url}")
        try:
            html = fetch(url)
        except Exception as e:
            print(f"  fetch failed: {e}")
            continue
        products = extract_products(html)
        print(f"  raw products: {len(products)}")
        kept = 0
        for p in products:
            d = to_catalog(p, style)
            if d:
                all_dresses.append(d)
                kept += 1
        print(f"  dresses kept: {kept}")
        time.sleep(1.0)

    # dedupe by id
    seen, dedup = set(), []
    for d in all_dresses:
        if d["id"] in seen:
            continue
        seen.add(d["id"])
        dedup.append(d)

    print(f"\nTotal unique dresses: {len(dedup)}")

    # Save raw catalog
    out_json = OUT_DIR / "catalog_raw.json"
    with open(out_json, "w") as f:
        json.dump(dedup, f, indent=2, ensure_ascii=False)
    print(f"Saved: {out_json}")


if __name__ == "__main__":
    main()
