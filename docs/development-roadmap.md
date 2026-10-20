# Wildbow geliştirme planı

Tarih: 19 Ekim 2026. Durum: tasarım ve önceliklendirme taslağı.

Güncel uygulama durumu: [Takım, maç döngüsü, kart ve kozmetik sürümü](team-progression-release.md). Bu belgenin aşağıdaki önerileri geçmiş taslağı korur; hangi parçaların oynanabilir olduğu ve hangi ödeme özelliklerinin bağlı olmadığı sürüm notunda belirtilir.

Bu belge, mevcut oyunun incelenmesinden çıkan önerileri ve kullanıcının merkez joystick'li tek el modu isteğini bir araya getirir. Tek el kontrolü, oyuncu sayısına göre botlar, Cloudflare ağ/oda iyileştirmesi ve mobil menü bu geliştirmede uygulanır. Diğer oyun modları/yetenek fikirleri öneridir; yeni yeteneklerin sayıları deneme değerleridir. [Altı paket, düello, ek fikirler ve gelir planı](product-and-revenue.md) · [Ağ tasarımı ve ölçümler](network-design.md).

Başlangıç sürümü: `78235b204b4cb2d0bf393fdbe488a957302868d7`. Kullanıcı bu sürümde yürüyüş ve mevcut OTO düğmesinin düzgün çalıştığını doğruladı. [Kaynak ve oynanabilir yedek](stable-backup.md).

## Mevcut temel

- Klasik klavye/fare veya çift joystick; hareket sol altta, nişan sağda.
- Klasik düzende isteğe bağlı OTO düğmesi; menüden seçilen Tek el düzeninde merkez joystick, açık başlayan otomatik atış ve dokunarak hedef kilidi.
- 150 başlangıç canı, 15 temel hasar, doğuş kalkanı, atılma ve +25 can iyileştirme.
- 12 kalıcı yetenek; 15 saniyelik %30 atış hızı veya %20 ok hasarı veren iki güç noktası.
- Küçük XP, haritada işaretli 60 XP'lik nadir kristaller, siperler ve gizlenme çalıları.
- Botlu antrenman, oda kodu/davet ile gerçek çok oyunculu arena, sunucu otoritesi ve mobil/ağ testleri.

## 1. Deneysel tek el modu — kullanıcı isteği

Durum: bu geliştirmede uygulanır. Klasik ve Tek el aynı oda/kurallarda oynar; tercih cihazda saklanır. Boş arena alanına dokunma kilidi kaldırır. Ana varsayılan olup olmayacağı kullanıcı denemesinden sonra seçilir.

### Deneyim

Ana menüde mevcut **Klasik** düzenin yanında **Tek El · Deneysel** seçeneği bulunur. Oyuncu yalnızca karakterini yönlendirerek oynayabilir.

- Tek hareket joystick'i **alt ortadadır**.
- Sağ nişan joystick'i bu deneysel düzende gösterilmez; klasik düzende kullanılmaya devam eder.
- Otomatik atış bu moda girince açık başlar; ayrıca OTO'ya basmak gerekmez.
- Menzildeki uygun rakiplerden mevcut canı en düşük olan otomatik hedeflenir.
- İsteğe bağlı olarak bir düşmana kısa dokunuşla elle hedef kilidi konur.
- Geçerli elle kilit, başka bir rakibin canı daha az olsa bile korunur.
- Küçük bir hedef halkası kilidi gösterir; büyük bir yeni panel açılmaz.

İlk öneri: bu bir kontrol/nişan seçimi olsun; klasik ve tek el oyuncuları aynı oda ve aynı arena kurallarında birlikte oynayabilsin. **Antrenman / Online** seçimi ayrıca korunsun. Kontrol denemesi ayrı eşleşme havuzları oluşturmasın. İleride ana varsayılanın bu düzene dönüşmesi deney sonuçlarından sonra birlikte değerlendirilsin.

### Hedef ve kilit kuralları

