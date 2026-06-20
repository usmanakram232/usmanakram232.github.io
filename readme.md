# usmanakram232.github.io

Personal profile site for [M. Usman Akram](https://usmanakram232.github.io).

## Stack

Plain HTML/CSS/JS. No build step, no dependencies, no frameworks.  
Served via GitHub Pages with `.nojekyll` (bypasses Jekyll entirely).

## Structure

```
index.html        — single-scroll profile page
404.html          — minimal 404
assets/img/       — three photos used in the layout
.nojekyll         — tells GitHub Pages to skip Jekyll
```

## Sections

| Section | Image |
|---------|-------|
| Hero    | Cloudy Trento — Flickr CDN |
| Bio     | Market, Pakistan |
| Work    | Clock tower, Italy |
| Closing | Half moon |

## Local preview

```bash
python3 -m http.server 4000
# visit http://localhost:4000
```

## Deploy

Push to `main` — GitHub Pages publishes automatically within ~60 seconds.
