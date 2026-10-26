# Tek parmak kontrolleri

Yedekler: `backup/pre-one-finger-controls-7a22ac5` ve
`backup/pre-br-duos-tutorial-d0d3d88`.

Tek el modunda ayrı atılma, can ve emoji tuşları gizlenir. Klasik modda kalırlar.

- Parmağını normal çemberin ötesine çekince o yönde geçici bir ϟ hedefi çıkar.
  Hedef normal durumda joystick merkezinden yaklaşık 120 piksel uzaktadır;
  ekran kenarında erişilebilir alana sığdırılır. Hedef dışarıya kaçmaz; parmak hedefe ulaşınca bir kez atılma istenir.
  Yön değiştirmek hedefi yeni yöne taşır. Bekleme süresinde kalan süre gösterilir.
  Basılı tutmak tekrar atılmaz; yeni istek için önce çemberin içine dönülür.
- Can %35 veya altındayken mevcut +25 can yeteneği hazırsa otomatik istenir.
  Sunucu 14 saniyelik bekleme süresini, canı ve korumayı doğrular.
- Kartlar çıkınca parmağı kaldırmak gerekmez. Kartlar göründüğü anda seçim başlangıcı son
  parmak konumuna taşınır. İlk sola / yukarı / sağa çekiş doğrudan 1 / 2 / 3
  numaralı kartı vurgular. Kartlar görünür olduktan sonraki ilk 5 saniye okuma süresidir;
  bu sürede joystick'te beklemek otomatik onay vermez. Sonrasında yaklaşık
  600 ms o yönde kalmak onaylar. Karta dokunmak veya çekip bırakmak, ilk
  5 saniye dolmadan da hemen seçer. Seçilmemiş kartlar süre bitince kapanmaz.
  Merkeze / aşağı dönmek,
  odak kaybı ve pointer iptali seçimi iptal eder. İstenirse bırakmak da onaylar.
  Kart değişince eski hareket geçersizleşir. Seçim sonrası aynı parmakla yürünür.
- Kartların konumu, doğrudan dokunma ve klavye kısayolları korunur.
- Yeni otomatik yardımlar Ayarlar'dan kapatılabilir.

“Nasıl oynanır” ile açılan ayrı bot eğitimi gerçek hareket, atılma, atış ve
yetenek seçimiyle ilerler. Butondan yeniden oynanabilir; normal maçlarda
otomatik açılmaz. Masaüstüne WASD/fare anlatılır.

Sunucu hareketi, hasarı, çarpışmaları ve bekleme sürelerini hesaplamaya devam
eder. v2 mesaj biçimi ve giriş alanları değişmez. Yeni bir istemci mesajı yoktur.

Yay animasyonu yalnızca görseldir: şarj, çekilen kol, gerilen kiriş ve yayda
bekleyen ok görünür. Sunucunun atış bekleme süresindeki yükseliş bırakma
hareketini başlatır. Otomatik atışta da bir sonraki ok için germe hareketi
gösterilir. Uçan oklar mevcut otoriter projectile akışından çizilir; animasyon
yeni bir fizik oku oluşturmaz.