- Mevcut 22 birimlik menzilde görünür, sipersiz ve korumasız uygun rakipler seçilir.
- Öncelik mutlak kalan candır; eşit can durumunda geçerli mevcut hedef korunur. İlk seçimde mesafe kullanılabilir.
- İstemci yalnızca hedef tercihi iletir. Menzil, görüş hattı, takım kuralları, atış aralığı, hasar ve isabet sunucuda doğrulanır.
- Hedef ölür, menzilden çıkar, sipere girer, korunur veya gizlenme kurallarına göre görünmez olursa kilit çözülür ve otomatik seçime dönülür.
- Önerilen kilit kaldırma hareketi boş arena alanına kısa dokunmaktır; uygulamadan önce birlikte değerlendirilebilir.
- Joystick, kart, menü, atılma ve iyileştirme etkileşimleri hedef kilidi oluşturmaz veya bozmaz.
- Ekranda yakın duran rakiplerde dokunma alanı ve seçimin görsel geri bildirimi ayrıca denenir.

### Diğer oyun davranışları

Deney ilk aşamada kontrol yerleşimi ve hedef tercihiyle sınırlıdır. Can, hasar, yetenekler, XP, nadir kristaller, güç noktaları, harita, oda kuralları, doğuş/seçim koruması, atılma ve iyileşme mevcut davranışlarını korur.

Can/XP şeridi, harita ve kompakt menüler korunur. Merkez joystick ile çakışan eylem düğmeleri için yalnızca gerekli yerleşim düzenlemesi yapılır; işlevleri ve kısa açıklamaları korunur. Yürüyüş animasyonu hareketi izler; hedefe bakmak ayakları veya gövde salınımını durdurmaz.

### Kabul ve deneme

- 390×844, 375×667 ve 844×390 görünümlerde joystick, can/XP, kartlar ve eylem düğmeleri çakışmaz; telefon güvenli alanları hesaba katılır.
- Tek parmakla yürürken otomatik atış tekrar eder; joystick bırakılınca hareket durur.
- Rakibe dokunup joystick'e dönmek takılı hareket veya fazladan atış oluşturmaz.
- Elle kilit geçerliyken yeni düşük canlı rakip hedefi değiştirmez.
- Ölü, gizli, siper arkasındaki, menzil dışındaki ve korumalı rakiplere uygunsuz kilit konamaz.
- Hedef kaybolunca otomatik seçime dönülür; uygun hedef yoksa rastgele ok atılmaz.
- Ölüm, yeniden doğuş, kart seçimi, odak kaybı ve bağlantı kesilmesinde eski hedef/parmak durumu temizlenir.
- Klasik kontroller, mevcut OTO seçeneği, masaüstü nişan ve yürüyüş için regresyonlar çalıştırılır.
- Gecikmeli ağ, yavaş mobil çizim, gerçek iki oyunculu oturum ve Safari/WebKit denenir.
- Oyuncu denemesinde kullanım kolaylığı, yanlış hedef seçimi ve elle kilit kullanımına bakılır. Ana varsayılanı değiştirme kararı bu karşılaştırmadan sonra verilir.

## 2. Süreli maç ve net hedef — öneri

Mevcut arena süresizdir; ölümde seviyeler/yetenekler sıfırlanırken toplam skor korunur. Uzun süredir odada olan oyuncunun sıralama avantajını azaltmak için ilk deneme **4 dakikalık arena** olabilir.

Tur başında eşit başlangıç, tur içinde yeniden doğuş, eleme/asist/ortak hedeflerden maç puanı, kısa sonuç ekranı ve aynı oyuncularla hızlı yeniden başlama. Karakteri geliştiren XP ile maç sıralama puanı ayrı dengelenir. Süresiz arena isteğe bağlı kalabilir.

Tur süresi, maç ortasında katılım ve yeniden doğuş ayrıntıları birlikte seçilecek ürün kararlarıdır.

## 3. Harita bölgeleri ve ortak olay — öneri

Harabeler siper/köşe değiştirme, orman yolları pusu/kaçış, açık çayır uzun atış, merkez açıklığı ortak hedef mücadelesi sağlar. Önemli hedeflere en az iki yaklaşma/kaçış yolu tasarlanır.

Mevcut nadir kristaller ve iki güç noktası temel alınır. Ek olay fikri **Orman Sunağı**: yaklaşık 60–90 saniyede bir tek noktada başlar; konumu önceden kısa süre gösterilir. Ödülü maç puanı veya mevcut geçici güçlerden biri olabilir. Aynı anda bir olay, haritada bir simge ve kısa bildirim yeterlidir.

