# Try Wedding Dress

AI-powered virtual try-on web app for wedding dresses.
Live demo: **https://tryweddingdress.com/**

A bride uploads one full-length photo and instantly sees herself wearing
real wedding dresses from the catalogs of leading bridal retailers.
Generation runs on the FASHN AI `tryon-max` diffusion model with our own
post-processing that preserves fabric texture, drape, and realistic
lighting — bridal-quality results rather than a generic "clothing-swap".

## Status

- **Public demo deployed** on Cloudflare Workers at
  [tryweddingdress.com](https://tryweddingdress.com/) with a
  static-only mode (no real generation, to protect FASHN credits).
- **Catalog**: 41 David's Bridal dresses (Oleg Cassini, Galina, Lara,
  DB Studio, Truly Zac Posen, Melissa Sweet) with full attribution and
  direct deep-links to product pages.
- **Partnership outreach** to David's Bridal sent — see
  [`docs/email_final_send.md`](docs/email_final_send.md).

## Repository layout

```
backend/        FastAPI server that proxies to FASHN /v1/run + /v1/status.
                Reads FASHN_API_KEY from environment.
frontend/       Plain HTML/CSS/JS single-page app.
                IS_STATIC_DEMO=true in app.js disables real generation
                in the public deployment and shows a partner-access modal.
catalog/        catalog.json (41 dresses) + product photos sourced
                from David's Bridal under attribution.
website_examples/   Two before/after pairs used by the public Examples page.
docs/           Partnership materials and bilingual outreach emails.
scripts/        scrape_davidsbridal.py (catalog builder),
                02_test_fashn_tryon.py (FASHN API smoke test).
pyproject.toml  Python dependencies for the backend.
```

## Local development

### Backend

```bash
# Set your FASHN API key
export FASHN_API_KEY=sk-...

# Install deps and run
uv sync           # or: pip install -e .
uv run uvicorn backend.main:app --reload --port 8000
# Open http://localhost:8000/  -> serves frontend/ + /api/* endpoints
```

### Frontend in static-demo mode (no backend)

```bash
cd frontend
python -m http.server 8000
# Open http://localhost:8000/
```

In static-demo mode the app loads `api/catalog.json` and
`api/examples.json` from disk and shows the "partner access required"
modal instead of calling FASHN.

## Deployment

The public site is a static bundle of `frontend/` + `catalog/`
(images) + `website_examples/`, served from a Cloudflare Worker bound
to `tryweddingdress.com`. SSL, CDN, DNS, and email routing
(`info@tryweddingdress.com` → Gmail) all run through the same
Cloudflare account.

## Attribution

Product photos and metadata in `catalog/` are courtesy of
[David's Bridal](https://checkout.davidsbridal.com/). Each dress card
in the UI links directly to the corresponding David's Bridal product
page and displays an explicit attribution line.

## License

Source code: proprietary, not for redistribution.
Catalog imagery: © David's Bridal — used with attribution pending
formal partnership agreement.
