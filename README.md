# Seorius – On-Page SEO Inspector

Open-source Chrome extension that inspects the SEO of the page you are on — locally, in your browser.

> Status: in development. Not yet on the Chrome Web Store.

## Principles

- **Local only.** The page is analysed inside your browser. No page data, URL or browsing history is sent anywhere.
- **Minimal permissions.** `activeTab` + `scripting` — it runs only when you click the icon, only on that tab.
- **Open source.** MIT licensed.

## Planned checks

Title and meta description, meta robots and X-Robots-Tag, canonical, noindex/canonical consistency,
lang, viewport, charset, hreflang, H1–H6 outline, images (alt, size), links (rel, empty anchors),
Open Graph, Twitter Card, structured data (JSON-LD / microdata), tracking tags, text/HTML ratio,
keyword density, mixed content, HSTS.

## License

[MIT](./LICENSE) © 2026 Blakfy Studio
