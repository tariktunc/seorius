# Seorius – Sayfa İçi SEO Analizi

Açık sekmedeki sayfanın sayfa içi SEO'sunu tarayıcınızın içinde inceleyen, açık kaynaklı Chrome eklentisi (Manifest V3).

> Durum: geliştirme aşamasında. Henüz Chrome Web Mağazası'nda yok.

## İlkeler

- **Yalnızca yerel.** Sayfa tarayıcınızda analiz edilir. Hiçbir sayfa verisi, URL veya geçmiş Blakfy sunucularına ya da üçüncü taraflara gönderilmez.
- **En az izin.** Kurulumda yalnızca `activeTab`, `scripting`, `storage`. Sayfa analizi yalnızca simgeye tıkladığınızda, yalnızca o sekmede çalışır. `host_permissions` ve `<all_urls>` yoktur. Tek içerik betiği (`content_scripts`) Google web arama sonuç sayfalarında (`https://www.google.<ülke>/search*`, 43 Google alan adı) çalışan SERP katmanıdır; başka hiçbir sitede çalışmaz.
- **Google SERP katmanı hiçbir ağ isteği yapmaz.** Yalnızca açık olan sonuç sayfasını okur. Semrush, Whois veya başka bir üçüncü taraf verisi kullanılmaz.
- **İsteğe bağlı izin (kurulumda istenmez):** tam raporda "Yönlendirme zincirini göster", "Diğer sitelere erişime izin ver" veya "Başka sunuculardaki site haritalarını kontrol et" düğmesine bastığınızda Chrome bir kez `webRequest` ve `http://*/*`, `https://*/*` erişimi ister. Tek izin üçünü de kapsar. Bu izinle rapor, sayfanın yönlendirme zincirini adım adım (her URL ve durum kodu) gösterir ve başka sitelerdeki bağlantıları, görselleri ve site haritalarını o sitelerin CORS başlıklarına bağlı kalmadan kontrol eder. `webRequest` dinleyicisi yalnızca eklentinin kendi isteği sürerken açıktır, gezinmenizi görmez ve kaydetmez. İzni vermezseniz eski davranış sürer ve ilgili satırda "çalışmadı" notu görünür. İzni `chrome://extensions` sayfasından geri alabilirsiniz.
- **Ağ istekleri:** tarama sırasında yalnızca incelenen siteye gider (sayfanın kendisi: ham HTML + yanıt başlıkları, `robots.txt`, aynı sitedeki site haritası). Bağlantı kontrolü, görsel boyutu ölçümü, yönlendirme zinciri ve başka sunuculardaki site haritaları yalnızca siz başlatınca çalışır; bunlar sayfadaki bağlantıların, görsellerin ve bildirilen site haritalarının adreslerine (başka siteler dahil) HEAD/GET isteği atar. Tüm istekler çerezsiz gönderilir; Blakfy'ye veya üçüncü taraflara hiçbir şey gönderilmez.
- **Açık kaynak.** MIT lisansı.

## Ne yapar

- **Pencere (popup):** URL, HTTP durumu, hata / uyarı / not sayıları ve altı sekme: Özet (temel alanlar, schema türleri, dikkat gereken ilk 5 bulgu), Başlıklar, Görseller, Bağlantılar, Sosyal, Araçlar (dış araç bağlantıları + tam rapor). Her sekmenin sonunda raporun ilgili bölümünü açan "Rapordaki ayrıntılar" bağlantısı vardır.
- **Google arama sonuçları (SERP) katmanı:** organik sonuçlara sıra numarası (2. sayfa 11'den başlar, aynı adres bir kez sayılır), reklamlara ayrı renk, çerçeve ve "Reklam #n · üst/alt" etiketi (organik sıraya karışmaz), SERP özellik etiketleri (öne çıkan snippet, diğer kullanıcılar şunu sordu, yerel paket, video karuseli, görsel paketi, öne çıkan haberler, site bağlantıları, AI Overview). Sağ altta açılıp kapanan panel: organik / reklam sayıları, açma-kapama düğmeleri, CSV indirme, AI Overview kaynak listesi + CSV, ülke / dil ile yeniden arama. Ayarlardan kendi alan adınızı girerseniz o sonuçlar ayrıca çerçevelenir.
- **Tam rapor (ayrı sekme):** Denetim (Teknik / İçerik / Mobil / Sosyal), sayfa bilgisi, head öğeleri, başlık ağacı, görsel tablosu, bağlantı tablosu ve bağlantı kontrolü, anahtar kelime yoğunluğu (1-4 kelime, Türkçe büyük/küçük harf), Open Graph / Twitter ve paylaşım kartı, JSON-LD / microdata / RDFa, teknik bilgiler (durum, adım adım yönlendirme zinciri, başlıklar, HSTS, karışık içerik, HTML boyutu, robots.txt kararı, site haritası), ham ve işlenmiş karşılaştırması, çerçeveler, izleme etiketleri, 2-5 URL karşılaştırma, dış araç bağlantıları, yardım, dışa aktarma (JSON / CSV / yazdır-PDF).
- **Sayfada işaretleme:** başlıklar, bağlantılar (nofollow, boş metin), alt'ı olmayan görseller. İstek üzerine eklenir, kapatınca kaldırılır.
- **Ayarlar:** dil (Türkçe / İngilizce), Google SERP katmanı (aç / kapat, numaralar, reklam işaretleme, özellik etiketleri, alan adım), işaretleme renkleri, ek etkisiz kelimeler ve beyaz liste, gösterilen denetim grupları, tablo sütunları, ayarları içe / dışa aktarma.

Tüm bulgular ve düzeltme önerileri, analiz motorundan gelenler dahil, seçtiğiniz dilde (Türkçe / İngilizce) gösterilir.

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
- `npm run test:e2e` — gerçek Chromium'da uçtan uca test (önce `npm run build`): yönlendirme zinciri, döngü, CORS başlığı olmayan sitede bağlantı / görsel / site haritası kontrolü. İsteğe bağlı izinler test kopyasında baştan verilir; izin penceresinin kendisi otomatik tıklanamaz.
- `npm run check` — `dist/manifest.json` kurulum izinlerini, isteğe bağlı izinlerin tam listesini ve tek içerik betiğinin yalnızca Google arama yollarında olduğunu doğrular, SERP betiğinde ağ isteği API'si olmadığını denetler ve derlenmiş dosyalardaki tüm URL'leri listeler.

Analiz motoru WebForge `site-builder/seo-uzman/health/page-inspect-core.mjs` dosyasından `src/engine/` içine kopyalanmıştır (kaynak yolu dosya başlığında yazar). Kopyada tek bir yerel değişiklik vardır: her bulgu, İngilizce metninin yanında bir mesaj kodu ve parametreler taşır (arayüz çevirisi için). Motor yeniden kopyalanırsa bu değişiklik yeniden uygulanmalıdır; `test/engine-i18n.test.mjs` metni eksik bir kod olursa başarısız olur.

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
