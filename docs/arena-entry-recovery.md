# Arena girişinde toparlanma

21 Ekim 2026'da “Arenaya bağlanılıyor…” ekranında kalma bildirimi üzerine
mevcut canlı sürümün kök adresi, hızlı katılma, tekrar giriş ve kayıtlı profil /
service worker ile yenileme yolları Chromium ve WebKit'te denendi. Bu
denemelerde bağlantı kuruldu; bildirilen telefondaki asıl tetikleyici henüz
doğrulanamadı. Kill streak değişikliği bağlantı protokolünü değiştirmiyordu.

Bulunan bağlantı eksikleri giderildi:

- Geçici ağ/sunucu hatası, zaman aşımı veya reddedilen hızlı katılma bileti
  sonrasında **bir kez** yeni bağlantı ve yeni rezervasyonla otomatik denenir.
  Özel oda doluluğu, kimlik/ranked doğrulama hataları tekrar edilmez.
- Arena arama, WebSocket bağlantısı ve oyuncu hazırlığı ayrı durum mesajlarıdır.
- OYNA, bekleme boyunca İPTAL ET olur. İptal bekleyen `connect()` promise'ını
  reddeder; geç gelen HTTP yanıtı yeni socket açamaz. Önceden `close()` zaman
  aşımını temizliyor, fakat bekleyen promise'ı sonuçlandırmıyordu.
- Oyun modu/oda seçimini değiştirmek de eski bekleyen bağlantıyı durdurur.
- Geçersiz welcome yanıtı zaman aşımını kapatıp giriş akışını yarım bırakamaz.
- Tek kullanımlık eşleştirme yanıtı istemcide de `cache: no-store` kullanır.
- `workers.dev` adresleri build modu yanlışlıkla genel `production` olsa da
  doğal WebSocket adaptörünü seçer; Socket.IO sunucusu arayarak beklemez.
- İptal mevcut Node/Socket.IO geliştirme adaptöründe de bekleyen girişi bitirir.

Google/Apple girişi zorunlu yapılmadı. Sunucu, fizik, hasar, snapshot/girdi
protokolü, ranked kimlik kuralları ve oyuncunun kayıtlı profili değişmedi.
Bağlantı iki denemeden sonra hâlâ kurulamıyorsa hata gösterilir; otomatik
olarak tek oyunculuya geçirilmez. Oyuncu antrenmanı kendisi seçebilir.

`npm test` bağlantı iptali, zaman aşımı, tekrar denenebilir hatalar, bozuk
welcome ve gecikmiş HTTP yanıtını doğrular. `JOIN_RECOVERY_TESTS=1 npm run
test:join` gerçek Worker odasında geçici 503, süresi geçmiş bilet, kalıcı
hata sonrası düğmenin açılması, iptal ve ardından tekrar giriş/antrenmanı
sınar. Chromium ve WebKit için hem yerel Worker hem canlı sürüm denetlenir.
