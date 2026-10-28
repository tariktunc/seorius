// Shared HTML fixtures for node --test (written for Seorius).
export const PAGE = `<!doctype html>
<html lang="tr"><head>
<meta charset="utf-8">
<title>İstanbul Çiçek Teslimatı | Örnek</title>
<meta name="description" content="Kısa açıklama">
<meta name="description" content="İkinci açıklama">
<meta name="keywords" content="çiçek, teslimat">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://www.example.com/cicek">
<link rel="icon" href="/favicon.png" sizes="32x32">
<meta property="og:title" content="Çiçek">
<meta property="og:image" content="/og.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},{"@type":"WebPage","name":"Y"}]}</script>
<script type="application/ld+json">{broken</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9"></script>
</head><body>
<h1>İstanbul çiçek</h1><h3>Atlanan seviye</h3><h2></h2>
<p>İstanbul çiçek teslimatı İstanbul çiçek teslimatı ve ISPARTA için hızlı çiçek.</p>
<a href="/a">İç bağlantı</a><a href="https://example.com/b" rel="nofollow">Apex</a>
<a href="https://blog.example.com/x">Alt alan</a><a href="https://other.org/?ref=example.com">Dış</a>
<a href="https://other.org/?ref=example.com"><img src="/i.png" alt="logo"></a>
<a href="#top"></a><a href="mailto:a@b.c">mail</a>
<img src="/no-alt.jpg"><img src="/empty.jpg" alt="" width="10" height="10">
<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Gül</span><div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="10"></div></div>
<div vocab="https://schema.org/" typeof="Person"><span property="name">Ali</span></div>
<iframe src="https://www.youtube.com/embed/x" title="video"></iframe>
</body></html>`;
