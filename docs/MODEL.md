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
| SERP overlay | `serp.js` + `serp.css` (content script) | automatically on Google web search result pages (43 Google country hosts, `/search` only) | SEOquake SERP module (behaviour only) |

Not built: an always-on bar on every page. It needs `<all_urls>` content scripts, and SEOquake's
version sends every URL to Semrush by default. The SERP overlay is limited to Google's `/search`
paths and makes no network request. The full report can ask, on a click, for one optional
permission set (§4) to show the redirect chain and to check other sites without CORS; it is never
requested at install.

## 2. Information architecture

### Popup (summary, 600 px wide)

1. **Header**: URL, HTTP status, an error / warning / notice count, and a button to open the full report.
2. Tabs (TR / EN: Özet / Summary, Başlıklar / Headers, Görseller / Images, Bağlantılar / Links,
   Sosyal / Social, Araçlar / Tools). Each tab ends with a "Details in report" link that opens the
   report at the matching section (`src/lib/tools.mjs` POPUP_TABS).
   - **Summary**: title, description (length plus status), canonical, robots, lang, H1; detected
     schema types (JSON-LD / microdata / RDFa, parse errors); the top 5 failing or warning findings.
   - **Headers**: H1–H6 counts and the outline.
   - **Images**: total, missing alt, missing dimensions.
   - **Links**: internal / external, follow / nofollow / sponsored / ugc.
   - **Social**: OG and Twitter values, plus a share preview card.
   - **Tools**: the same outbound tool links as the report Tools section (opened only on click),
     plus "Open full report".

### Full report (one tab, side navigation)

