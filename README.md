# Wildbow · Archer.io

Planlama: [geliştirme taslağı ve deneysel tek el modu](docs/development-roadmap.md) · [geliştirme öncesi kararlı sürüm yedeği](docs/stable-backup.md).

[Online arenayı oyna](https://orman-arrow-archer.cangunes1995.workers.dev) · [Botlu antrenman](https://rawcdn.githack.com/artemis34/orman-arrow-archer/df3c81bc134b13837842ead2279aae4dd033318b/index.html) · [Kendi Cloudflare hesabında kur](https://deploy.workers.cloudflare.com/?url=https://github.com/artemis34/orman-arrow-archer)

Tarayıcı ve dokunmatik cihazlar için düşük poligonlu 3D okçuluk arenası. Three.js, Vite, Express ve Socket.io; Node.js 24 LTS. Ücretsiz antrenman modu hesap veya sürekli açık sunucu gerektirmez. Çevrimiçi mod gerçek sunucuya bağlanır; botları gerçek oyuncu gibi göstermez.

Cloudflare sürümü yerel WebSocket + Durable Objects kullanır ve varsayılan olarak online açılır. Aynı oda koduna katılan en çok 16 insan ve 7 bot ortak, otoriter bir dünyada oynar. Davet bağlantısı oda kodunu taşır. [Kurulum ve ücretsiz kota ayrıntıları](docs/cloudflare.md).

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

**Çok oyunculu Cloudflare sürümü:** [Cloudflare’da kur](https://deploy.workers.cloudflare.com/?url=https://github.com/artemis34/orman-arrow-archer). Statik oyun dosyaları ve Durable Objects oda sunucuları aynı Worker üzerinden sunulur; ayrı bir Node servisi gerekmez. Ücretsiz plana uygun SQLite sınıf migrasyonu yapılandırılmıştır. Son oyuncu ayrıldığında oda/bot döngüsü durur; 90 saniye girdi göndermeyen bağlantılar temizlenir. Kurulum tamamlanmadan bir `workers.dev` adresi canlı kabul edilmez. [Hesap bağlantısı, GitHub otomatik yayın ve kota bilgileri](docs/cloudflare.md).

**Hemen oynanabilir CDN sürümü:** Yukarıdaki botlu arena bağlantısı ücretsiz raw.githack CDN üzerinde yayımlanmıştır; hesap gerekmez. CDN ilk ziyarette **External Content Notice** gösterirse **Open the page** düğmesine bas; oyun bundan sonra açılır. Her main push’unda GitHub Actions üretim paketini `gh-pages` dalına gönderir ve sabit commit bağlantısının HTML/JS dosyalarını HTTPS üzerinden kontrol eder. Statik sürümde botlu antrenman çalışır; gerçek oyuncular için Cloudflare veya Node oyun sunucusu gerekir. CDN bir üçüncü taraf ücretsiz hizmetidir; hizmet sürekliliği garantisi yoktur.

**Tam çok oyunculu oyun — Render:** [Render Blueprint ile kur](https://render.com/deploy?repo=https://github.com/artemis34/orman-arrow-archer). Ücretsiz hesabında depoyu bağla; `render.yaml` içindeki Free web service planını seçerek kurulumu tamamla. Build `npm ci --include=dev && npm run build`, start `npm start`, sağlık kontrolü `/health`. Verilen HTTPS adresi hem siteyi hem Socket.io sunucusunu sunar. Menüde Çok oyunculu seç; kendi site adresi otomatik dolacaktır. Aynı adrese bağlanan oyuncular aynı arenada buluşur. Free plan boşta uyuyabilir; ilk açılış gecikebilir. Sağlayıcının güncel ücretsiz kota ve koşulları geçerlidir. Bu dosya servisi otomatik oluşturmaz ve kart/ücret gerektiren plana yükseltmez.

**Sunucusuz antrenman — GitHub Pages:** Deponun Settings → Pages bölümünde Source: **GitHub Actions** seç. `.github/workflows/ci.yml` test, build ve Pages dağıtımını içerir. Main'e push veya Actions → Run workflow sonrası adres `https://artemis34.github.io/orman-arrow-archer/` olur. Bu adres, Pages etkinleştirilip dağıtım başarıyla tamamlanmadan canlı kabul edilmez. Statik Pages Node sunucusu çalıştırmaz; botlu antrenman doğrudan çalışır. Çok oyunculu için Render sunucusunu menüde gir veya `?server=https://sunucun.onrender.com` parametresiyle link paylaş. HTTPS sayfasında HTTPS sunucu kullan.

## Kontroller ve kurallar

- WASD / ok tuşları: hareket. Fare: nişan. Sol tık basılı tut/bırak: şarjlı atış.
- Space / sağ tık / ϟ butonu: atılma, 3 saniye bekleme ve kısa ok dokunulmazlığı. E / + butonu: Orman nefesi, 25 can yenileme, 14 saniye bekleme.
- Mobil: sol joystick hareket. Arenaya veya sağ joystick’e kısa dokunuş: canı en az olan açık rakibe otomatik atış. Sağ joystick sürükleme: hafif nişan destekli yay germe, bırakınca daha hızlı ve uzağa giden ok. Nişan bittikten sonra gövde yürüyüş yönüne döner; ayaklar ve gövde salınımı hareketi izler. Altın halka otomatik hedefi gösterir. ϟ atılma.
- Tek elle oynama: alttaki ◎ OTO düğmesini aç; yalnızca sol joystick ile yürürken menzildeki açık hedeflere otomatik ateş eder. Normal hızlı atış hasarı, bekleme süresi ve hedef önceliği geçerlidir. Elle yayı germek/bırakmak her zaman önceliklidir; seçim korumasında ve pencere odağı kaybolunca atış durur. Tercih cihazda saklanır; aynı düğmeyle kapatılır.
- Normal kristal 12 XP, nadir büyük altın kristal 60 XP verir; haritada en çok beş altın kristal bulunur. Altın kristaller haritada büyük, darbeli elmaslarla işaretlenir. Toplama modundaki botlar bu ortak hedeflere öncelik verir. İsabetler XP verir. Seviye başına üç rastgele yetenekten biri: çoklu atış, delme, sekme, zehir, hareket, yay hızı, azami can.
- Ağaç, kaya, kütük ve taş kalıntıları okları keser. Çalı, 5 birimden uzaktaki rakiplerden gizler; yay germe kamuflajı bozar.
- Oyuncu 150 can ve 4 saniye doğuş kalkanıyla başlar; ilk başarılı atış kalkanı kaldırır. Doğuş noktası rakiplerden en az 10 birim uzak seçilir; uygun yer yoksa örneklenen en güvenli nokta kullanılır. Botlar 100 cana sahiptir ve %25 daha az ok hasarı verir. Ölüm sonrası 3 saniye bekleme; yeniden doğuşta yetenekler sıfırlanır, toplam skor ve elemeler korunur.
- Otomatik atış 22 birim içindeki görünür, sipersiz ve korumasız rakipler arasından mevcut canı en az olanı seçer. Canlar eşitse seçili hedefi korur; ilk seçimde yakınlık kullanılır. Hedef bilgisi sunucudan gelir. Okun hızı/menzili için %55 şarj eşdeğeri ve 0,65 saniye bekleme kullanır; yay hızı yeteneği bu beklemeyi kısaltır. Hareketli hedefe kısa öngörü uygulanır; oklar fiziksel olarak uçar ve kaçılabilir. Temel ok her şarj seviyesinde 15 hasar verir; tam şarj daha hızlı ve uzağa giden ok sağlar. Elle atışta da 0,55 saniye bekleme vardır; hızlı tıklamayla bu süre atlanamaz. Çevrimiçinde hedef seçimi ve atış sunucu tarafından doğrulanır.
- Çoklu atışın yan okları %30 hasar verir. Zehir 3 saniye sürer ve kademe başına toplam 3 ek hasar verir; süreler üst üste eklenmez. Hız yeteneği kademe başına %8, yay hızı %12; Orman kalbi +20 azami can ve 25 iyileştirme verir.
- Seviye atlayınca en fazla 3 saniye sabit ve hasara karşı korumalı kalırsın. Altın ışık, yükselen kıvılcımlar ve azalan süre halkası tüm rakiplere korumayı gösterir; bu sırada çalıda da görünürsün. Bu sırada saldırı/atılma/aktif iyileştirme yapılmaz; mevcut saldırıların iptal edilir. Bekleyen seçimleri bitirince koruma ve sabitlik hemen sona erer; süre bitince kart seçilmemiş olsa da savaş sürer. Biriken seçimler süreyi yenilemez. Kartlar altta, küçültülebilir; 1–3 tuşları da seçer.
- HUD varsayılan olarak okunabilir küçük harita, sağ üst arena menüsü, ince can/XP şeridi ve kısa açıklamalı iki yetenek butonudur (ATIL / +25 CAN). Kendi karakterinin üzerinde mini can barı, XP şeridinde sonraki seviyeye kalan XP görünür. Harita, sıralama/ses/çıkış ve oyuncu ayrıntıları dokununca açılır; başka panel açınca veya arenaya dokununca kapanır. Bekleyen kart hatırlatıcısı yalnızca kartlar küçültülmüşken görünür.
- Yeni seçenekler: Zincir ok, Buz oku, Kor patlaması, Artçı ok, Uzak avcı. [Araştırma kaynağı ve PvP denge kararları](docs/skill-design.md).
- Geçici güçler ayrı ve haritada görünen iki noktadan alınır: mavi ϟ Seri yay, 15 saniye %30 atış hızı; turuncu ↑ Avcı kudreti, 15 saniye %20 ok hasarı. Noktalar alındıktan 45 saniye sonra yeniden dolar. Tek aktif buff; süre yenileme veya üst üste katlama yoktur. Doğuş/seçim koruması sırasında alınmaz, ölümde silinir. Seri yay germe ve atış beklemesini 1,3'e böler; kudret temel oku 15→18 yapar, zehir ve alan hasarını artırmaz. Can çubuğundaki küçük simge kalan süreyi gösterir; oyuncu detaylarında açıklaması açılır. Botlar da bu ortak hedeflere yönelir.
- Ses kullanıcı etkileşiminden sonra Web Audio ile üretilir; sessiz seçimi cihazda hatırlanır. Zehir tikleri isabet sesi/titreşim üretmez; kısa sesler sınırlı sayıda çalınır ve sessize alma/odak kaybı/çıkışta temizlenir. Uyumlu cihazlarda doğrudan isabette hafif titreşim.

## Mimari

```text
client/
  main.js         Menü, HUD, uygulama yaşam döngüsü
  scene.js        Three.js sahnesi, havuzlanmış ok/EXP/efekt görselleri
  controls.js     Klavye/fare ve bağımsız pointer yakalamalı çift joystick
  transport.js    Yerel/Socket.io adaptörleri ve ortak prediction/interpolation
  websocket.js    Cloudflare yerel WebSocket adaptörü
  presentation.js Kare hızından bağımsız poz yumuşatma ve mesafeye bağlı yürüyüş
  audio.js        Web Audio sentezi
  forest.js       Birleştirilen çevre geometrileri, patikalar ve bitkiler
  hud.css         Köşelerde HUD, kompakt yetenek kartları, mobil yerleşimler
  ui.js           Joystick tutulurken de çalışan dokunmatik kart düğmeleri
  panels.js       İsteğe göre açılan ve birbirini kapatan küçük HUD panelleri
  style.css       Ana menü ve öğretici
shared/
  config.js       Kurallar, doğrulama, ortak hareket ve kozmetik tanımları
  spatial.js      Uniform grid, swept segment-circle testleri, sınırlı nesne havuzu
  aim.js          Görüş hattı, kararlı en düşük can hedefi ve hareketli hedef öngörüsü
  world.js        Otoriter simülasyon, FSM botlar, yetenekler, görünürlük
  skills.js       Sekme, buz, alan etkisi ve mesafe bonusunun sunucu hesapları
cloudflare/worker.js Durable Objects odaları, 30 Hz otorite / 15 Hz yayın
wrangler.jsonc    Cloudflare Free planı, statik dosyalar, SQLite sınıf migrasyonu
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

`npm run dev:cloudflare` gerçek yerel Cloudflare çalışma ortamını başlatır; `npm run test:cloudflare` iki oyuncu, oda yalıtımı, kapasite, payload/origin sınırları ve boş oda kapanışını doğrular. `npm run test:cloudflare:browser` masaüstü/dokunmatik iki oyuncuyu aynı odada oynatır ve yavaş mobil çizim sırasında da girdi/şarjın devam ettiğini denetler.

`npm test`: 97 senaryo; gecikme ve paket aralıkları değişirken yürüyüş, nişan sonrası gövdenin dönüşü, tek elle otomatik atışın hasar/hız dengesi ve elle atış önceliği, kamera açısına uygun joystick yönü, iptal edilen dokunuşlar, otomatik hedefleme, doğuş koruması, otorite, şarj, siper, atılma, yetenekler, gizlenme, yeniden doğuş, spatial grid ve havuz sınırları.

`npm run test:motion`: gerçek mobil Chromium'da iki parmağı aynı anda kullanır. 130–210 ms gidiş-dönüş gecikmesi, değişken paket aralıkları ve 600 ms boyunca çizim iş parçacığının durması altında joystick merkezini, hareket/nişanın bağımsızlığını, nişan ve kısa dokunuş sonrası gövdenin yürüyüşe dönmesini, parmakları farklı sırayla kaldırmayı, iptal edilen dokunuşta yanlışlıkla ok atılmamasını ve dikey/yatay kullanımı doğrular. Tek parmakla yürürken otomatik atışın hedefe isabet etmesi, joystick basılıyken modun kapanması ve odak kaybında durması da sınanır. Yerel çizim, 30 Hz girdi turları arasında da ilerler; sunucu konum düzeltmeleri yalnızca görsel olarak yumuşatılır. Fizik, hasar ve çarpışmalar sunucuda kalır.

`npm run test:interaction`: gerçek Socket.io otoritesiyle otomatik atış, erken yetenek seçimi, 568×320 yatay telefonda okunabilir kartlar, ölüm/yeniden doğuş, ses ve çıkış. Chromium'da joystick basılı kalırken ikinci parmakla yeniden doğuş/ses/çıkış doğrulanır. `PLAYWRIGHT_ENGINE=webkit npm run test:interaction` WebKit motorunda dokunmatik sayfa uyumluluğunu kontrol eder; CI her iki motoru kurup çalıştırır. Bu, fiziksel iPhone testi değildir.

`npm run test:powerups`: gerçek dokunmatik hareketle iki buff türünü toplar; oyunu durdurmadığını, sürenin bitmesini, noktaların beklemesini, can metninin okunmasını, yatay görünümü ve ölümde temizliği doğrular.

`npm run test:network`: çalışan yerel sunucuya iki Socket.io istemcisi bağlar; ortak dünya, sahte konum reddi, disconnect kontrolü.

`npm run test:audio`: gerçek tarayıcıda zehirli otomatik atış yapar; gerçek Web Audio osilatörlerini sayarak bir atış ve bir isabet sesi oluştuğunu, 3 saniyelik zehir tiklerinin yeni ses üretmediğini ve seslerin sonlandığını doğrular.

`npm run test:browser`: yerelde çalışan uygulamayı Chromium'da açar. Masaüstü ve mobil, dokunarak otomatik atış, şarj/bırakma, atılma ve online katılma. `CHROMIUM_PATH` ile mevcut Chromium yolu seçilir (varsayılan `/usr/bin/chromium`). Ekran görüntüleri `/tmp/archer-validation/` altında tutulur.

`npm run test:hud`: gerçek Socket.io otoritesiyle masaüstü, tablet, 390×844 ve 375×667 telefon, 844×390 yatay görünüm. Kalıcı HUD alanının ekranın %10’undan az olduğunu, panellerin açılıp kapanmasını, koruma sırasında sabitlik/hasarsızlığı, erken seçimi ve süre sonunda kontrolün dönmesini doğrular; koruma bitince ikinci parmakla seçim de çalışır. Geliştirme sunucusunda çalıştırmak için `PORT=3002 npm run dev`, ardından `TEST_SERVER_URL=http://127.0.0.1:3002 npm run test:hud`.

Harita seed'i sabittir. Sabit orman geometrileri malzeme bazında birleştirilir; kristaller InstancedMesh ile tek çizim çağrısında sunulur. Gelecek adımlar: sunucu tarafından oda seed'i, mesafe/ilgi alanına göre snapshot delta sıkıştırma, daha gelişmiş bot yol bulma, takım/BR modları ve erişilebilir oyun seçenekleri.

## Sağlamlık ve yayın kontrolleri

Girdi paketleri aynı sunucu turunda birikse de atılma ve can yenileme basışları kaybolmaz. Sunucu ve istemci hareket tahmini/bekleyen girdi tekrarı aynı hareket fonksiyonunu kullanır. Yeniden doğuş konumlarına interpolasyon uygulanmaz. WebSocket engelliyse Socket.io HTTP polling’e dönebilir; ücretsiz sunucunun uyanması için bağlantıya zaman tanınır.

Ölüm, can, seçim koruması ve görünürlük en son sunucu verisinden gösterilir; yalnızca konum ve dönüşler yumuşatılır. Böylece eski bir ağ karesi korumayı sürüyor gibi göstermez. Kalabalıkta itişmelerden sonra hız ve ok çarpışma grid'i son konumlara göre hesaplanır. Yeniden doğuş, ses ve çıkış düğmeleri joystick tutulurken de çalışır. Dar yatay telefonlarda yetenek açıklamaları üst orta şeride geçerek karakteri ve alt kontrolleri açık bırakır. Geliştirme sunucusunun canlı yenileme bağlantısı uygulamanın kendi HTTP portunu kullanır.

Zehirle ölen oyuncu aynı turda XP toplayamaz. Gizlenen oyuncuların konumları hasar olaylarıyla da uzak istemcilere gönderilmez. Depolama veya Web Audio erişimi olmayan tarayıcılarda oyun, bu isteğe bağlı özellikler olmadan açılır. Mobil odak kaybı joystick yakalamasını temizler; yatay görünümde menü ve HUD ayrı yerleşim kullanır.

CI artık üretim sunucusunu başlatır, iki istemcili ağ testini, masaüstü/mobil Chromium testlerini ve beş görünümde HUD/kart testini çalıştırır. Yayından sonra `LIVE_SITE_URL=<yayımlanan-adres> npm run test:live` ile gerçek CDN sayfasında masaüstü ve mobil katılma, yayı germe/bırakma, WebGL ve varlık yüklemeleri doğrulanır. Sonuç ekran görüntüleri Actions artefaktlarında saklanır. Yalnızca Markdown değişiklikleri yeniden dağıtımı tetiklemez.