Az sayıda kırılabilir sandık/çit daha sonra denenebilir. Uzun duvar ve çitler görünen şekle uygun çarpışma gerektirir. Yerleşimler erişilebilir doğuş noktaları, bot rotaları ve mobil çizim yüküyle birlikte denenir.

## 4. Yetenek kombinasyonları ve yeni kartlar — öneri

Mevcut yeteneklerle belirgin oyun tarzları: **keskin nişancı** (uzak atış/germe/hassas nişan), **alan kontrolü** (çatal/zincir/patlama), **takipçi** (buz/hareket), **dayanıklı okçu** (can/savunma/iyileşme).

Seçilen yeteneklerle uyumlu bir kartın önerilmesi ve maçta bir kez kart yenileme hakkı düşünülebilir. Kombinasyon adları kendi başlarına ek hasar çarpanı vermez.

| Yeni kart      | İlk deneme etkisi                                              | Denge sınırı                                                |
| -------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| Geri dönen ok  | Bir kez geri döner; dönüşte %40 hasar.                         | Siperler keser; dönüş yeni sekmeler üretmez.                |
| Koruyucu kabuk | Bir doğrudan okun hasarını %40 azaltır.                        | 6 saniyede bir; tam dokunulmazlık yok.                      |
| Temiz kaçış    | Atılmayla gerçekten bir oktan sıyrılınca +8 can.               | Atılma başına bir kez, en fazla 6 saniyede bir.             |
| Kristal çekimi | Küçük kristal toplama alanı %40 artar.                         | Nadir kristallere ve güç noktalarına işlemez.               |
| Usta geriş     | Tam gerilimde doğru zamanlama, sonraki gerişi %15 hızlandırır. | Tek atışlık etki; birikmez; zaman penceresi testle seçilir. |

Sayılar kesin denge kararı değildir. Manuel/tek dokunuş/otomatik atış, yan oklar, zehir, sekme, güçler ve korumalarla birlikte test edilir.

## 5. Hedefleme ve kişisel kontrol ayarları — öneri

Tek el deneyinin kilit altyapısı ortak kullanılabilir. Klasik düzende isteğe bağlı düşük canlı/en yakın hedef tercihi, joystick boyutu/konumu ve solak düzeni ayarlarda sunulabilir. Arenada kompakt kontroller ve küçük hedef işareti yeterlidir.

Otomatik ve manuel atış eşit seviye/yetenek koşullarında karşılaştırılır. Manuel atışın menzil/zamanlama/hedef seçimi avantajı anlaşılır kalır. Kontrol tercihi için ayrı can/hasar bonusu verilmez.

## 6. Vuruş hissi ve savaşın anlaşılması — öneri

Yay bırakmada kısa kol/gövde tepkisi, okunabilir isabet, yakından geçen ok sesi ve kısa süre sipere saplanan havuzlanmış oklar değerlendirilebilir. Efekt/ses yoğunluğu ve kamera hareketi kontrolün okunabilirliğini korur.

Hasar sayıları isteğe bağlı olabilir; başlangıçta yalnızca oyuncunun verdiği hasar gösterilebilir. Ölüm ekranına son vuruşu yapan, kullanılan etki ve alınan hasar gibi kısa açıklamalar eklenebilir. Mevcut ses temizleme, zehir tiklerinin sessizliği, yürüyüş yumuşatması ve kompakt HUD regresyonla korunur.

## 7. İnsan sayısına göre botlar ve doğal davranış — öneri

Durum: online odanın sekize tamamlanması uygulanır; aşağıdaki yeni bot davranışları sonraki önerilerdir. Antrenmanın yedi botu korunur.

Mevcut yedi sabit bot yerine toplam katılımcıyı yaklaşık sekize tamamlayan düzen: bir insan için yedi, altı insan için iki, sekiz veya daha fazla insan için sıfır bot. Boş odada simülasyonun durması ve toplam kapasite sınırı korunur. İnsan giriş/çıkışında bot değişimi devam eden çatışmayı bozmamalıdır.