| Section | Content | Origin |
|---|---|---|
| Audit | every check grouped Technical / Content / Mobile / Social, each with an error, warning, notice or pass status; every finding and fix hint in the UI language (TR / EN), engine findings included | SEOquake "On-Page SEO Audit" |
| Page info | title, description, keywords, robots, X-Robots-Tag, canonical, lang, charset, doctype, viewport, author / publisher, XFN rel, meta language tags (content-language, name=language), favicon + touch icons, URL quality (length, query params, escapes, depth) | 1 CLICK "Basic" + SEOquake "Page Info" |
| Head dump | every `<head>` element listed raw, to find unknown or duplicated tags | 1 CLICK |
| Headings | full H1–H6 tree with text | 1 CLICK "Headers" + SEOquake "Heading Structure" |
| Images | table of src, alt, title, dimensions, byte size, format distribution, rendered vs natural size, filters (missing alt, oversized) | both + rendered-vs-natural new |
| Links | table grouped by URL (occurrence count, anchor variants, anchor type: text / image / empty), rel, type, filters internal / external / nofollow / empty anchor, internal-link health bands, redirected targets; broken-link check on demand (safety policy in §3; links to other sites are checked from the extension once the optional cross-site access in §4 is granted) | 1 CLICK "Links" + SEOquake "Links Report" |
| Keywords | keyword density (1 / 2 / 3 / 4-word), prominence column, word count, keyword cloud, TR + EN stop words with a user whitelist, Turkish-correct casing | SEOquake "Keyword Density" (it is English-only; Turkish handling is new) |
| Social | OG and Twitter tables plus share previews | 1 CLICK "Social" + SEOquake |
| Schema | JSON-LD / microdata / RDFa types, raw view, parse errors | both (RDFa: SEOquake) |
| Technical | HTTP status, redirected yes / no + final URL, redirect chain hop by hop (each URL + status code; on a button, needs the optional permission in §4; at most 10 hops, loops flagged; refused = "not run" note), response header names and selected values, HSTS, mixed content, HTML size (compressed and decoded, surface stated), text/HTML ratio, media-query count, robots.txt verdict per agent, sitemap parse (type, URL count, is this page listed); sitemaps declared on another host are read on a button (optional permission, at most 3) | SEOquake "Technical", extended |
| Raw vs rendered | head fields compared between the raw HTML response and the live DOM | **new (Seorius)** |
| Frames | iframes listed as "not inspected" findings | new (neither tool reports them) |
| Tracking | GA4 / gtag / GTM / Meta pixel / Yandex / Clarity detected by script src AND inline signature | 1 CLICK (GA / DoubleClick, inline only), extended |
| Compare | 2–5 URLs side by side on on-page fields, CSV export | new (SEOquake's compare covers Semrush metrics only) |
| Tools | outbound links (Rich Results Test, PageSpeed, W3C, etc.), opened only on click | 1 CLICK "Tools" |
| Help | per-directive explanation for robots values and every audit check | 1 CLICK help pages, extended |
| Export | PDF / JSON / CSV of the report | SEOquake "exportAuditPdf" |

### SERP overlay (Google web search results)

Runs on Google web search result pages only (`https://www.google.<cc>/search*`, list in
`src/lib/serp.mjs` SERP_HOSTS). Vertical tabs are skipped (any `tbm=`, any `udm=` except 14 = Web).

- **Organic numbering**: a position badge before each organic title; `start=` offset (page 2 starts
  at 11); deduped by final URL; Google `/url?q=` links unwrapped locally (other redirect links are
  left as shown, never resolved over the network).
- **Ads**: sponsored blocks (links to Google's ad-click path or ad-services domain, text-ad markers,
  the visible sponsored label) get an amber tint, border and an "Ad #n · top/bottom" badge. Own
  counter; never part of organic numbering.
- **Feature chips**: Featured snippet, People also ask, Local pack (map), Video carousel, Image pack,
  Top stories, Sitelinks, AI Overview. Blocks inside these features are not numbered (the featured
  snippet's source result is numbered, as it is an organic result).
- **Floating panel** (bottom-right, collapsible, Seorius palette, text size setting, light / dark from
  the page background): organic / ad counts, features list, toggles (numbers, ad highlight, feature
  chips), CSV export (`type, position, title, url, domain, displayed_url, features`; UTF-8 BOM;
  formula-injection guard; file "<query> - seorius-serp.csv"), AI Overview sources list + CSV, and a
  country (`gl`) / language (`hl`) switcher that reloads the search.
- **My domain** (Settings): matching results get an extra outline and a "My domain" tag.
- Re-runs on SPA navigation and Google DOM changes (debounced); classification is structural (a
  heading inside a link, `<cite>` displayed URL, ad-click links, expandable question rows, Google's
  own custom elements), heading words are only a supporting signal. Any error leaves the page as
  Google rendered it.

### Settings

Language (TR / EN), Google search results overlay (on / off, numbers, ads, feature chips, my domain), overlay colours, keyword stop-word list and whitelist, which audit groups to
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
- Raw HTML comes from a re-fetch of the current URL inside the extension. During the scan, network
  calls go only to the site being inspected (that re-fetch, `/robots.txt`, same-origin sitemaps).
  Response headers come from the same re-fetch. Everything else (link check, image sizes, redirect
  chain, sitemaps on other hosts) runs only when the user starts it.
- Findings are translated. The vendored engine carries one local patch: every finding has a message
  code (`msgKey` = `e_<code>`, `params`, `fixKey`) next to its English `message` / `fix_hint`, which
  stay as the fallback and in the JSON export. Texts live in `src/_locales/{en,tr}/messages.json`;
  `test/engine-i18n.test.mjs` fails when the engine emits a code without both texts.
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
  - limits concurrency (SEOquake uses 6) and never sends credentials;
  - path: same-origin URLs are probed from the page. URLs on other sites are probed from the report
    page when the optional cross-site access is granted (readable without the target's CORS
    headers); otherwise from the page in CORS mode, where an unreadable answer is "not checked".
    Both paths run the same code (`src/lib/probe.mjs`).

Full code-level comparison of both tools: [FEATURE-DIFF.md](./FEATURE-DIFF.md).

## 4. Permissions and privacy

| Permission | Why |
|---|---|
| `activeTab` | read the current tab only after the user clicks |
| `scripting` | inject the inspector into that tab |
| `storage` | settings only |
| `content_scripts` on `https://www.google.<cc>/search*` (43 hosts) | the SERP overlay; no other site, no `host_permissions` |
| optional: `webRequest` + `http://*/*`, `https://*/*` (`optional_permissions`, `optional_host_permissions`) | NOT granted at install. Requested once, on a click in the report ("Show redirect chain", "Allow access to other sites" or "Check sitemaps on other hosts"; one prompt covers all three). Used to watch the hops of the report's own re-fetch of the inspected URL, and to read link / image / sitemap answers from other sites without relying on their CORS headers. Revocable in `chrome://extensions`; refused = the earlier behaviour plus a "not run" note. |

- Install-time: no `<all_urls>`, `tabs`, `webRequest` or `identity` permission and no
  `host_permissions`. The optional set above is the only cross-site access, and only after the user
  grants it.
- The `webRequest` listener exists only during one re-fetch, keeps only requests started by the
  extension itself (initiator = the extension's origin), and is removed afterwards. It does not
  see or record the user's browsing.
- No remote code, no analytics, no telemetry.
- No data leaves the browser. The only requests go to the inspected site and, when the user starts
  a check, to that page's linked / embedded URLs and declared sitemaps (no cookies), plus any
  outbound tool link the user clicks. The SERP script makes no request at all (`npm run check` fails if its bundle
  contains fetch / XMLHttpRequest / sendBeacon / WebSocket / EventSource).
- Install prompt: Chrome shows that Seorius can read and change data on the Google search hosts,
  because of the content script.

## 5. Explicitly excluded

| Feature | Why |
|---|---|
| Semrush rank / traffic / backlinks | third-party paid API; sends URLs to Semrush |
| Pinterest pin count, Whois | third-party calls |
| Always-on bar on every page | needs `<all_urls>` |
| Favicons loaded from google.com/s2 | leaks the domains you visit to Google; icons are bundled locally instead |
| Upsell / login screens | not applicable |

## 6. Later (not in v1)

GSC / GA4 per-page data through our own backend, with no third party.

## 7. Owner decisions (2026-10-28)

| Topic | Decision |
|---|---|
| UI language | Turkish and English, switchable in Settings |
| Privacy policy | hosted on blakfy.com, next to the existing legal texts |
| Chrome Web Store account | info@blakfy.com |
| Logo | option C: "S" + four-point Sirius star on a navy disc (`src/icons/logo.svg`) |
| Palette | from the logo: navy `#10243a` + mint `#7fd8c8`, WCAG AA in light and dark (`src/ui/style.css`) |
| UI design | approved; Figma file "Seorius – UI v1" (Blakfy Studio team), 25 screens |
