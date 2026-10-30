# Telefondan bağlantı teşhisi

30 Ekim 2026 kontrolü: eksik/yanıtsız yoklamalar artık düşük medyanın arkasında
gizlenmez; p95 sıçramaları ayrı değerlendirilir. Çift sayıda örnekte medyan iki
orta değerin ortalamasıdır. Avrupa bağlantıları için mevcut bölgesel testin
yanına diğer Avrupa bölgesi (EEUR ↔ WEUR) eklenmiştir; bu yalnızca teşhistir,
oyuncuların eşleştirme bölgesi otomatik değiştirilmez. WebSocket girişinin kendi
coğrafya bilgisi raporlanır; HTTP bilgi isteğinin giriş noktasıyla aynı olduğu
varsayılmaz. Eski test istemcileri yeni `route` alanını güvenle yok sayar.
Ayrıca profil yenilenirken Ayarlar ve sabit yetenek listesinin yeniden
oluşturulması engellendi. Geciken profil yanıtı artık açık ayarları, odaklanılan
seçeneği veya test bağlantısını yerinden kaldırmaz. Gecikmiş gerçek profil
yanıtıyla bu durum tarayıcı testinde ayrıca sınanır.

26 Ekim 2026: iPhone 14 Pro / Chrome görüntüsünde 60 FPS, kare p95 18 ms,
511 ms ping ve 85 ms durum geliş düzensizliği; kullanıcı Wi‑Fi'da da değişken
150–200 ms bildirdi. Bunlar yalnızca test makinesinde düşük ping ölçmenin
telefonun sorununu açıklamadığını gösterir. Tek başına Cloudflare arızası veya
operatör kusuru kanıtı değildir.

Yedek: `backup/pre-device-route-diagnostics-6f4afd3`. Çalışma dalı:
`fix/device-route-diagnostics`.

## Kullanım

Oyundan menüye dön → **Ayarlar → Bağlantıyı test et ↗** → **Testi başlat**.
Ayar bağlantısı adres çubuğundaki son gerçek oda kodunu taşır. Doğrudan
`/connection-test.html` açıldığında giriş ve bölgesel test yapılır; `?room=...`
eklendiğinde son oda da ölçülür. Performans göstergesi açıkken oda kodu görünür.
Sonucu kopyala düğmesiyle okunabilir rapor alınır. Wi‑Fi ve mobil veride aynı
telefondan karşılaştırılır; sekme değiştirilirse ölçüm iptal edilir.

## Ölçülen üç yol

1. Tarayıcı → Cloudflare girişindeki Worker WebSocket yankısı.
2. Tarayıcı → sağlayıcının coğrafyasına göre seçilen, konum önerili bölgesel
   Durable Object yankısı. Her bölge için sabit bir teşhis nesnesi vardır.
3. Tarayıcı → son oyun odasının aynı Durable Object'indeki bağımsız yankı.

Her yol aynı küçük JSON isteğiyle, tek bekleyen istek kimliğiyle, en fazla 20
gidiş-dönüş örneği toplar. Geç gelen cevap sonraki isteğin ping'i sayılmaz.
Medyan, p95 ve geçerli yanıt sayısı ayrı gösterilir. Giriş noktasının IATA kodu
oyun odasının fiziksel sunucu şehri değildir. Bölge yalnızca yerleşim önerisidir.

Test sayfası Three.js çalıştırmaz. Yankı paketleri maç durum paketlerinden
küçüktür; bant genişliği yükünü veya maç sırasında oluşan tüm takılmaları tek
başına temsil etmez. Rapor, oda ölçülürken gerçek oyuncu sayısını ve simülasyonun
açık olup olmadığını da içerir. Boş oda testi aktif 32 kişilik maç yükü değildir.
Kısa örnekten istatistiksel kapasite veya kalıcı ping garantisi çıkarılmaz.
Eksik yanıtlar TCP üzerinde uygulama zaman aşımıdır; doğrudan ağ paket kaybı
yüzdesi olarak yorumlanmaz. Alternatif bölge için de tam yanıt alınmadan daha
iyi bağlantı sonucu çıkarılmaz.

## Yorum ve sonraki karar

- Giriş de yüksek/değişkense telefon → Cloudflare erişim yolu araştırılır;
  Wi‑Fi/5G ve alternatif sunucu aynı cihazdan ölçülür.
- Giriş düşük, DO yolları yüksekse yerleşim, iç ağ ve işlem kuyrukları incelenir.
- Sadece eski oyun odası yüksekse odaya özgü yerleşim/yük karşılaştırılır.
- Küçük yankılar düşükken maç gecikiyorsa gerçek veri akışı, işlem ve tarayıcı
  beklemeleri ayrıca incelenir.

Sunucu taşıma adayı Türkiye'ye yakın sabit konumlu bir VPS'dir. Oracle A1
4 OCPU/24 GB ancak uygun bölgedeyse adaydır; kapasite ayrı yük testi gerektirir.
Mevcut Node/Socket.IO sunucusu Cloudflare'ın profil/RP entegrasyonu ve v2 ikili
taşımasıyla eşdeğer değildir. Geçişte ortak World, yetenekler, yetkili vuruş
hesabı, profil/RP ve v2 sözleşmesi korunmalıdır. Bu yayında sunucu taşınmaz.

## Etki ve doğrulama

Yankı yolu oyuncu/rezervasyon/profil oluşturmaz, dünyayı ilerletmez. ArenaRoom
yankıyı format/oyun kurulumundan önce işler. Bağlantı 25 saniyede veya 24 mesajda
kapanır; istemci kapanışı da cevaplanır. Ayrılan oyuncunun eski odasında yankı
açılması bot döngüsü başlatmaz. Yeni binding, migration ve oyun protokol alanı yok.
Normal oyunda ek ağ yoklaması yapılmaz; ölçüm kullanıcı başlatınca çalışır.

Birim testleri güvenilir coğrafya, CORS, oda kimliği, durum izolasyonu, süre/mesaj
sınırı ve geç yanıt kimliğini kapsar. Native Workerd tarayıcı testi Chrome/Safari
motorlarında ayar bağlantısını, oda satırını, 20×3 yankıyı, sürmekte olan maçın
korunmasını, menü dönüşünü, telefon yerleşimini ve iptali sınar. Tarihsel otorite,
JSON/v2 ve görüntü izleri mevcut referanslarla sınanır. CI ayrıca mevcut
multiplayer ve FPS ayarlarını yeniden denetler.
