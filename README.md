# Seorius – Sayfa İçi SEO Analizi

Açık sekmedeki sayfanın sayfa içi SEO'sunu tarayıcınızın içinde inceleyen, açık kaynaklı Chrome eklentisi (Manifest V3).

> Durum: geliştirme aşamasında. Henüz Chrome Web Mağazası'nda yok.

## İlkeler

- **Yalnızca yerel.** Sayfa tarayıcınızda analiz edilir. Hiçbir sayfa verisi, URL veya geçmiş Blakfy sunucularına ya da üçüncü taraflara gönderilmez.
- **En az izin.** `activeTab`, `scripting`, `storage`. Sayfa analizi yalnızca simgeye tıkladığınızda, yalnızca o sekmede çalışır. `host_permissions` ve `<all_urls>` yoktur. Tek içerik betiği (`content_scripts`) Google web arama sonuç sayfalarında (`https://www.google.<ülke>/search*`, 43 Google alan adı) çalışan SERP katmanıdır; başka hiçbir sitede çalışmaz.
- **Google SERP katmanı hiçbir ağ isteği yapmaz.** Yalnızca açık olan sonuç sayfasını okur. Semrush, Whois veya başka bir üçüncü taraf verisi kullanılmaz.
- **Ağ istekleri:** tarama sırasında yalnızca incelenen siteye gider (sayfanın kendisi: ham HTML + yanıt başlıkları, `robots.txt`, aynı sitedeki site haritası). Bağlantı kontrolü ve görsel boyutu ölçümü yalnızca siz başlatınca çalışır; bunlar sayfadaki bağlantıların ve görsellerin adreslerine (başka siteler dahil) HEAD/GET isteği atar. Tüm istekler çerezsiz gönderilir.
- **Açık kaynak.** MIT lisansı.

## Ne yapar

- **Pencere (popup):** URL, HTTP durumu, hata / uyarı / not sayıları ve altı sekme: Özet (temel alanlar, schema türleri, dikkat gereken ilk 5 bulgu), Başlıklar, Görseller, Bağlantılar, Sosyal, Araçlar (dış araç bağlantıları + tam rapor). Her sekmenin sonunda raporun ilgili bölümünü açan "Rapordaki ayrıntılar" bağlantısı vardır.
- **Google arama sonuçları (SERP) katmanı:** organik sonuçlara sıra numarası (2. sayfa 11'den başlar, aynı adres bir kez sayılır), reklamlara ayrı renk, çerçeve ve "Reklam #n · üst/alt" etiketi (organik sıraya karışmaz), SERP özellik etiketleri (öne çıkan snippet, diğer kullanıcılar şunu sordu, yerel paket, video karuseli, görsel paketi, öne çıkan haberler, site bağlantıları, AI Overview). Sağ altta açılıp kapanan panel: organik / reklam sayıları, açma-kapama düğmeleri, CSV indirme, AI Overview kaynak listesi + CSV, ülke / dil ile yeniden arama. Ayarlardan kendi alan adınızı girerseniz o sonuçlar ayrıca çerçevelenir.
- **Tam rapor (ayrı sekme):** Denetim (Teknik / İçerik / Mobil / Sosyal), sayfa bilgisi, head öğeleri, başlık ağacı, görsel tablosu, bağlantı tablosu ve bağlantı kontrolü, anahtar kelime yoğunluğu (1-4 kelime, Türkçe büyük/küçük harf), Open Graph / Twitter ve paylaşım kartı, JSON-LD / microdata / RDFa, teknik bilgiler (durum, yönlendirme, başlıklar, HSTS, karışık içerik, HTML boyutu, robots.txt kararı, site haritası), ham ve işlenmiş karşılaştırması, çerçeveler, izleme etiketleri, 2-5 URL karşılaştırma, dış araç bağlantıları, yardım, dışa aktarma (JSON / CSV / yazdır-PDF).
- **Sayfada işaretleme:** başlıklar, bağlantılar (nofollow, boş metin), alt'ı olmayan görseller. İstek üzerine eklenir, kapatınca kaldırılır.
- **Ayarlar:** dil (Türkçe / İngilizce), Google SERP katmanı (aç / kapat, numaralar, reklam işaretleme, özellik etiketleri, alan adım), işaretleme renkleri, ek etkisiz kelimeler ve beyaz liste, gösterilen denetim grupları, tablo sütunları, ayarları içe / dışa aktarma.

Durum modeli: **hata / uyarı / not / geçti / çalışmadı**. "Çalışmadı" hiçbir zaman "geçti" sayılmaz. Uzunluk aralıkları öneridir, Google kuralı değildir.

## Kurulum (paketlenmemiş)

Gereken: Node.js 20 veya üstü (geliştirme Node 24 ile yapıldı).

1. Bağımlılıkları kurun: `npm install`
2. Derleyin: `npm run build`
3. Chrome'da `chrome://extensions` sayfasını açın.
4. Sağ üstten **Geliştirici modu**nu açın.
5. **Paketlenmemiş öğe yükle** düğmesine basın ve `dist/` klasörünü seçin.
6. Bir sayfa açın ve araç çubuğundaki Seorius simgesine tıklayın.

## Geliştirme

- `npm run build` — `dist/` klasörünü üretir (esbuild ile paketleme, simgeler derleme sırasında çizilir).
- `npm test` — birim testleri (`node --test`).
- `npm run check` — `dist/manifest.json` izinlerini ve tek içerik betiğinin yalnızca Google arama yollarında olduğunu doğrular, SERP betiğinde ağ isteği API'si olmadığını denetler ve derlenmiş dosyalardaki tüm URL'leri listeler.

Analiz motoru WebForge `site-builder/seo-uzman/health/page-inspect-core.mjs` dosyasından `src/engine/` içine kopyalanmıştır (kaynak yolu dosya başlığında yazar). Motor dosyası burada düzenlenmez; güncelleme için yeniden kopyalanır.

## Klasörler

```
src/engine/     analiz motoru (kopya) + eşik dosyaları
src/lib/        saf modüller: denetim, anahtar kelime, bağlantı, robots.txt, site haritası, schema
src/inspector/  sayfaya enjekte edilen betik ve işaretleme katmanı
src/serp/       Google arama sonuçları katmanı (içerik betiği + stil)
src/ui/         popup, rapor ve ayarlar sayfaları
src/_locales/   tr ve en metinleri
test/           birim testleri
```

## Gizlilik

Gizlilik politikası blakfy.com üzerinde yayımlanacak: https://blakfy.com/

<!-- TODO: gizlilik politikasının kesin adresi belli olunca bu bağlantıyı ve src/ui/options.html içindeki bağlantıyı güncelle. -->

## Lisans

[MIT](./LICENSE) © 2026 Blakfy Studio
