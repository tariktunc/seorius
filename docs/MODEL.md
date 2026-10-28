# Seorius — unified product model

Seorius combines what two existing extensions do into one local-only inspector:

- **SEO META in 1 CLICK** v2.67 (`bjogjfinolnhfhkbipphpdlldadpnmhc`)
- **SEOquake** v4.3.0 (`akdgnmcogleenhbclghghlkkdndkjdjc`, Semrush)

Both were read statically on 2026-10-28 with REA `analyze-javascript-application` and by reading
their installed files.

**Clean-room rule.** Only the feature set and the screen structure are taken from these tools.
No code, text, icons or styles are copied. SEO META in 1 CLICK has no stated licence, and SEOquake
is proprietary. Every line in this repository is written from scratch.

---

## 1. Surfaces

Modelled on SEOquake's layout: one engine and several views.

| Surface | File | Opens when | Origin |
|---|---|---|---|
| Popup | `popup.html` | icon click | both |
| Full report | `report.html` (own tab) | "Open full report" in popup | SEOquake |
| Page overlay | injected on demand | toggle in popup (headings / links / images) | SEOquake bar, Sitechecker overlays |
| Settings | `options.html` | extension options | SEOquake |

Not built: an always-on bar on every page, and a Google SERP overlay. Both need
`<all_urls>` content scripts, and SEOquake's versions send every URL to Semrush by default.

## 2. Information architecture

### Popup (summary, about 400 px wide)

1. **Header**: URL, HTTP status, an error / warning / notice count, and a button to open the full report.
2. **Needs attention**: the top 5 failing or warning findings.
3. Tabs:
   - **Overview**: title, description (length plus status), canonical, robots, lang, H1.
   - **Headings**: H1–H6 counts and the outline.
   - **Images**: total, missing alt, missing dimensions.
   - **Links**: internal / external, follow / nofollow / sponsored / ugc.
   - **Social**: OG and Twitter values, plus a share preview card.
   - **Schema**: detected types and parse errors.

### Full report (one tab, side navigation)

| Section | Content | Origin |
|---|---|---|
| Audit | every check grouped Technical / Content / Mobile / Social, each with an error, warning, notice or pass status | SEOquake "On-Page SEO Audit" |
| Page info | title, description, keywords, robots, X-Robots-Tag, canonical, lang, charset, doctype, viewport, author / publisher, XFN rel, meta language tags (content-language, name=language), favicon + touch icons, URL quality (length, query params, escapes, depth) | 1 CLICK "Basic" + SEOquake "Page Info" |
| Head dump | every `<head>` element listed raw, to find unknown or duplicated tags | 1 CLICK |
| Headings | full H1–H6 tree with text | 1 CLICK "Headers" + SEOquake "Heading Structure" |
| Images | table of src, alt, title, dimensions, byte size, format distribution, rendered vs natural size, filters (missing alt, oversized) | both + rendered-vs-natural new |
| Links | table grouped by URL (occurrence count, anchor variants, anchor type: text / image / empty), rel, type, filters internal / external / nofollow / empty anchor, internal-link health bands, redirected targets; broken-link check on demand (safety policy in §3) | 1 CLICK "Links" + SEOquake "Links Report" |
| Keywords | keyword density (1 / 2 / 3 / 4-word), prominence column, word count, keyword cloud, TR + EN stop words with a user whitelist, Turkish-correct casing | SEOquake "Keyword Density" (it is English-only; Turkish handling is new) |
| Social | OG and Twitter tables plus share previews | 1 CLICK "Social" + SEOquake |
| Schema | JSON-LD / microdata / RDFa types, raw view, parse errors | both (RDFa: SEOquake) |
| Technical | HTTP status, redirect chain + final URL, response header names and selected values, HSTS, mixed content, HTML size (compressed and decoded, surface stated), text/HTML ratio, media-query count, robots.txt verdict per agent, sitemap parse (type, URL count, is this page listed) | SEOquake "Technical", extended |
| Raw vs rendered | head fields compared between the raw HTML response and the live DOM | **new (Seorius)** |
| Frames | iframes listed as "not inspected" findings | new (neither tool reports them) |
| Tracking | GA4 / gtag / GTM / Meta pixel / Yandex / Clarity detected by script src AND inline signature | 1 CLICK (GA / DoubleClick, inline only), extended |
| Compare | 2–5 URLs side by side on on-page fields, CSV export | new (SEOquake's compare covers Semrush metrics only) |
| Tools | outbound links (Rich Results Test, PageSpeed, W3C, etc.), opened only on click | 1 CLICK "Tools" |
| Help | per-directive explanation for robots values and every audit check | 1 CLICK help pages, extended |
| Export | PDF / JSON / CSV of the report | SEOquake "exportAuditPdf" |

### Settings

Language (TR / EN), overlay colours, keyword stop-word list and whitelist, which audit groups to
show, per-table column visibility, and import / export of settings.

### Behaviour

- **Rescan**: a button, plus an automatic re-run when the tab URL changes (SPA navigation).
- **Top frame only**: iframes are listed as not inspected, never silently merged (1 CLICK merges
  whichever frame answers first).

## 3. Engine

- Analysis runs on `page-inspect-core.mjs`, the engine already built in WebForge seo-uzman. It is
  environment-agnostic and takes a `document`. Here it runs on the real page `document`.
- Thresholds come from `on-page-rules.json`. Each one carries an evidence class. Length bands are
  advisory only (warn / notice), never an error.
- Raw HTML comes from a re-fetch of the current URL inside the extension. That re-fetch is the only
  network call, and it goes only to the site being inspected. Response headers come from the same
  re-fetch.
- Severity model: **error / warning / notice / pass / not-run**. "Not-run" is never shown as a pass.
- Internal vs external is decided by comparing origins, with www and apex treated as one site.
  1 CLICK matches the host as a substring; SEOquake treats www vs apex as external.
- **Broken-link check safety policy**, adopted from SEOquake's approach:
  - runs only when the user starts it;
  - skips action-looking URLs (logout, delete, add-to-cart), private IP addresses and
    non-http(s) schemes;
  - does not follow redirects that go to a login page;
  - reports 401 / 403 / 429 and bot challenges as "could not check", never as broken;
  - uses HEAD first, then GET if HEAD is refused (our own choice; SEOquake's fallback was not
    determined);
  - limits concurrency (SEOquake uses 6) and never sends credentials.

Full code-level comparison of both tools: [FEATURE-DIFF.md](./FEATURE-DIFF.md).

## 4. Permissions and privacy

| Permission | Why |
|---|---|
| `activeTab` | read the current tab only after the user clicks |
| `scripting` | inject the inspector into that tab |
| `storage` | settings only |

- No `<all_urls>`, `tabs`, `webRequest` or `identity` permission.
- No remote code, no analytics, no telemetry.
- No data leaves the browser, except the re-fetch of the inspected page and any outbound tool link
  the user clicks.

## 5. Explicitly excluded

| Feature | Why |
|---|---|
| Semrush rank / traffic / backlinks | third-party paid API; sends URLs to Semrush |
| Pinterest pin count, Whois | third-party calls |
| Always-on bar on every page | needs `<all_urls>` |
| Google SERP overlay | needs content scripts on Google |
| Favicons loaded from google.com/s2 | leaks the domains you visit to Google; icons are bundled locally instead |
| Upsell / login screens | not applicable |

## 6. Later (not in v1)

GSC / GA4 per-page data through our own backend, with no third party.
