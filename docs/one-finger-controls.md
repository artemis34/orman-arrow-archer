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
- Kartlar çıkınca parmağı kaldırmak gerekmez. İlk yeni hareket seçimi mevcut
  parmak konumuna taşır; sola / yukarı / sağa çekmek 1 / 2 / 3 numaralı kartı
  vurgular. Yaklaşık 600 ms o yönde kalmak onaylar. Merkeze / aşağı dönmek,
  odak kaybı ve pointer iptali seçimi iptal eder. İstenirse bırakmak da onaylar.
  Kart değişince eski hareket geçersizleşir. Seçim sonrası aynı parmakla yürünür.
- Kartların konumu, doğrudan dokunma ve klavye kısayolları korunur.
- Yeni otomatik yardımlar Ayarlar'dan kapatılabilir.

İlk oyundaki geçilebilir öğretici gerçek hareket, atılma, atış ve yetenek seçimiyle
ilerler. Tamamlanma/atlama cihazda saklanır. Masaüstüne WASD/fare anlatılır.

Sunucu hareketi, hasarı, çarpışmaları ve bekleme sürelerini hesaplamaya devam
eder. v2 mesaj biçimi ve giriş alanları değişmez. Yeni bir istemci mesajı yoktur.

Yay animasyonu yalnızca görseldir: şarj, çekilen kol, gerilen kiriş ve yayda
bekleyen ok görünür. Sunucunun atış bekleme süresindeki yükseliş bırakma
hareketini başlatır. Otomatik atışta da bir sonraki ok için germe hareketi
gösterilir. Uçan oklar mevcut otoriter projectile akışından çizilir; animasyon
yeni bir fizik oku oluşturmaz.
