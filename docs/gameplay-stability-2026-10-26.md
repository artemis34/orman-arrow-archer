# Oynanış ve bağlantı kararlılığı — 26 Ekim 2026

Kaynak yedeği: [`backup/pre-gameplay-stability-bdbe181`](https://github.com/artemis34/orman-arrow-archer/tree/backup/pre-gameplay-stability-bdbe181). Değişiklikler önce `optimization/gameplay-stability-2026-10-26` dalında sınanır. Önceki çalışan sürüm `bdbe181`.

## Düzeltilen davranışlar

- **İlk joystick çekişi:** Kartlar göründüğü anda seçim başlangıcı parmağın son konumuna alınır. Eskiden ilk yeni hareket başlangıcı yeniden ayarlayıp boşa gidebiliyordu. İlk sola/yukarı/sağa çekiş şimdi doğrudan kartı vurgular. Aynı parmakla seçim sonrası yürümeye devam edilir; kartı kapatmak konum sıçraması üretmez.
- **Okuma süresi:** Otomatik joystick onayından önce beş saniyelik görünür okuma zamanı korunur. Sekmenin arka planda veya kartların kapalı olduğu süre okunmuş sayılmaz. Yeniden açılan kartlar yeniden beş saniye verir. Bilinçli karta dokunma, klavye veya çekip bırakma anında seçer; korumanın kalan süresi bekletmez. Kartlar seçim yapılmadan kendiliğinden kapanmaz.
- **Geri sayım:** BR ve diğer turlu modlarda oyuncu yönünü maç başlamadan basılı tutabilir; başlarken parmağını kaldırıp yeniden basması gerekmez. Otorite beklerken hareket, atış, atılma veya can yenileme işlenmez. Bekleme sırasında basılmış atılma komutu maç başlangıcına taşınmaz.
- **Yetenek geri bildirimi:** Bekleyen, dolu cana basılmış veya bekleme süresindeki tuş devre dışıdır. Süre yukarı yuvarlanır; henüz hazır değilken `0` yazmaz. Tek elde otomatik can desteğinin hazır/kalan süre bilgisi mevcut durum satırında yer alır. Gerçek sunucu can yenilemesi yeşil `+ CAN`, kısa mesaj ve sonlu, kendine özgü ses üretir. Yeni kalıcı panel/tuş eklenmez.
- **Otomatik hedef:** Görsel nişan ve yay, geçerli olduğu sürece sunucunun zaten seçtiği hedefi kullanır. Açık oyuncu kilidi önceliklidir. Ölü, gizli, korunan, menzil dışındaki veya siper arkasındaki hedef yine mevcut kurallarla elenir. Gereksiz tüm oyuncu/siper taramaları azaltılır. Sunucunun aynı oyuncu adımında bulduğu hedef ikinci kez aranmaz.
- **Girdi gecikmesi:** Yeni web istemcisi hareket başlangıcını ve 60 dereceden büyük yön değişimini ikili paket dolana kadar bekletmez. Girdiler sırayla ve kayıpsız korunur. Bu en fazla yaklaşık 33 ms paketleme beklemesini kaldırır; fiziksel internet RTT'sini azaltmaz. Kesintisiz hareket 30 girdi/15 paket/sn, sunucu yine 30 Hz ve durum gönderimi 15 Hz'dir. Başlangıç/dönüşlerde biraz daha fazla küçük girdi paketi gönderilmesi karşılığında daha hızlı tepki alınır. Eski istemciler ve v2 biçimi desteklenir.

## Cloudflare yerleşimi

Hızlı katılım, Cloudflare'ın güvenilir `request.cf` coğrafyasına göre sekiz bölge havuzundan birini seçer. Türkiye `eeur` kullanır. Matchmaker ve yeni oyun odaları aynı bölge için Durable Object `locationHint` alır. Örnek: `brduo-wildbow-eeur-1`.

Bu değişiklik herkesin eskiden ilk oluşturulmuş tek global genel odaya uzak mesafeden gitmesini önlemeyi hedefler. Konum bir sağlayıcı önerisidir; kesin veri merkezi veya ping garantisi değildir. Bölgelerin oyuncu havuzlarını ayırması, az nüfusta daha çok botlu oda anlamına gelebilir; mevcut bot doldurma kuralları korunur. Oda başına simülasyon maliyeti azaltılmış gibi sunulmaz.

Eski `wildbow-1` ve özel arkadaş davetleri çalışır. Bölge içeren bir davete başka ülkeden katılınca aynı oda kimliği kullanılır. Genel takımlı odada birbirinden bağımsız katılan insanlar arkadaş partisi sayılmaz. Solo/ikili RP, profil ve arkadaş verisi bölgelere ayrılmaz. Yeni binding, migration veya protokol sürümü yoktur. Operasyonel geri dönüş için `REGIONAL_MATCHMAKING=off` yeni hızlı katılımı eski global havuza yönlendirir; var olan bölgesel davetler geçerli kalır.

## Ölçümler ve sınırları

[Ham yerel sonuçlar](../benchmarks/results/gameplay-stability-2026-10-26/). Node v24.19.0; aynı ortamda üç örneğin medyanı. Bu kısa ölçümler paylaşılan CPU yükünden etkilenir; sunucu için istatistiksel hızlanma iddia edilmez.

| İnsan + bot | Tick p95 önce → sonra | CPU ms / simülasyon saniyesi önce → sonra | Sunucu durum baytı/sn önce = sonra |
| ----------- | --------------------: | ----------------------------------------: | ---------------------------------: |
| 2 + 6       |      0,497 → 0,487 ms |                             10,62 → 10,42 |                           26.844,5 |
| 8 + 0       |      1,252 → 1,481 ms |                             21,65 → 24,20 |                            144.358 |
| 16 + 0      |      3,215 → 3,460 ms |                             52,57 → 51,68 |                            540.447 |

Örnekler arasında GC kaynaklı negatif heap farkı da vardır; bunlar negatif RAM tüketimi veya bellek kazanımı anlamına gelmez. 16 insan örneğinde saklanan heap yaklaşık 350,5 → 348,0 KiB; ölçüm gürültüsünün içindedir. Dünya/spatial sorgu havuzlama denemesi ölçülebilir yarar göstermediği için çıkarılmıştır.

Ek yedi örnekli tekrarda CPU ms/s: 2 insan 9,25 → 8,83; 8 insan 22,36 → 21,56; 16 insan 52,59 → 52,59. Tick p95: 0,501 → 0,464; 1,282 → 1,337; 3,672 → 3,631 ms. İlk kısa ölçümdeki farkın kararlı bir sunucu hızlanması/yavaşlaması olmadığı bu tekrarlarla da görülür; aktarım baytları ve mesaj sayıları yine aynıdır.

Ayrı **istemci hedef seçimi mikro ölçümünde** 10.000 çağrı, beş örnek medyanı:

| Görünür oyuncu |       Tam arama | Geçerli otoriter hedefi kullanma |
| -------------- | --------------: | -------------------------------: |
| 8              |  2,545 µs/çağrı |                   0,407 µs/çağrı |
| 16             |  5,604 µs/çağrı |                   0,538 µs/çağrı |
| 32             | 10,428 µs/çağrı |                   0,345 µs/çağrı |

Bu yalnızca bu fonksiyonun maliyetidir; tüm oyunun %97 hızlandığı veya cihaz FPS'sinin arttığı sonucu çıkarılamaz.

Tam kaliteli yoğun çizim testi: 16 animasyonlu oyuncu, 120 ok, 140 kristal, beş nadir kristal ve 16 güçlendirilmiş yay. Mobil/masaüstü en fazla 93/96 çizim çağrısı; tekrar donatmadan sonra geometri 64/67, doku 17 olarak sabit; kararlı durumda yeni GPU tamponu/doku yüklemesi sıfır. Gölge, çözünürlük ve efektler azaltılmamıştır.

Canlı ölçümler `Measure live FPS and network` iş akışında yayımlanır: bir dakikalık çizimden bağımsız özel/genel WebSocket akışı ve 45 saniyelik üretim istemcisi. Üretim testi yayımlanan istemci varlığının derlemeyle eşleşmesini bekler. Başsız SwiftShader FPS'si fiziksel iPhone FPS'si değildir; test makinesinin ping'i Türkiye'deki telefonun ping'i değildir. Bu ortam telefon sıcaklığını ölçmez.

## Yayın öncesi canlı bağlantı

[Ölçüm çalışması](https://github.com/artemis34/orman-arrow-archer/actions/runs/40279192793), eski `index-uqQLngCF.js` istemcisi; 60 saniye çizimden bağımsız WebSocket. Aynı CI makinesinden Cloudflare giriş noktası DFW; Türkiye telefonu değil.

| Oda                    | Gerçek RTT medyan / p95 | Durum/sn | Simülasyon / yerel süre | 150 ms üzeri boşluk |
| ---------------------- | ----------------------: | -------: | ----------------------: | ------------------: |
| Yeni özel oda          |        22,41 / 24,65 ms |    15,15 |                  1,010× |                   0 |
| Eski genel `wildbow-1` |      152,30 / 153,20 ms |    15,22 |                  1,014× |                   0 |

Her iki akış düzenli olmasına rağmen genel odanın RTT'si belirgin yüksek. Bu fark, eski genel odanın uzakta oluşturulmuş olmasının etkisiyle uyumludur; tek başına tam veri merkezi konumunu kanıtlamaz. Bölgesel yerleşim bu sorunu hedefler. Yayın sonrası genel oda ölçümü aynı iş akışıyla karşılaştırılacaktır.

## Doğrulama kapsamı

- Yerelde 371 birim testi ve TypeScript kontrolü geçti. Tarihsel otorite, JSON, v2 baytları ve istemci görüntü izleri referansları değiştirilmeden geçti.
- Arena, solo BR, ikili BR, tur arenası, düello, iki/dört/sekiz takım, dörtlü/ikili takım modlarında tek el kontrolleri; ayrıca arena/düello/ikili BR masaüstü kontrolleri: motor başına 13 senaryo. Hareket/durma, geri sayımda basılı yön, atılma/bekleme, otomatik veya E ile can basma, hasar koruması, ilk çekişte kart seçimi ve menüye dönüş sınanır. Kontrol senaryoları gerçek otoriter World ile kontrollü harita/rakipler kullanır; normal harita/botlar ayrıca native Workerd mod testleriyle sınanır.
- Ayrı testler gerçek iki parmak, 130–210 ms RTT/düzensizlik, 600 ms çizim durması, bağımsız hareket/nişan, hızlı dokunma sonrası gövde dönüşü, iptal edilen atış, yatay/dikey ekran ve odak kaybını kapsar.
- Native Workerd testleri tüm formatları, BR tur döngüsünü, 32 koltuk dolumu/taşmasını ve bölgesel genel/özel takım ayrımını kapsar. Chrome/Safari motorlarında 26 kontrollü oynanış senaryosu ve iki bağımsız tarayıcıyla native Worker multiplayer testi geçti. [Son dal doğrulaması](https://github.com/artemis34/orman-arrow-archer/actions/runs/40280093975) geri sayım dokunma sınır durumu dahil bütün doğrulama, multiplayer ve 26 oynanış senaryosunu başarıyla tamamladı.

Ek yerel yük denemesinde her format bir ve iki insanla, normal harita ve bot nüfusuyla 900 adım (30 simülasyon saniyesi) çalıştırıldı. İnsanlara özgü v2 durum kodlaması dahil en yüksek tick p95 değeri 3,42 ms oldu. Solo/ikili BR başlangıç nüfusu 32 idi. Bu kısa yerel örnek, Cloudflare faturalama veya üretim kapasite garantisi değildir.
