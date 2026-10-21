# Orman ilerlemesi, ranked ve arkadaşlar

Başlangıç: `48605fa64d6283dd275715b913e6c0288a38ecd2`. GitHub yedeği `backup-before-social-ranked-2026-10-21`; doğrulanan tam geçmiş `/workspace/backups/wildbow-before-social-ranked-2026-10-21.bundle`. Geliştirme dalı `feature/forest-ranked-social`; yayın hedefi mevcut Cloudflare adresidir.

## Savaş

- Öldürme: seviye efektinden farklı turuncu parçacık/altıgen halka ve öldürenin üstünde kısa **Kill** yazısı.
- Her oyuncunun doğrudan ok isabetinde %5 kritik şansı, tam %10 ek hasarı vardır: temel insan oku 15 → 16,5. Kırmızı **HeadShot** kritik geri bildirimidir; yeni bir kafa çarpışma alanı değildir. Zehir/patlama kritik üretmez. Kritik rastgeleliği harita rastgeleliğinden ayrıdır ve sunucudadır.
- Seviye efektinde **SEVİYE N** gösterilir. Mevcut koruma ve kart seçince hemen devam etme davranışı korunur.
- **Can emen ok**: gerçek doğrudan hasarın %5'i kadar iyileşme; vuruş başına en fazla 1,5 ve bir saniyede en fazla 3 can. Zehir, patlama, kalkan ve fazla hasarla iyileşme çoğaltılamaz. Ölü saldırgan dirilmez. Tek kez seçilebilir.
- Mevcut **Zincir ok**, 6 birim içindeki görünür rakibe siperden geçmeden %40 hasarla bir kez seker; tekrar eklenmedi. Duvarlardan seken ayrı **Sekme** de korunur.

24 DOM yazısı ve 4 halka havuzlanır. Aynı tür yazılar birleştirilir, farklı türler baş üstünde sıralanır; olay başına texture/geometry üretilmez. Ok akıcılığı, hareket, grafik kalite ayarları ve otoriter çarpışma fiziği korunur.

## Paraşüt ikmali

Mevcut harita ve küçük/nadir XP havuzları değiştirilmez. En fazla 3 etkin kutu vardır. İlk kutu 45. saniyeden sonra duyurulur, 6 saniyede iner ve yerde 45 saniye kalır. Mini haritada havadayken ok, yerdeyken kutu simgesi vardır. İnişten önce alınamaz. Canlı, doğuş/seviye kalkanı olmayan en yakın oyuncu 1,25 birim içindeyken alır; kutu bir kez tüketilir. Bir sonraki seviyeye eksik XP verilerek tam bir seviye kazandırır; mevcut kart/iyileşme/koruma kuralları uygulanır.

Temel aralık `clamp(90 / (sqrt(insan + 0.25 × bot) × haritaBoyutu/84), 25, 120)` saniye, ardından ±%15 zaman farkıdır. Varsayılan haritada 1 insan + 7 bot yaklaşık 54 sn, 8 insan 32 sn, 16 insan 25 sn temel aralıktadır. Dokuz bölge dönüşümlü kullanılır; siper/kutu yakınları elenir ve oyuncuların hemen üstüne düşmekten kaçınılır. Ayrı rastgelelik kaynağı mevcut XP dağılımını bozmaz. Düello ve ranked'de rastgele ikmal/XP/kart yoktur.

## Ranked, ünvanlar ve kayıt

Ranked ilk sürümde **botsuz 1v1 orman düellosudur**. Eşleştirme bileti ve iki farklı sunucu profili gerekir; aynı profil iki koltuğu alamaz. Misafir profil çalışır; Google/Apple zorunlu değildir. Her tur 1. seviye, 150 can ve boş geliştirmeyle başlar. Kozmetikler güç vermez. Normal arena ve takım formatları korunur.

Herkes eski elemesinden bağımsız **0 RP / Tohum** ile başlar. Kazanma +25, yenilgi −10, beraberlik +5 RP; puan sıfırın altına inmez. Sonucu yalnız sunucu yazar, tur makbuzu bir kez işlenir. İlk 10 saniye bağlantı toleransıdır; ardından ayrılmak hükmen yenilgi ve rakibe galibiyet getirir. Bu, farklı misafir anahtarları açılmasını veya anlaşmalı oyuncuları tamamen engelleyen bir kimlik sistemi değildir.

| Rütbe | RP | Ünvan | Toplam online eleme |
| --- | ---: | --- | ---: |
| Tohum | 0 | Çırak | 0 |
| Filiz | 100 | İzci | 10 |
| Fidan | 250 | Avcı | 50 |
| Genç Ağaç | 500 | Nişancı | 150 |
| Meşe | 900 | Usta Nişancı | 400 |
| Ulu Çınar | 1400 | Şahin Gözü | 1000 |
| Kadim Orman | 2200 | Başokçu | 2500 |
| Dünya Ağacı | 3200 | Efsane Okçu | 5000 |

