# Akıcılık incelemesi — 23 Kasım 2026

Amaç: oyunun ana fikri olan **akıcılık ve basit eğlenceyi** bozan noktaları bulmak, düzeltmek ve iOS/Android mağaza sürümüne giden yolu temiz tutmak.

Bu değişikliklerden önceki son sürüm `f3a411ae42e49f6afcb603ec15aabda67d4c75a1` (main). Değişiklikler ayrı bir dalda yapıldı; main olduğu gibi duruyor.

## Bulunan sorunlar ve yapılan değişiklikler

| #   | Sorun                                                                                                                     | Etkisi                                                                                                | Değişiklik                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Seviye atlayınca oyuncu 5 saniyeye kadar **donuyor**, hasar almıyor/veremiyor; havadaki okları ve zehri iptal ediliyordu. | Kavganın ortasında oyun duruyordu. Öldürme → XP → seviye → donma döngüsü, en heyecanlı anı kesiyordu. | Donma ve koruma kaldırıldı. Yürüme, atış, atılma sürer; seviye başına 18 can yenilenmesi korunur.                                      |
| 2   | Tek el modunda seviye atlayınca **joystick kart seçiciye dönüşüyordu** (sola/yukarı/sağa çek, 5 sn bekle).                | Seviye atlayan parmak yürümeyi bırakmak zorundaydı; ~200 satır karmaşık hareket kodu.                 | Joystick hep yürür. Kartlar dokunarak (bilgisayarda 1/2/3) seçilir. Kod ve testleri sadeleştirildi.                                    |
| 3   | Kart paneli ekranın ortasını, karakterin hemen üstünü kaplıyordu.                                                         | Tehlike görülemiyordu.                                                                                | Kartlar üstte, haritanın altında küçük bir şerit; açıklama metni erişilebilirlik etiketinde.                                           |
| 4   | Seçilmeyen kart sonsuza dek bekliyordu (küçült/hatırlatıcı düğmeleri).                                                    | Ekstra düğmeler, ekstra karar.                                                                        | Şeritteki çubuk 8 sn'de biter; seçim yoksa sunucu ilk kartı seçer (`RULES.upgradeAutoPick`). Küçült/hatırlatıcı kaldırıldı.            |
| 5   | Çizim "60 FPS son tarihi" ile sınırlanıyordu.                                                                             | 90 Hz ve 144 Hz telefonlarda kareler bir 1, bir 2 yenileme ekranda kalıyor → yürürken **takılma**.    | Ekran yenileme hızı ölçülüp her N'inci yenilemede çizilir: 60/75/90 Hz her kare, 120/144 Hz iki karede bir. Kareler hep eşit aralıklı. |
| 6   | Uzun ağaçların altında oyuncu tamamen kayboluyordu (masaüstü denemesinde görüldü).                                        | Oyuncu nerede olduğunu kaybediyordu.                                                                  | Ayak altında derinlik testsiz açık yeşil halka: ağacın altında da görünür.                                                             |
| 7   | Ölünce sayaç bitince ayrıca "Yeniden doğ"a basmak gerekiyordu.                                                            | Gereksiz dokunuş.                                                                                     | Sayaç bitince otomatik yeniden doğulur; "Ana menüye dön" sayaç sırasında kullanılabilir.                                               |
| 8   | Servis çalışanı kaydı, kısıtlı çerçevelerde ve uygulama WebView'larında senkron hata atabiliyordu.                        | Gelecekteki iOS/Android kabuğunda gereksiz hata.                                                      | Kayıt `try/catch` içinde; oyun önbelleksiz de açılır.                                                                                  |
| 9   | CI, artık var olmayan 17 özellik dalını dinliyordu.                                                                       | Bakım yükü.                                                                                           | `main` ve `claude/**` dalları.                                                                                                         |

Seviye atlayınca sahibine "✧ SEVİYE N · Kart seç" bildirimi, herkese karakterin üstünde "SEVİYE N" yazısı ve altın kıvılcım gösterilir.

### Protokol uyumluluğu

`levelGuard` alanı anlık görüntülerde kalır ve artık hep `0`'dır; istemcideki koruma görselleri ve dalları kaldırıldı. v2 protokolü ve Swift sözleşmesi değişmedi (`protocol-conformance` testleri aynen geçer). Simülasyon izleri bilerek değiştiği için yeni bir fikstür kaydedildi: `tests/fixtures/level-flow-traces-2026-11-23.json`. Eski fikstürler korunur.

## Doğrulama