Düşük canla sipere çekilme, açık atış hattı arama, belirgin oktan kaçmaya çalışma ve ortak hedefe rota değiştirme eklenebilir. Tepki/nişan hataları kontrollüdür; botlar gizli bilgi kullanmaz. Oda menüsünde insan ve bot sayıları açıkça gösterilir.

## 8. Arkadaşlarla oynama ve diğer modlar — öneri

- **Botsuz 1v1:** eşit koşullarda kısa düello ve denge denemesi.
- **2v2:** takımlar, dost ateşi, takım puanı ve güvenli doğuş.
- **Özel odalar:** süre, bot sayısı ve başlangıç yeteneği ayarları.
- **Battle Royale:** yeterli oyuncu sayısı ve önceki modların sonuçlarından sonra değerlendirme.

TDM/BR kod iskeletleri tamamlanmış oynanabilir modlar değildir. Oyuncu sayısı düşükken ortak ana arena ve davetli odalar ayrı genel sıralara tercih edilebilir.

## 9. Kalıcı profil, kozmetik ve kısa hedefler — öneri

Kişisel rekor, toplam isabet, tamamlanan maçlar, favori yetenekler; bunlarla açılan pelerin, yay ve ok izleri. Örnek hedefler: üç maç tamamla, on isabet yap, bir ortak olaya katıl.

Kozmetikler savaş gücü vermez. İlk aşamada cihazda kişisel ilerleme düşünülebilir; cihazlar arası kayıt ve güvenilir genel sıralama sunucuda doğrulanan profil gerektirir. Misafir olarak hızlı başlama korunur.

## 10. Mobil uygulama deneyimi ve görüntü ayarları — öneri

Ana ekrana eklenebilen web uygulaması (PWA), pil tasarrufu/dengeli/yüksek görüntü ayarları ve karakteri örten ağaç tepelerinin saydamlaşması değerlendirilebilir. Saydamlaşma gizli rakipleri açığa çıkarmaz.

Online oyun bağlantı gerektirir; çevrimdışında botlu antrenman sunulabilir. Önbellek/güncelleme, yeni sürümün eski dosyalara takılmamasını sağlamalıdır. Yatay/dikey görünüm, güvenli alanlar ve düşük FPS'de bağımsız ağ girdisi korunur.

## 11. Ölçüm, performans ve ücretsiz altyapı — tüm paketlerle birlikte

İlk ölçümler: ilk dakikada ölüm, manuel/otomatik isabet, yetenek seçimi, insan/bot oranı, mobil kare süreleri, sunucu işlem ve ağ mesaj yükü. Yetenekler eşit seviye/koşullarda ayrıca karşılaştırılır.

Cloudflare ücretsiz kota hedefi korunur; kapasite ve maliyet ölçülür. Gereksiz bot simülasyonu, sınırlı efekt havuzları ve gereksiz ağ yükü incelenir. Yeni özellikler sınırsız ücretsiz eşzamanlı kullanım varsayımına dayanmaz.

## Önerilen sıra ve birlikte verilecek kararlar

| Sıra      | Paket                                                       | Durum                                         |
| --------- | ----------------------------------------------------------- | --------------------------------------------- |
| İlk deney | Merkez joystick'li tek el, otomatik atış ve dokunarak kilit | Kullanıcı isteği; mevcut oyunla karşılaştırma |
| 1         | Süreli maç, sonuç ekranı ve asist puanı                     | Değerlendirme önerisi                         |
| 2         | İnsan sayısına göre botlar ve doğal davranışlar             | Değerlendirme önerisi                         |
| 3         | Harita bölgeleri ve tek ortak olay                          | Değerlendirme önerisi                         |
| 4         | Yetenek kombinasyonları, yeni kartlar ve kontrol ayarları   | Değerlendirme önerisi                         |
| 5         | Kalıcı kozmetikler, profil ve ana ekrana ekleme             | Değerlendirme önerisi                         |
| 6         | Düello ve 2v2                                               | Değerlendirme önerisi                         |

İlk ortak değerlendirme: tek el deneyinin sonucu ve varsayılan olup olmayacağı; tur süresi/puan kuralları; ortak olay ödülü; yeni kartlardan hangilerinin seçileceği; paketlerin uygulama sırası. Klasik oyuna dönüş için yedek referansları korunur.
