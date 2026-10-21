# Kill streak

Ölmeden ikinci rakibini öldürdüğünde sol altta **2 KILL STREAK** görünür. Sonraki
öldürmeler sayıyı ve alevlerin boyunu/yoğunluğunu artırır. Gösterge sabit boyutlu
bir alanda kalır; hasar, hız veya başka bir savaş avantajı vermez.

Sayacı yalnızca otoriter `World.damage` öldürme doğrulaması artırır. Asist, kendi
ölümü, dost ateşi ve istemcinin gönderdiği değerler artırmaz. Ölüm, yeniden
doğuş ve yeni tur seriyi sıfırlar; toplam maç öldürmeleri ayrı tutulur. Öldükten
sonra havadaki ok veya zehirle alınan öldürme mevcut toplam öldürme kredisini
korur, fakat yeni bir hayat serisi başlatmaz.

İsteğe bağlı `roster[].killStreak` hem JSON hem v2 anahtar/delta paketlerinden
taşınır. Alanın bulunmaması sıfırdır. Paket sırası, girdi sözleşmesi, tick oranı,
ok fiziği ve hasar hesapları değişmez. Eski istemciler ek alanı yok sayabilir;
yeni istemci eski sunucuda rozeti gizler.

Mobilde rozet joystick/can barı aralığına sığar; kısa yatay ekranlarda sol
joystick'in üzerine çıkar. Dokunmaları engellemez. Alevler altı sabit CSS öğesiyle
çizilir; DOM yalnızca sayı değişince güncellenir, `prefers-reduced-motion`
tercihinde alev ve büyüme animasyonları kapanır.

Doğrulama: `npm test`, `npm run check`, `npm run test:kill-streak` (Chromium ve
WebKit). Tarayıcı testi gerçek uygulamaya bağımsız bir otoriter test odasıyla
bağlanır; ikinci öldürme, alev artışı, ölüm/yeniden doğuş, menüden çıkış,
klasik/tek el mobil düzenleri, masaüstü ve azaltılmış hareket tercihini sınar.
Sabit fizik/ağ izleri yeni isteğe bağlı roster alanı çıkarılarak karşılaştırılır;
gerçek yeni metadata ayrıca v2 anahtar/delta testinde doğrulanır.
