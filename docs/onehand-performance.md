# Tek el sürümü — ölçüm ve sınırlar

23 Ekim 2026. Başlangıç: `b23ed9151355e43ad2cd57482999d1adc65db2b4`. [Ham sonuçlar](../benchmarks/results/onehand-2026-10-23/). Yerel Node/SwiftShader sonuçları Cloudflare bölgesinin gecikmesi veya fiziksel iPhone FPS ölçümü değildir.

## Yeniden üretilen akıcılık sorunu

Uzak karakterler snapshot'ın varış zamanıyla, oklar ise simülasyon zamanıyla çiziliyordu. 15 Hz yayın, 60 Hz görüntü, sabit 3 birim/sn hareket ve 65–120 ms değişken geliş gecikmesinde:

| Ölçüm | Önce | Sonra |
|---|---:|---:|
| 410 örnekte hareketsiz kare | 13 | 0 |
| Geriye adım | 0 | 0 |
| En büyük kare adımı | 0,1333 | 0,0500 birim |
| Görünen hızın standart sapması | 1,790 | <0,000001 birim/sn |

Yeni uzak karakter saati mevcut sekiz snapshot'ı ve gönderilen simülasyon zamanını kullanır; 125 ms tampon ve sınırlı saat düzeltmesi uygular. Önceki 90 ms varış zamanı tamponuna göre biraz daha fazla görüntü gecikmesi karşılığında dalgalı paketler düzenli çizilir. Yerel oyuncunun tahmini kontrolü beklemez. Uzak oyuncular bilinmeyen konumlara uzatılmaz. Ölüm, gizlenme, koruma, can, hedef üyeliği ve yeni tur bilgisi en güncel otoriteden gelir. Ok sunumu, isabetler ve fizik değiştirilmedi.

Tekrarlama: `node benchmarks/remote-presentation.js --root=BASELINE_ROOT` ve aynı komut güncel kökte. Ayrı regresyonlar ölüm/doğuş, koruma bitişi ve tur değişimini kapsar.

## Gerçek oda döngüsü

`ArenaRoom.step()`; snapshot oluşturma ve v2 kodlama dahil, beş ölçümün medyanı, her ölçümde 660 adım/22 saniye simülasyon. Ağ taşıması yerelde taklit edilir; bu bir internet RTT veya Cloudflare fatura testi değildir. Sekiz katılımcıya kadar boş yerleri mevcut botlar doldurur.

| İnsan + bot | Medyan adım önce → sonra | p95 adım önce → sonra | Toplam yayın önce → sonra |
|---|---:|---:|---:|
| 2 + 6 | 0,197 → 0,216 ms | 0,599 → 0,582 ms | 26,42 → 26,84 KB/sn |
| 8 + 0 | 0,587 → 0,682 ms | 1,566 → 1,877 ms | 142,60 → 144,36 KB/sn |
| 16 + 0 | 1,543 → 1,556 ms | 4,523 → 4,726 ms | 537,09 → 540,45 KB/sn |

İki oyuncuda 33,3 ms adım bütçesini aşan bir sunucu darboğazı yeniden üretilmedi. Bu sürümde sunucuda büyük bir hızlanma veya trafik tasarrufu iddiası yoktur. Buff konumları ve 5 saniyelik seçim süresi oyun izlerini değiştirdiğinden iş yükü/paket içeriği de az miktarda değişir. Mesaj sayısı değişmez: oyuncu başına 15 snapshot/sn; mevcut 30 Hz girdiler aynı ikili paketleme ile gönderilir. Kullanıldığında emoji ek bir küçük istek/olay üretir, en fazla dört saniyede birdir.

İki oyunculu odanın ölçülen tutulan heap farkı yaklaşık 165,5 → 168,0 KiB; 8/16 oyuncu sonuçları ham dosyalardadır. GC ve önceki örnekler bu küçük farkları etkiler, kapasite garantisi çıkarılmamalı. Boş oda döngüsü durmaya devam eder. Yeni kalıcı timer veya oda başına büyüyen emoji geçmişi yoktur.

Tekrarlama: `node --expose-gc benchmarks/arena-load.js --root=BASELINE_ROOT --repeats=5`; güncel kök için `--root` verilmez.

## Çizim ve grafikler

16 tam animasyonlu oyuncu, 120 ok, 140 kristal, beş nadir kristal, 16 alev/elektrik efekti, can etiketleri ve 32 gölge üreticisi korunur. Değişmeyen yerel avatar parçalarının matrisleri tekrar oluşturulmaz; kristal renk tamponu yalnızca renk gerçekten değişince yüklenir. Kalite ayarını tekrar seçmek gereksiz canvas boyutlandırması yapmaz. Küçük görünür-oyuncu kümesi tekrar kullanılır.

- Matris oluşturma sayısı: kare başına **969 → 737** (yaklaşık %24 azalma).
- GPU yükleme: **174.832 → 173.760 bayt/kare** (yaklaşık %0,6 azalma).
- İki buff'ın halka, ışın, kristal ve yükseltilmiş simgeleri altı çizimlik ortak havuzdadır. Okunabilirlik için küçük simgeler ağaçların önünde görünür, dünya geometrisinin derinlik testi korunur.
- Telefon görüntüsünde geometri sayısı 91 → 95, masaüstünde 98 → 98; emoji yeni GPU dokusu üretmez. Tekrarlanan görünüş değiştirme/doğuş testinde geometri ve doku sayıları büyümez. Sabit karelerde yeni GPU buffer ayrılmaz.
- Yazılımsal renderer medyan çizim gönderimi telefonda 3,7 → 4,7 ms, masaüstünde 6,2 → 5,1 ms. Bunlar ayrı yerel örneklerdir: CPU/GPU yükü değişebilir; telefonda FPS artışı kanıtı değildir. Zenginleştirilmiş işaretlerin maliyeti de vardır. Gerçek iPhone'da ısınmalı uzun oturumla ölçülmeli.

`npm run test:performance` kaynak bütçelerini ve animasyonları korur; düşük kaliteye zorlayarak ölçüm kazanılmaz. Ağ/yerel konum, çoklu dokunma ve koruma davranışları ayrıca tarayıcı testindedir.

## Uyumluluk

Protokol v2, eski altın paketler, girdi baytları, hasar/çarpışma matematiği, 30 Hz fizik ve 15 Hz yayın korunur. Emoji sabit anahtarlı isteğe bağlı bir olaydır. Yeni sürümün bilinçli koruma, buff konumu/bot rotası ve uzak karakter çizimi değişiklikleri için ayrı bir iz dosyası tutulur; eski referanslar silinmez. Web ve gelecekteki Swift istemcileri aynı otoriteye bağlanabilir.