- `npm test`: 1. turda 373, 2. turda 383 test geçti. `npm run check` (TypeScript) temiz.
- Tarayıcıda (Chromium, yazılımsal GPU): `test:browser`, `test:one-finger`, `gameplay-modes` (10 mod tek el + 3 mod masaüstü), `test:hud` (5 görünüm) geçti.
- `test:hud` içindeki "hayalet tıklama" kontrolü (harita düğmesine sahte fare tıklaması) bu ortamda dokunmatik görünümlerde **değişiklik öncesi sürümde de** başarısız oluyor; yazılımsal GPU'nun yavaşlığıyla 700 ms penceresinin aşılmasından kaynaklanıyor. CI'nin Playwright imajında ayrıca izlenmeli.
- Telefon boyutunda (390×664) gerçek dokunma ile oynandı: kartlar açıkken aynı parmakla yürüme sürdü, karta dokununca seçildi, 8 sn sonunda otomatik seçim oldu.

## 2. tur — takılma, performans ve ping

| #   | Sorun                                                                                                                                                                                                                                                                                            | Değişiklik                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | Çevrimiçi modda kendi karakterin, 30 Hz `setInterval` zamanlayıcısının _çalıştığı ana_ göre çiziliyordu. Ana iş parçacığı meşgulken zamanlayıcı birkaç ms geciktikçe kare başı hız dalgalanıyordu. Simülasyonda: hız sapması **%30**, 540 karenin **29'unda** yarı hızın altına düşme (takılma). | Girdi tikleri sabit bir zaman çizelgesinde; her kare (ve yedek zamanlayıcı) vadesi gelen tikleri _planlanan_ zaman damgasıyla gönderir. Aynı simülasyonda sapma **%0**, takılan kare **0** (`tests/input-clock.test.js`).                                                                                                 |
| 11  | Sunucu (Cloudflare Durable Object) girdileri her tikte birer birer işler. Ağ duraksamasından sonra gelen 4–6 girdilik yığın kuyrukta kalıyor ve **kalıcı ~130–200 ms ek gecikmeye** dönüşüyordu; kuyruk kendiliğinden boşalmıyordu.                                                              | Kuyruk 1 saniyelik pencerede hiç 2'nin altına inmiyorsa fazlası atlanır (atılma/iyileşme/atış basışları korunur). Kısa dalgalanmalara dokunulmaz (`takeQueuedInput`, `tests/regressions.test.js`).                                                                                                                        |
| 12  | Zayıf GPU'lu telefonlar "Dengeli" ayarda 60 FPS tutamasa da çözünürlük/gölge aynı kalıyordu.                                                                                                                                                                                                     | **Otomatik kalite:** İki ardışık 1,5 saniyelik ölçümde karelerin dörtte biri hedefin 1,4 katından uzun sürerse (~43 FPS altı) önce çözünürlük 1,5→1,2'ye, sonra 1,0'a iner ve gölgeler kapanır. Ulaşılan seviye cihazda hatırlanır; elle kalite seçmek sıfırlar. iOS pil tasarrufundaki 30 FPS sınırı yavaş GPU sanılmaz. |
| 13  | Artık hiç tetiklenmeyen seviye koruması için her oyuncuda 8 görünmez 3B nesne (halka + 6 kıvılcım) her karede sahne ağacında geziliyordu; HUD ve kontrollerde ölü dallar vardı.                                                                                                                  | Kaldırıldı (32 kişilik BR'de 256 nesne daha az). Seviye atlama efekti ve "SEVİYE N" yazısı tek yerde kaldı.                                                                                                                                                                                                               |

### Ping: ölçülen durum ve öneriler

Telefon ölçümü (26 Ekim): Wi‑Fi'da 150–200 ms, mobil veride 511 ms'ye kadar. Bunun büyük kısmı **ağ yolu**dur (telefon → Cloudflare girişi → Doğu Avrupa'daki oda sunucusu); kodla ortadan kaldırılamaz. Kodun üstüne eklediği kısım: 30 Hz tik (ort. ~16 ms), 15 Hz durum yayını (ort. ~33 ms) ve rakiplerin akıcı görünmesi için 125 ms görüntü tamponu. Bu turda kaldırılan: kuyruk birikmesinden gelen 130–200 ms'lik kalıcı ek gecikme.

Öneriler (öncelik sırasıyla):

1. **Önce ölç:** Ayarlar → _Bağlantıyı test et_ ile aynı telefondan Wi‑Fi ve mobil veriyi karşılaştır. "Giriş" (Cloudflare'a ilk adım) zaten yüksekse sorun operatör/yol tarafındadır, oyun kodunda değildir.
2. **Küçük odalarda 30 Hz yayın:** 8 ve daha az oyunculu odalarda durum yayınını 30 Hz'e çıkarıp görüntü tamponunu ~75 ms'ye indirmek rakipleri ve okları ~50 ms daha güncel gösterir. Maliyet: arena modunda oyuncu başına ~6 → ~11 KB/s veri. 32 kişilik BR'de bu ~45 KB/s eder, orada önerilmez. İstersen bunu bir sonraki adımda yapabilirim.
3. **Türkiye'ye yakın sabit sunucu:** Durable Object'ler her şehirde çalışmaz; oyuncuların çoğu Türkiye'deyse İstanbul veya Frankfurt'ta bir VPS'te çalışan sunucu en büyük kazancı sağlar (Türkiye içinden İstanbul'a genellikle 10–30 ms, Frankfurt'a 40–60 ms). Depodaki Node/Socket.IO sunucusu bunun temeli olabilir, ama profil, sıralama ve v2 ikili protokol Cloudflare sürümündeki gibi ona taşınmalıdır. Bu, mağaza öncesi büyük bir iş; ayrı planlanmalı.
4. **Atışta anında his (klasik kontrol için):** Elle atışta okun sunucudan dönmesi beklenmeden yerelde gösterilmesi. Tek el / otomatik atışta etkisi az olduğu için şimdilik yapılmadı.

## Codex kodu hakkında notlar (bu turda değiştirilmedi)

- **CSS dağınık:** 12 stil dosyası aynı öğeleri farklı medya sorgularıyla tekrar tekrar eziyor (`hud.css`, `compact-ui.css`, `lobby.css`, `one-finger.css`…). Yeni kart şeridi bu yüzden en son yüklenen tek bir dosyada (`client/flow.css`). Mağaza sürümünden önce HUD stilleri tek dosyada birleştirilmeli.
- **`client/main.js` ~1400 satır:** lobi, HUD, olaylar, harita çizimi ve ağ akışı tek dosyada. HUD ve küçük harita ayrı modüllere bölünebilir.
- **Mod sayısı:** Lobide 10 karşılaşma biçimi var. "Basit eğlence" için ilk açılışta 3 seçenek (Serbest arena, Düello, Battle Royale) ve geri kalanların "Diğer modlar" altında olması önerilir. Bu bir ürün kararı olduğu için dokunulmadı.
- **README** zamanla bir değişiklik günlüğüne dönüştü; ilk paragraf sadeleştirildi, geri kalanı korunuyor.
- **Testler** çok kapsamlı ama bazı tarayıcı testleri zamanlamaya duyarlı. Seviye kartı testleri artık otomatik seçim süresinden bağımsız (`offerAt = Infinity` ile).

## iOS / Android için hazırlık (geliştirme bittikten sonra)

Önerilen yol: mevcut Vite derlemesini **Capacitor** kabuğuna koymak. Oyun zaten dokunmatik öncelikli, güvenli alanları (`env(safe-area-inset-*)`) kullanıyor ve antrenman modu sunucusuz çalışıyor.

1. `npx cap init` + `ios`/`android` platformları; `dist` doğrudan uygulamaya gömülür (servis çalışanı gerekmez, kayıt artık hata vermez).
2. Online mod Cloudflare Worker adresine bağlanır (`?network=websocket` davranışı uygulama içinde varsayılan yapılmalı).
3. Titreşim için `@capacitor/haptics`, ekranın kapanmaması için keep-awake eklentisi.
4. App Store kuralları: hesap varsa uygulama içinden hesap silme, gizlilik politikası; Google ile giriş sunulursa "Sign in with Apple" zorunlu; kozmetik satılacaksa uygulama içi satın alma.
5. Performans: Ayarlar'daki "düşük" kalite eski telefonlar için hazır; ilk açılışta cihaz gücüne göre otomatik seçilmesi önerilir.

## Nasıl denenir

- Hızlı deneme (botlarla antrenman): Claude üzerinde yayımlanan tek dosyalık test sayfası.
- Tam çok oyunculu: dal `main`'e birleştirildiğinde Cloudflare bağlantısı canlı siteyi (`orman-arrow-archer.cangunes1995.workers.dev`) otomatik günceller.
- Geri dönmek için: `git switch -c eski-surum f3a411ae42e49f6afcb603ec15aabda67d4c75a1`.
