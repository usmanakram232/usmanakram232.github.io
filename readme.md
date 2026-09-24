# usmanakram232.github.io

Personal site for [M. Usman Akram](https://usmanakram232.github.io) — profile page and technical blog.

## Stack

- **[Eleventy 3](https://www.11ty.dev/)** — static site generator
- **Nunjucks** — templates
- **Prism.js** — syntax highlighting (via `@11ty/eleventy-plugin-syntaxhighlight`)
- **JetBrains Mono** — code font with programming ligatures
- **GitHub Pages** — hosting, deployed via GitHub Actions

## Structure

```
src/
├── index.html              — single-scroll profile page (passthrough)
├── 404.html                — minimal 404 (passthrough)
├── assets/img/             — three photos used in the layout
├── _includes/
│   └── post.njk            — blog post layout
└── blog/
    ├── blog.json           — shared front matter (layout, tags, series)
    ├── index.njk           — blog listing page
    └── part-*.md           — five blog posts (markdown)

.eleventy.js                — Eleventy config
.github/workflows/static.yml — build and deploy workflow
```

## Blog

Five-part series: *From dotfiles to declarative desktops*

| Part | Title |
|------|-------|
| 1 | The declarative NixOS stack |
| 2 | The agentic development stack |
| 3 | Security posture: defence-in-depth on a declarative desktop |
| 4 | Agent security: running untrusted code safely |
| 5 | Future roadmap: what's next |

## Features

- **Dark mode by default** — toggle in nav/header, persisted to `localStorage`, no flash on load
- **WCAG AA contrast** — all text pairs verified (≥ 4.5:1 body, ≥ 3:1 UI components)
- **JSON-LD structured data** — `WebSite`, `Person`, `ProfilePage`, `Blog`, `BlogPosting`, `BreadcrumbList`
- **Syntax highlighting** — warm dark token theme matching the site palette
- **Ligatures** — `font-feature-settings: "liga" 1, "calt" 1` on all code blocks

## Local development

```bash
npm install
npm run serve    # builds and watches at http://localhost:8080
```

## Deploy

Push to `main` — GitHub Actions builds with Node 24, runs Eleventy, deploys `_site/` to GitHub Pages.
