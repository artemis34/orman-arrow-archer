# Cloudflare ağ ve oda iyileştirmesi

Barındırma Cloudflare Workers + SQLite-backed Durable Objects olarak devam eder. Oracle/VPS veya ücretli aboneliğe geçiş yapılmaz. Fizik, can, hasar, beceri ve hedef doğrulaması ortak `World` motorunda sunucu otoritesiyle çalışır.

## Mesaj ve paket modeli

- Simülasyon ve yerel hareket tahmini 30 Hz; durum yayını 15 Hz.
- Yeni istemciyle protokol sürümü üzerinde anlaşılır; iki sıralı 30 Hz kontrol karesi bir ikili pakette gönderilir. Normal akış yaklaşık 15 paket/sn'dir. Atışın başlama/bırakılması, durma, atılma, iyileşme ve hedef seçimi bekletilmeden gönderilir; yoğun eylemde oran artabilir.
- Sunucu fizik turunda en fazla bir sıradaki kontrol karesini uygular. Kare sayısı fizik hızını artırmaz. Gecikmiş kuyruk sınırlıdır; tek basımlık eylemler korunarak eski hareketler düşürülür.
- Uygulama ping'i 10 saniyede birdir. Eski JSON istemcileri desteklenir; onlar eski gönderim sıklığını kullanır.
- `shared/protocol.js` sayıları, bayrakları ve listeleri bağımlılıksız ikili paketlerde taşır. Konum/hız santimetre, açı ve kısa süreler binde bir düzeyinde kodlanır. Render/prediction sözleşmesi korunur.
- İlk durum tam temel oluşturur; sonra değişen oyuncu alanları ve eklenen/silinen XP nesneleri gönderilir. Oklar yakın alanın küçük tam listesidir. Beş saniyede bir yeni temel gönderilir. Güvenilir ve sıralı WebSocket kullanılır; bozuk temel bağlantıyı kapatır.
- Yakın alan kamera görüşünü ve ekran dönüşünü kapsar; yarıçap 34–80 dünya birimidir. Gizlenme korunur. Nadir XP kristalleri ve güç noktaları minimap için gönderilir. Genel sıralama konum içermez; uzaktaki oyuncunun ayrıntılı durumu gönderilmez.

## Odalar

- **Hızlı katıl:** `ArenaMatchmaker`, ilk uygun genel odada 15 saniyelik yer ayırır. Tek kullanımlık bilet bağlantıda tüketilir. Eşzamanlı başvurular aynı son yeri dolduramaz.
- **Arkadaş odası:** oda kodu/davet aynı dünyaya gider; doluysa başka odaya ayrılmaz. Oda kodu erişim parolası değildir.
- Genel havuz 128 oda × 16 gerçek oyuncuyla sınırlıdır. Bu, test edilmiş üretim kapasitesi garantisi değildir. Havuz dolarsa tekrar deneme mesajı gösterilir.
- Online oda sekiz toplam katılımcıya tamamlanır: 1 insan + 7 bot, 6 insan + 2 bot, 8 veya daha fazla insan + 0 bot. İnsan sınırı 16'dır. Antrenman yedi botla kalır.
- Son insan çıkınca döngü ve dünya temizlenir. Yeni sürüm/yeniden başlama maçı sıfırlar. Eşleştirme yalnızca oda arama işaretini saklar; oyuncu ilerlemesi kalıcı değildir.
- Wrangler `v1` ArenaRoom migrasyonu korunur; `v2` ile `MATCHMAKER` SQLite sınıfı eklenir. Mevcut Cloudflare Git build'i bunu deploy sırasında uygular.

## Ölçüm ve sınırlar

Yerel, sabit seed'li hareket/otomatik atış simülasyonunda bu örnekler ölçüldü. Otuz saniyelik simülasyonun ilk on saniyesi ısınma, kalan yirmi saniyesi ölçümdür. Bunlar gerçek internet veya Cloudflare kapasite testi değildir.

| İnsan / bot | Tam JSON ortalaması | İkili delta ortalaması | Paket azalması | Oyuncu başına 15 Hz |
| ----------- | ------------------- | ---------------------- | -------------- | ------------------- |
| 1 / 7       | 17,7 KB             | 0,73 KB                | %95,9          | 11 KB/sn            |
| 8 / 0       | 17,8 KB             | 1,00 KB                | %94,4          | 15 KB/sn            |
| 16 / 0      | 24,6 KB             | 2,05 KB                | %91,7          | 31 KB/sn            |

Örnekler 34 birim yakın alan kullanır. Geniş/yatay ekranda daha fazla aktör, yoğun yetenek/olay, ilk giriş ve yeni temel daha büyük paket üretir. Ağ/TLS başlıkları dahil değildir. JSON ve delta aynı anda aynı dünyadan alınır; önceki sürümdeki sabit yedi botun kaldırılması ek tasarruftur.

Paket boyutu azalması, Cloudflare istek ücretinin aynı oranda düşmesi anlamına gelmez. Kontrol birleştirmesi normal akıştaki mesaj ücretini yaklaşık yarıya indirir. Aktif `setInterval` uyumayı engellemeye devam eder; dolu oda süresi ücret/kotasına dahildir. Eşleştirme küçük ek HTTP/DO istekleri ve işaret değişimlerinde depolama yazısı kullanır. Sınırsız ücretsiz kapasite vaat edilmez.

## Doğrulama

`npm test` ikili veri, delta/yeniden temel, XP silinmesi, gizlenme, yakın alan, kilit kuralları, rezervasyon, bot sayısı ve 130–240 ms gecikmeli hareketi denetler. `npm run test:cloudflare` gerçek workerd'de oda/otorite sınırlarını; `npm run test:cloudflare:browser` iki oyunculu masaüstü/mobil oyunu denetler. `npm run test:lobby` kısa/yatay menü, merkez joystick, dokunarak kilit ve klasik düzene dönüşü gerçek otoriteyle sınar. WebKit kontrolleri CI'de de çalışır.
