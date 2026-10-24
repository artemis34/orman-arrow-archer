# Kare akıcılığı optimizasyonu — 24 Ekim 2026

Başlangıç: `ab4fed8eeb083b2de43c9def6f64e29ef94a1d93`. Çalışma dalı `optimization/frame-pacing-2026-10-23`; kaynak yedeği [`backup/pre-fps-pass-ab4fed8`](https://github.com/artemis34/orman-arrow-archer/tree/backup/pre-fps-pass-ab4fed8). Tam geçmişi içeren doğrulanmış yerel kopya `/workspace/backups/wildbow-before-frame-pacing-ab4fed8.bundle`.

## Bulunan maliyetler ve düzeltmeler

- Instance havuzları boş kapasiteyi de her kare GPU'ya yüklüyordu. Artık yalnız etkin önek yüklenir; çizilmeden önce küçülen/gizlenen havuzların bekleyen renk güncellemeleri de korunur. Sıfır öğe yeni yükleme üretmez.
- 16 karakterin 32 ayrı yay/gergi çizimi, aynı dünya dönüşümleri ve linear renklerle bir çizime birleştirildi. Şarj, buff rengi, görünürlük ve kozmetik değişimleri korunur; uyumsuz materyal kendi normal çizimine döner.
- Her hasarda 256×80 isim/can dokusu tekrar yükleniyordu. İsim statik dokuda kaldı, can barı küçük shader uniformlarıyla güncellenir. İsim/takım değişimi gerektiğinde dokuyu yeniler. Düşük can, takım rengi, kendi karakterinin mini can barı ve alfa maskesi korunur.
- Shader derleme ve ilk program sorguları ilk çatışmada duraklatıyordu. Demo bir kez açılış perdesi altında, `dt=0` ile çizilir; programlar en çok dört saniyelik kendi hazırlık döngüsüyle hazırlanır. Hazırlık dünya/oyuncu girdisi ilerletmez veya online odaya bağlanmaz. Süre aşımı/GPU bağlam kaybı arka planda polling bırakmaz. Shader hata denetimleri açıktır.
- Opak, terrain'in bütünüyle üzerindeki statik parçalar ve yollar daha erken çizilir. GPU onların arkasındaki zemin gölgelendirmesini atlayabilir. Örtüşen boyalı zeminlerin depth-write kuralları, geometri ve gölgeler değiştirilmez.
- Joystick `pointermove` başına ekran ölçüyordu. Ölçüm gesture başlangıcı ve gerçek boyut değişimiyle sınırlanır; iki parmak ve boyut/ekran yönü tercihleri korunur. Sıfır genişlikte tam hız üreten bir köşe durumu da nötr hale getirildi.
- Kritik/kill/level/emoji yazıları `left/top` yerine bağımsız CSS `translate` ile izlenir; mevcut büyüme/sönme animasyonu korunurken yerleşim işi azalır.
- Antrenmandaki 30 Hz konum basamakları mevcut easing'e rağmen görünen yürüme hızını dalgalandırıyordu. Konumlar aynı tick'ler arasında çizilir; can/ölüm/koruma/tur üyeliği en güncel otoriteden gelir. İlave bir tick'e kadar (yaklaşık 33 ms) görüntü gecikmesi karşılığında hız salınımı giderilir. Çevrimiçi tahmin ve sunucu fiziği değiştirilmez.

## Ölçümler ve sınırlar

[Ham raporlar](../benchmarks/results/fps-2026-10-24/). Aynı çözünürlük ve kalite: telefon DPR1.5/gölge1024; masaüstü DPR1.5/gölge2048. 16 animasyonlu karakter, 120 ok, 140 kristal, beş nadir kristal, 16 buff yayı ve 32 gölge üreten gövde/kafa korunur.

| Ölçüm                                                      |           Önce |             Sonra |
| ---------------------------------------------------------- | -------------: | ----------------: |
| Telefon en fazla çizim çağrısı                             |            124 |                93 |
| Masaüstü en fazla çizim çağrısı                            |            127 |                96 |
| Instance/veri yüklemesi                                    | 173.760 B/kare |     57.472 B/kare |
| Telefon GPU geometri kaynağı                               |             95 |                64 |
| Masaüstü GPU geometri kaynağı                              |             98 |                67 |
| İsim dokusu / gölge boyutu                                 |      17 / aynı |         17 / aynı |
| 60 Hz antrenman görünen hız standart sapması               |  >1,4 birim/sn | <0,00001 birim/sn |
| İlk maç CPU örneklemesinde shader bilgi sorgusunda bekleme |       325,9 ms |              0 ms |

Çizim çağrısı yaklaşık %25, tampon aktarımı yaklaşık %67 azaldı. Başlangıç referansında canlar sabittir; son kaynak bütçesi testinde 16 can barı her kare değiştirilerek savaş sırasındaki sıfır doku yenilemesi ayrıca doğrulanır. Sabit karelerde yeni GPU buffer ayrılmaz; tekrar kuşanma/ölüm/doğuş kaynak sayısını büyütmez. Kaynak sayısı VRAM baytı veya fiziksel RAM tasarrufu garantisi değildir. Havuz kapasiteleri korunur; yeni birleşik çizgi tamponları ve önceden ayrılan renk alanları küçük, sınırlı ek depolama kullanır.

Gerçek RAF aralıkları da ölçüldü. Yazılımsal SwiftShader telefon örneğinde yoğun fixture 5,55→6,30 FPS; gerçek antrenman oturumunun ilk bölümü 8,13→8,48 FPS, p95 kare 183,3→166,7 ms çıktı. Başlangıç örneği altı, son örnek sekiz saniyedir; kısa tek örnekler ve değişen gerçek oyun olayları istatistiksel FPS artışı kanıtı değildir. Yazılımsal GPU burada baskın darboğazdır. Bu rakamlar fiziksel iPhone FPS'si veya sabit 60 FPS iddiası olarak kullanılamaz. İlk hedef belirgin kare sıçramalarını kaldırmak ve GPU/driver işini azaltmaktır; fiziksel iPhone'da uzun oturum/ısınma ölçümü ayrıca gerekir.

`benchmarks/frame-pacing.js` gerçek RAF, bütün sayfa CPU örneklemesi, heap ve GL aktarım raporları üretir. Heap örnekleri GC zamanından etkilendiği için RAM kazanımı çıkarılmaz. CPU profilleri yerelde `/tmp/wildbow-fps-*/` altında kalır. Sunucu, 30 Hz fizik, 15 Hz yayın ve v2 paketleri aynı olduğundan bu sürüm için yeni ağ/fatura tasarrufu iddiası yoktur.

## Görsel ve davranış kontrolü

Can barı eski Canvas çizimiyle üç boyutta ve dokuz durumda karşılaştırılır. İsim ve alfa maskesi aynı; küçültülmüş bar ucunda en fazla birkaç filtreleme pikseli değişir. HP değişiminden sonra texture version ve GL texture yüklemesi artmaz. Chrome'da 27 referans +27 HP değişimi karşılaştırması geçti.

Statik opak çizim sırası, iki ekran boyutunda altı kamera konumu/pan adımıyla önceki sıralamayla karşılaştırılır. Derinlik yazımı, gölge ve vertex sayıları aynı; görülen fark en çok 23 birleşim pikseli/1.024.000 piksel oldu. Opaque patchlere depth yazdıran daha riskli çözüm uygulanmadı. Dinamik karakter gölgelerini dondurma veya grafik kalitesini düşürme de uygulanmadı.

`npm test`, `npm run check`, her iki build; tam kalite renderer, piksel karşılaştırmaları, masaüstü/mobil hareket, çift joystick, otomatik atış, korunma/kartlar, ölüm/doğuş, ses, ok hareketi ve Cloudflare çok oyunculu kontrolleri kullanılır. WebKit karşılaştırmaları yayın CI'ında da çalışır.

## Sonraki öneriler

1. Ayarlardan açılan, yerelde çalışan küçük FPS/ping/kare süresi tanısı. Fiziksel cihazda hangi sahnenin yavaşladığını görmeyi sağlar; varsayılan oyun ekranını kalabalıklaştırmaz.
2. Hareketli hedefler ve atılma kapıları içeren 20 saniyelik isteğe bağlı alıştırma parkuru; kişisel süre/isabet rekoru kozmetik rozetle ödüllendirilebilir.
3. Yeni kalıcı kuyruklar açmak yerine haftada tek dönen etkinlik: örneğin takım bayrağı/ikmal yarışı. Küçük oyuncu kitlesini çok sayıda moda bölmeden çeşitlilik sağlar.
4. En uzak isabet, temiz kaçış ve takım kurtarışı gibi maç içi başarılar için yalnız görünüş ödülleri. Var olan yaprak/kozmetik sistemi kullanılabilir; yeni güç avantajı veya para birimi gerekmez.