Ünvan ve ranked bağımsızdır. Online serbest arenadaki elemeler sayılır; antrenman sayılmaz. Aktivite yaklaşık 60 saniyede, maç sonunda veya çıkışta toplu yazılır. Kayıp onayda aynı makbuz tekrar kullanılır. Ani oda/dağıtım kapanmasında henüz yazılmamış son pencere garanti edilmez. Tamamlanmış maç ödülleri mevcut makbuz sistemiyle verilir.

## Arkadaşlar ve sıralama

Okçum panelinde Arkadaşlar, Sıralama ve profil/rütbe alanları vardır. Her profilin paylaşılabilir 12 karakterlik arkadaş kodu bulunur. İstek karşı taraf onaylayana kadar arkadaşlık oluşmaz. Liste 50 arkadaş, gelen/giden kutuları 20 istekle sınırlıdır. Onay, reddetme, iptal, çıkarma ve elle paylaşılabilen oda daveti vardır; otomatik dış mesaj yoktur. Kurtarma anahtarı ve özel profil kimliği paylaşılmaz.

Genel sıralama en fazla 50 kayıt gösterir: ranked puanı ve toplam online eleme ayrı sekmelerdir. Yalnız sunucu profili kayıt yayımlar; tarayıcı skor/RP/ödül yazamaz. Profil ve arkadaş grafiği kalıcı SQLite Durable Object saklamasındadır.

## Joystick

Klasikte ekranın sol/sağ bölgeleri hareket/nişandır; solak ayarı tersine çevirir. Dokunulan nokta merkez olur, sürükleme hareket/germe başlatır, bırakma nötrler. Sabit daireler başlangıç ipucudur. Tek elde boş oyun alanında dokunma hareket merkezini belirler; düşmana kısa dokunmayla kilit korunur. UI/harita joystick başlatmaz. İki parmak, iptal, odak kaybı, ekran yönü ve oto atış ayrıca test edilir.

## Google ve Apple altyapısı

Butonlar ve sunucu akışları hazırdır; anahtar yokken pasiftir, giriş taklit edilmez. Gerçek sağlayıcı hesabı/anahtarı oluşturulmaz veya istenmez. Sonradan **Cloudflare Worker runtime** değişkenleri tanımlanır; `VITE_` veya Git içine konmaz:

| Sağlayıcı | Değişkenler | Geri dönüş URL'si |
| --- | --- | --- |
| Google Web OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://orman-arrow-archer.cangunes1995.workers.dev/api/auth/google/callback` |
| Apple Web Services ID | `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` | `https://orman-arrow-archer.cangunes1995.workers.dev/api/auth/apple/callback` |

Apple secret, Apple'ın süreli ve imzalı client-secret JWT'sidir; süresi dolunca yenilenir. Sağlayıcı uygulaması/alan adı/izin ayarları ilgili hesaplarda tamamlanmalıdır. Anahtarın varlığı gerçek girişin doğrulandığı anlamına gelmez.

Tek kullanımlık 10 dakikalık state, HttpOnly cookie, nonce, Google PKCE, sabit issuer/audience/RS256 ve JWKS imza doğrulaması kullanılır. Apple form-post desteklenir. Tokenlar tarayıcı URL'sine döndürülmez. Sağlayıcı subject özeti mevcut misafir profilinin kanonik kimliğine bağlanır; başka cihazda aynı sağlayıcıyla giriş o profili kullanır. İstemciden puan/hesap birleştiren uç yoktur. Güvenlik kontrolleri yerel imzalı tokenlarla test edilir; gerçek Google/Apple akışı anahtarlar bağlandıktan sonra ayrıca denenmelidir. Süresi dolan state kayıtlarını alarm temizler.

## Altyapı

Wrangler v1/v2/v3 korunur; v4 `CommunityHub` ve `COMMUNITY` binding'ini ekler. Ücretli plan etkinleştirilmez. Profil, topluluk ve aktivite istekleri mevcut Free günlük kotalarına ek kullanım getirir; sınırsız ücretsiz kapasite iddiası yoktur. Kod geri alınırken Durable Object sınıf/migrasyon geçmişi silinmemelidir.

Fizik 30 Hz, yayın 15 Hz ve input paketleme korunur. V2 tuple sırası ve altın paketler aynıdır. Ek metadata isteğe bağlıdır: `objective.drops`, `hit.critical`, `kill.owner/x/z`, `leech` ve ikmal olayları. Gizli hedefin öldürme koordinatları izleyiciden saklanır. Güncel web ve gelecekteki Swift aynı WSS sözleşmesini kullanabilir; bilinmeyen alanlar yok sayılmalıdır. HTTP topluluk ve sağlayıcı adaptörleri oyun fiziğinden ayrıdır.

Yeni savaş kuralları için deterministik referans `forest-traces-2026-10-21.json` eklenir; eski referanslar korunur. Ok görüntüleme izi ve eski paket kodlaması önceki sürümle birebir ayrıca karşılaştırılır.
