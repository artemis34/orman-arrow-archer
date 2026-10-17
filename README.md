# Wildbow · Archer.io

[Ücretsiz botlu arenayı oyna](https://rawcdn.githack.com/artemis34/orman-arrow-archer/799b364f165e3b401801b643c69517be9ba9270a/index.html) · [Çok oyunculu sunucuyu Render’da kur](https://render.com/deploy?repo=https://github.com/artemis34/orman-arrow-archer)

Tarayıcı ve dokunmatik cihazlar için düşük poligonlu 3D okçuluk arenası. Three.js, Vite, Express ve Socket.io; Node.js 24 LTS. Ücretsiz antrenman modu hesap veya sürekli açık sunucu gerektirmez. Çevrimiçi mod gerçek sunucuya bağlanır; botları gerçek oyuncu gibi göstermez.

## Çalıştırma

```sh
npm ci
npm run dev
# http://localhost:3000
```

```sh
npm test
npm run build
npm start
```

`PORT` varsayılan 3000. İsteğe bağlı `ALLOWED_ORIGINS=https://site.example,https://diger.example` çevrimiçi istemci origin listesini sınırlar; varsayılan açık CORS, genel arena içindir. Uygulama veri tabanı, API anahtarı veya ücretli servis istemez. Oyuncu bilgileri bellektedir; sunucu yeniden başlarsa sıfırlanır.

## Ücretsiz yayın

**Hemen oynanabilir CDN sürümü:** Yukarıdaki botlu arena bağlantısı ücretsiz raw.githack CDN üzerinde yayımlanmıştır; hesap gerekmez. CDN ilk ziyarette **External Content Notice** gösterirse **Open the page** düğmesine bas; oyun bundan sonra açılır. Her main push’unda GitHub Actions üretim paketini `gh-pages` dalına gönderir ve sabit commit bağlantısının HTML/JS dosyalarını HTTPS üzerinden kontrol eder. Statik sürümde botlu antrenman çalışır; gerçek oyuncular için Socket.io sunucusu gerekir. CDN bir üçüncü taraf ücretsiz hizmetidir; hizmet sürekliliği garantisi yoktur.

**Tam çok oyunculu oyun — Render:** [Render Blueprint ile kur](https://render.com/deploy?repo=https://github.com/artemis34/orman-arrow-archer). Ücretsiz hesabında depoyu bağla; `render.yaml` içindeki Free web service planını seçerek kurulumu tamamla. Build `npm ci --include=dev && npm run build`, start `npm start`, sağlık kontrolü `/health`. Verilen HTTPS adresi hem siteyi hem Socket.io sunucusunu sunar. Menüde Çok oyunculu seç; kendi site adresi otomatik dolacaktır. Aynı adrese bağlanan oyuncular aynı arenada buluşur. Free plan boşta uyuyabilir; ilk açılış gecikebilir. Sağlayıcının güncel ücretsiz kota ve koşulları geçerlidir. Bu dosya servisi otomatik oluşturmaz ve kart/ücret gerektiren plana yükseltmez.

**Sunucusuz antrenman — GitHub Pages:** Deponun Settings → Pages bölümünde Source: **GitHub Actions** seç. `.github/workflows/ci.yml` test, build ve Pages dağıtımını içerir. Main'e push veya Actions → Run workflow sonrası adres `https://artemis34.github.io/orman-arrow-archer/` olur. Bu adres, Pages etkinleştirilip dağıtım başarıyla tamamlanmadan canlı kabul edilmez. Statik Pages Node sunucusu çalıştırmaz; botlu antrenman doğrudan çalışır. Çok oyunculu için Render sunucusunu menüde gir veya `?server=https://sunucun.onrender.com` parametresiyle link paylaş. HTTPS sayfasında HTTPS sunucu kullan.

## Kontroller ve kurallar

- WASD / ok tuşları: hareket. Fare: nişan. Sol tık basılı tut/bırak: şarjlı atış.
- Space / sağ tık / ϟ butonu: atılma, 3 saniye bekleme ve kısa ok dokunulmazlığı. E / + butonu: Orman nefesi, 25 can yenileme, 14 saniye bekleme.
- Mobil: sol joystick hareket. Arenaya veya sağ joystick’e kısa dokunuş: en yakın açık rakibe otomatik atış. Sağ joystick sürükleme: hafif nişan destekli yay germe, bırakınca güçlü atış. Altın halka otomatik hedefi gösterir. ϟ atılma.
- Kristaller ve isabetler XP verir. Seviye başına üç rastgele yetenekten biri: çoklu atış, delme, sekme, zehir, hareket, yay hızı, azami can.
- Ağaç ve kaya siperleri okları keser. Çalı, 5 birimden uzaktaki rakiplerden gizler; yay germe kamuflajı bozar.
- Oyuncu 150 can ve 4 saniye doğuş kalkanıyla başlar; ilk başarılı atış kalkanı kaldırır. Doğuş noktası rakiplerden en az 10 birim uzak seçilir; uygun yer yoksa örneklenen en güvenli nokta kullanılır. Botlar 100 cana sahiptir ve %25 daha az ok hasarı verir. Ölüm sonrası 3 saniye bekleme; yeniden doğuşta yetenekler sıfırlanır, toplam skor ve elemeler korunur.
- Otomatik atış 22 birim içindeki görünür, sipersiz ve doğuş koruması olmayan en yakın rakibi seçer. %55 şarj gücü ve 0,65 saniye bekleme kullanır; yay hızı yeteneği bu beklemeyi kısaltır. Hareketli hedefe kısa öngörü uygulanır; oklar fiziksel olarak uçar ve kaçılabilir. Tam şarjlı elle atış daha güçlüdür. Çevrimiçinde hedef seçimi ve atış sunucu tarafından doğrulanır.
- Ses kullanıcı etkileşiminden sonra Web Audio ile üretilir; sessiz seçimi cihazda hatırlanır. Uyumlu cihazlarda isabette hafif titreşim.

## Mimari

```text
client/
  main.js         Menü, HUD, uygulama yaşam döngüsü
  scene.js        Three.js sahnesi, havuzlanmış ok/EXP/efekt görselleri
  controls.js     Klavye/fare ve bağımsız pointer yakalamalı çift joystick
  transport.js    Yerel antrenman / Socket.io adaptörleri, prediction & interpolation
  presentation.js Kare hızından bağımsız poz yumuşatma ve mesafeye bağlı yürüyüş
  audio.js        Web Audio sentezi
  style.css       Masaüstü ve mobil arayüz
shared/
  config.js       Kurallar, doğrulama, ortak hareket ve kozmetik tanımları
  spatial.js      Uniform grid, swept segment-circle testleri, sınırlı nesne havuzu
  aim.js          Görüş hattı, en yakın hedef ve hareketli hedef öngörüsü
  world.js        Otoriter simülasyon, FSM botlar, yetenekler, görünürlük
server/index.js   Express, Socket.io, 30 Hz döngü, bağlantı/mesaj sınırları
public/           Statik varlıklar
 tests/           Simülasyon, ağ ve Chromium testleri
render.yaml       Tek servis ücretsiz sunucu dağıtım tanımı
```

### Ağ ve güvenlik sınırları

Çevrimiçi istemci yalnızca normalize edilen hareket/nişan/tuş girdisi ve yetenek isteği yollar. Konum, hasar, şarj, öldürme, XP ve beklemeler sunucuda hesaplanır. İstemci hareket tahmini son onaylanan sequence'e geri uzlaştırılır; uzak aktörler 90 ms tamponla lineer interpolasyon kullanır. Gizlenen oyuncular uzak istemcilerin snapshot'larından çıkarılır. Kontroller ve sunucu payload/mesaj oranı sınırlıdır; en çok 16 insan + 7 bot, tek arena. Dünya içinde ok/EXP sayısı ve havuzları sınırlıdır. Arrow swept testleri hızlı okların hedeflerin içinden atlamasını engeller. Hareket her eksende sınırlandırılır, diagonal hız normalize edilir.

Antrenmanda aynı World kodu tarayıcıda çalışır; bu mod çevrimiçi anti-cheat garantisi taşımaz. Bu sürümde sunucu geçmişine geri sarılan hitbox lag compensation, yatay sunucu ölçekleme, kalıcı hesaplar veya sıralama veritabanı yoktur. İnternet ölçeğinde üretim için kimlik, gözlemleme, DDoS koruması ve oda yönlendirme gerekir.

### Genişletme noktaları

`LocalTransport` ve `SocketTransport` aynı `connect/step/choose/respawn/close` sözleşmesini kullanır. Yeni binary taşıma adaptörü render kodundan bağımsız eklenebilir. Botların gather/fight durumu World'de yalıtılmıştır. `shared/cosmetics.json` içindeki `SKINS` veri tablosu render modelinin renk/pelerin seçimlerini belirler. `shared/modes.js` FFA/TDM/BR kural sözleşmesini tanımlar; çalışan oyun modu FFA'dır. Takımlar ve daralan çember ileride bu sözleşmeye eklenebilir, bu sürümde oynanabilir mod değildir.

## Doğrulama

`npm test`: 33 senaryo; kesintisiz yürüyüş, otomatik hedefleme, doğuş koruması, otorite, şarj, siper, atılma, yetenekler, gizlenme, yeniden doğuş, spatial grid ve havuz sınırları.

`npm run test:network`: çalışan yerel sunucuya iki Socket.io istemcisi bağlar; ortak dünya, sahte konum reddi, disconnect kontrolü.

`npm run test:browser`: yerelde çalışan uygulamayı Chromium'da açar. Masaüstü ve mobil, dokunarak otomatik atış, şarj/bırakma, atılma ve online katılma. `CHROMIUM_PATH` ile mevcut Chromium yolu seçilir (varsayılan `/usr/bin/chromium`). Ekran görüntüleri `/tmp/archer-validation/` altında tutulur.

Harita seed'i sabittir. Sabit orman geometrileri malzeme bazında birleştirilir; kristaller InstancedMesh ile tek çizim çağrısında sunulur. Gelecek adımlar: sunucu tarafından oda seed'i, mesafe/ilgi alanına göre snapshot delta sıkıştırma, daha gelişmiş bot yol bulma, takım/BR modları ve erişilebilir oyun seçenekleri.

## Sağlamlık ve yayın kontrolleri

Girdi paketleri aynı sunucu turunda birikse de atılma ve can yenileme basışları kaybolmaz. Sunucu ve istemci hareket tahmini/bekleyen girdi tekrarı aynı hareket fonksiyonunu kullanır. Yeniden doğuş konumlarına interpolasyon uygulanmaz. WebSocket engelliyse Socket.io HTTP polling’e dönebilir; ücretsiz sunucunun uyanması için bağlantıya zaman tanınır.

Zehirle ölen oyuncu aynı turda XP toplayamaz. Gizlenen oyuncuların konumları hasar olaylarıyla da uzak istemcilere gönderilmez. Depolama veya Web Audio erişimi olmayan tarayıcılarda oyun, bu isteğe bağlı özellikler olmadan açılır. Mobil odak kaybı joystick yakalamasını temizler; yatay görünümde menü ve HUD ayrı yerleşim kullanır.

CI artık üretim sunucusunu başlatır, iki istemcili ağ testini ve masaüstü/mobil Chromium testlerini çalıştırır. Yayından sonra `LIVE_SITE_URL=<yayımlanan-adres> npm run test:live` ile gerçek CDN sayfasında masaüstü ve mobil katılma, yayı germe/bırakma, WebGL ve varlık yüklemeleri doğrulanır. Sonuç ekran görüntüleri Actions artefaktlarında saklanır. Yalnızca Markdown değişiklikleri yeniden dağıtımı tetiklemez.
