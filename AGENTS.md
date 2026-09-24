# AGENTS.md

Personal website — Eleventy 3 (11ty) static site deployed to GitHub Pages via push to `main`.

## Commands

```bash
npm install          # first-time setup
npm run serve        # build + watch + live-reload at http://localhost:8080
npm run build        # production build → _site/
```

No lint, typecheck, or test scripts. Verification = `npm run build` exits 0.

## Architecture

```
src/              → Eleventy input root
  index.html      → single-scroll profile page (Nunjucks-processed, NOT passthrough)
  404.html        → passthrough-copied as-is
  assets/img/     → passthrough-copied (images)
  _includes/
    post.njk      → sole blog post layout
  blog/
    blog.json     → shared front matter for all posts (layout, tags, series, totalParts)
    index.njk     → blog listing page
    part-*.md     → series posts (14 parts, "From dotfiles to declarative desktops")
    *.md          → standalone posts (no part number)
_site/            → build output (gitignored, deployed by CI)
.eleventy.js      → Eleventy config (filters, plugins, passthrough rules)
```

## Eleventy quirks to know

- **`index.html` is a Nunjucks template**, not a passthrough copy — it can use `{{ collections.post }}` and custom filters.
- **`htmlTemplateEngine: "njk"`** — `.html` files in `src/` are processed through Nunjucks.
- **`markdownTemplateEngine: "njk"`** — Markdown posts support Nunjucks shortcodes inline.
- **js-yaml override** — `package.json` overrides `js-yaml` to `^4.2.0` to fix a DoS CVE (GHSA-h67p-54hq-rp68). The `setFrontMatterParsingOptions` in `.eleventy.js` re-wires gray-matter to the new API (`yaml.load` / `yaml.dump`, not the removed `safeLoad`/`safeDump`). Do not remove either the override or the config block.
- **Custom Nunjucks filters** defined in `.eleventy.js`: `readableDate`, `htmlDateString`, `hasPart`, `noPart`, `zeroPad`.

## Blog post front matter

**Series post** (inherits layout, tags, series from `blog.json`):
```yaml
---
title: "The declarative NixOS stack"
date: 2026-01-15
description: "..."
part: 1
permalink: /blog/part-1-declarative-nixos-stack/
---
```

**Standalone post** (override `series: false` to opt out of the series grouping):
```yaml
---
title: "..."
date: 2026-06-27
description: "..."
series: false
permalink: /blog/my-post-slug/
---
```

- `blog.json` sets `"totalParts": 14` — update this when adding series parts.
- Posts without a `part` field are treated as standalone by the `noPart` filter.
- All posts in `src/blog/` automatically get `tags: "post"` via `blog.json`.

## Deploy

Push to `main` → GitHub Actions (`static.yml`) runs `npm ci && npm run build`, uploads `_site/`, deploys to GitHub Pages. No manual deploy step. Node 24 in CI — match locally to avoid surprises.

## UI conventions

- **Dark mode default** — toggled via `data-theme` on `<html>`, persisted in `localStorage`, with a no-FOUC inline script.
- **JSON-LD structured data** present on all pages (`WebSite`, `Person`, `ProfilePage`, `Blog`, `BlogPosting`, `BreadcrumbList`).
- WCAG AA contrast maintained — verify any color changes (≥ 4.5:1 body text, ≥ 3:1 UI).
- Code blocks use a warm dark token theme matching the site palette (via `eleventy-plugin-syntaxhighlight`).
