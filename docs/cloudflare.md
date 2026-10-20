# Cloudflare online arena

Bu sürümde site ve çok oyunculu sunucu aynı Cloudflare Worker üzerinde çalışır. Gerçek oyuncular aynı oda kodunu kullanınca aynı Durable Object içindeki otoriter dünyaya bağlanır. Node/Express/Socket.io dağıtımı da desteklenir; Cloudflare sürümü tarayıcının yerel WebSocket protokolünü kullanır.

## Hesaptan yayın

[Cloudflare’a dağıt](https://deploy.workers.cloudflare.com/?url=https://github.com/artemis34/orman-arrow-archer) bağlantısını açıp kendi Cloudflare/GitHub hesabınla depoyu bağla. Workers Free planını kullan. Depodaki `wrangler.jsonc`, Worker girişini, statik dosyaları ve ücretsiz planda kullanılabilen SQLite Durable Object sınıfını tanımlar. Build komutu `npm run build:cloudflare`, deploy komutu `npm run deploy:cloudflare` olmalıdır; Wrangler özel build komutunu ayrıca çalıştırır. `dist-cloudflare` Git'e eklenmez, derleme sırasında üretilir.

Cloudflare'ın verdiği `https://orman-arrow-archer.<hesabın>.workers.dev` adresi hem oyunu hem `/health` ve `/api/rooms/...` uçlarını sunar. Proje adı `wrangler.jsonc` içindeki `orman-arrow-archer` ile aynı olmalıdır. Bu şablon adres dağıtım yapılmadan canlı bir bağlantı değildir. Workers.dev alt alanını ilk kez kullanıyorsan Cloudflare panelinde hesabın için etkinleştir. Cloudflare sürümü çok oyunculu seçili açılır ve sunucu adresi istemez. **Hızlı katıl** uygun genel arenada yer ayırır. **Arkadaşlarla oyna** seçeneğinde oda kodunu seç veya **Davet ↗** düğmesiyle `?room=...` bağlantısını paylaş. Kodlar 3–24 küçük harf, rakam veya tire içerir; oda kodu parola değildir.

Cloudflare'ın kendi GitHub build bağlantısıyla yayın yapılıyorsa yayın anahtarını Cloudflare yönetir; oyunun runtime ortamına API token veya Account ID eklenmez. `main` güncellendiğinde Cloudflare otomatik derleyip yayınlar. Bu deponun `cloudflare-live` GitHub Actions işi, üretimdeki istemci dosyasının yeni build ile eşleşmesini bekler ve gerçek adreste iki oyunculu ağ/tarayıcı testlerini çalıştırır. Hedef adres repository variable `CLOUDFLARE_SITE_URL` ile değiştirilebilir.

## CLI veya GitHub üzerinden yayın

Yerel bilgisayarda `npx wrangler login` ile Cloudflare hesabına giriş yapıp `npm run deploy:cloudflare` çalıştırabilirsin. CI için Cloudflare'ın **Edit Cloudflare Workers** API token şablonunu yalnızca kullanılacak hesaba yetkili oluştur. API token değerini sohbet, kaynak dosyası veya commit içine koyma.

GitHub deposunda Settings → Secrets and variables → Actions bölümüne:

- Secret: `CLOUDFLARE_API_TOKEN`
- Variable veya secret: `CLOUDFLARE_ACCOUNT_ID`

eklenince mevcut **Validate and publish** iş akışı başarılı testlerden sonra Cloudflare'a yayınlar. Hesap bağlanmamışsa bu adımı açıklamayla atlar; başarılı yerel testler Cloudflare'a yayın yapıldığı anlamına gelmez. Yayından sonra gerçek adreste iki istemcili ağ ve masaüstü/mobil tarayıcı kontrolleri yeniden çalışır. Adres Actions iş özetine yazılır.

Codex bulutundan yayın için aynı iki değişkeni güvenli ortam ayarlarına eklemek gerekir. Ortam bağlantısı ile GitHub Actions değişkenleri ayrı ayarlardır; biri diğerine gizli değer kopyalamaz. Cloudflare API ve yayınlanan `*.workers.dev` adreslerine ağ erişimi gerekir.

## Yerel çalışma ve test

Node.js 24 ile:

```sh
npm ci
npm run dev:cloudflare
```

Wrangler, Cloudflare istemcisini derler ve gerçek workerd/Miniflare ortamını 8787 portunda başlatır. Bu yerel çalışma için Cloudflare hesabı gerekmez. Başka terminalde:

```sh
npm test
npm run check
npm run test:cloudflare
npm run test:cloudflare:browser
```

`CLOUDFLARE_TEST_URL` farklı yerel port veya yayımlanmış HTTPS adresi seçer. `PLAYWRIGHT_ENGINE=webkit` tarayıcı testini WebKit ile çalıştırır. Chromium testinde iki ayrı masaüstü/dokunmatik tarayıcı oyuncusu aynı odaya bağlanır; mobil çizim döngüsü özellikle yavaşlatılarak ağ girdilerinin düşük FPS'den bağımsız kaldığı kontrol edilir. Ekran görüntüleri `/tmp/archer-validation` altına yazılır.

## Davranış ve ücretsiz kota

- Her online odada en çok 16 insan bulunur. Toplam katılımcı sekize botlarla tamamlanır: 1 insan + 7 bot; 6 insan + 2 bot; 8 veya daha fazla insanda bot kalmaz. Başka oda kodları ayrı dünyalara gider.
- Hızlı katıl için MATCHMAKER Durable Object sınıfı ve v2 SQLite migrasyonu vardır. Her karşılaşma formatı ayrı eşleştirme dizini ve en fazla 128 oda kullanır; 15 saniyelik tek kullanımlık yer rezervasyonu kapasite yarışını önler. Oda kapasitesi seçilen formata göre 2, 4, 8 veya 16 kişidir. Arkadaş odası dolduğunda oyuncular farklı odalara ayrılmaz.
- v3 migrasyonu, misafir profili/istatistik/kozmetik sahipliği için PROFILES (`PlayerProfile`) SQLite sınıfını ekler. Gerçek para ödemesi veya ücretli Cloudflare planı açılmaz. Online düelloda bot yoktur; diğer modlar kapasite elverdiğince sekiz katılımcıya tamamlanır. [Güncel maç ve koleksiyon kuralları](team-progression-release.md).
- Hareket, hasar, oklar, hedef seçimi, XP, seçim koruması ve buff'lar sunucuda hesaplanır. İstemci tahmini ve uzak oyuncu interpolasyonu iki ağ adaptöründe ortaktır.
- Fizik ve yerel tahmin 30 Hz, ağ durum yayını 15 Hz'dir. İki sıralı kontrol karesi bir ikili pakette gönderilir; normal akış yaklaşık 15 mesaj/sn ve 10 saniyede bir ping'dir. Kritik basma/bırakma ve durma hemen gönderilir. Olaylar birleştirilir; atış/isabet sesleri ve efektler kaybolmaz. Eski JSON istemcileri desteklenir.
- Değişen oyuncu alanları ve eklenen/toplanan XP nesneleri delta olarak taşınır. Yakın alan kamera/ekran dönüşünü kapsar; nadir XP ve güç noktalarının minimap bilgisi korunur. Genel sıralama özeti konum içermez. [Paket tasarımı ve örnek ölçümler](network-design.md).
- Girdi 350 ms kesilirse hareket ve tek basımlık eylemler durur. Önceden gerilmiş yay 1,5 saniyeye kadar mevcut şarjında bekler; kesinti sırasında ek şarj kazanmaz ve kendiliğinden ateşlenmez. Yeni bırakma girdisi gelirse bir kez atar; uzun kopmada veya açık iptalde şarj silinir.
- Son insan bağlantısı kapandığında dünya ve döngü temizlenir. Başka bir oyuncu gelene kadar bot simülasyonu çalışmaz. Açık fakat katılmayan bağlantı 10 saniyede, 90 saniye girdi göndermeyen katılmış bağlantı da temizlenir. Arka plandaki tarayıcı sekmesi girdi göndermeyi durdurur. Döndüğünde bağlantı kapanmışsa yeniden katılman gerekir.
- Oyuncu durumu bellektedir. Son kişi ayrılınca veya yeni sürüm yayımlanınca oda ilerlemesi sıfırlanır; kalıcı hesap/sıralama sunulmaz. Dağıtım mevcut WebSocket bağlantılarını keser.
- Varsayılan bağlantı yalnızca kendi site origin'inden kabul edilir. Ayrı Vercel/statik frontend kullanılacaksa Worker ortamında `ALLOWED_ORIGINS` virgülle ayrılmış tam HTTPS origin'lerini içermelidir; frontend Cloudflare build'iyle ve uygun `?server=https://...&network=websocket&room=...` parametreleriyle açılır.
- Workers Free/Durable Objects Free kotaları geçerlidir. Dokümantasyondaki Durable Objects ücretsiz bütçesi günlük 100.000 hesaplanan istek ve 13.000 GB-s'dir; gelen WebSocket mesajları 20:1 sayılır. Örneğin 10 oyuncunun normal akışta yaklaşık 15,1 mesaj/sn göndermesi tek başına yaklaşık 3,68 saatte 100.000 hesaplanan isteğe ulaşır; kritik eylemler, eşleştirme, bağlantı ve diğer işlemler bu süreyi azaltır. Bu bir kapasite garantisi değildir. Giden WebSocket mesajları bu istek sayımına dahil değildir. Aktif oyun döngüsü çalışırken oda hibernation'a geçmez; boşken döngüyü durdurmak ücretsiz kotayı korur.
- Ücretsiz planda limit dolunca işlemler hata verir. SQLite sınıfı ücretsiz planda kullanılabilir; R2, Containers veya ücretli abonelik bu proje için gerekli değildir.

Güncel resmi kaynaklar: [Durable Objects ücretlendirmesi](https://developers.cloudflare.com/durable-objects/platform/pricing/), [WebSocket ve hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Workers ücretsiz planı](https://developers.cloudflare.com/workers/platform/pricing/).
