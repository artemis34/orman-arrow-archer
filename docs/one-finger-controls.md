# Tek parmak kontrolleri

Çalışan sürümün yedeği: `backup/pre-one-finger-controls-7a22ac5`.

Telefonda varsayılan tek el modunda:

- Hareket joystick'ini dış çemberin ötesine uzatmak bir kez atılma ister.
  Parmağı dışarıda tutmak yeni atılmalar üretmez. Yeniden uzatmak için önce
  çemberin içine dönmek gerekir. Hazır olmayan atılma sonraya sıraya alınmaz.
- Can %35 veya altına indiğinde mevcut +25 can yeteneği otomatik istenir.
  Sunucu mevcut 14 saniye bekleme süresini, canlı olmayı ve seviye korumasını
  doğrular. Zayıf bağlantıda yeniden deneme en fazla saniyede bir yapılır;
  mevcut hareket paketindeki `heal` alanı kullanılır, yeni mesaj türü yoktur.
- Yetenek kartlarının konumu değişmez. Kartlar açıkken yeni bir joystick
  hareketinde sol / yukarı / sağ, sırasıyla 1 / 2 / 3 numaralı kartı vurgular.
  Parmağı bırakmak seçimi onaylar; merkeze dönmek veya aşağı çekmek iptal eder.
  Kartı yenileme, parmak iptali ve odak kaybı eski seçimi onaylamaz. Seviye
  atlarken zaten yürüyen parmağın hareketi seçim sayılmaz: önce bırakılır.
- Atılma ve can tuşları elle kullanılabilir. İki yeni otomatik yardımcı Ayarlar
  sekmesinden ayrı ayrı kapatılabilir. Klasik mod ve bilgisayarın WASD/fare
  kontrolleri aynı kalır; kartlara dokunma ve 1/2/3 kısayolları çalışır.

Bu değişiklik yalnızca istemci girişini ve kart vurgusunu etkiler. Sunucu
fiziği, hasar, çarpışma, 30 Hz giriş ve v2 ağ protokolü değişmez. Beş saniyelik
koruma ve seçim tamamlandığında korumanın erken bitmesi mevcut sunucu
davranışıdır.

Doğrulama: `npm test`, `npm run check`, iki build ve
`npm run test:one-finger` (Chromium / WebKit). Yeni tarayıcı senaryosu gerçek
otoriter test sunucusuna bağlanır; Chromium'da gerçek dokunmatik girdisini,
WebKit'te mobil boyutta yakalanan pointer olaylarını kullanır. Telefonun
gerçek donanım performansı bu işlev testinden çıkarılamaz.
