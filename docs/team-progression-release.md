# Takımlar, maç döngüsü ve koleksiyon

Bu sürümde uygulanmış davranışlar:

| Karşılaşma    | Takım      | Oyuncu | Süre     |
| ------------- | ---------- | ------ | -------- |
| Serbest arena | Herkes tek | 16     | Süresiz  |
| Süreli arena  | Herkes tek | 16     | 4 dakika |
| Düello        | Herkes tek | 2      | 2 dakika |
| 2v2           | 2          | 4      | 4 dakika |
| 4v4           | 2          | 8      | 4 dakika |
| 8v8           | 2          | 16     | 4 dakika |
| Dört takım    | 4          | 16     | 4 dakika |
| Sekiz takım   | 8          | 16     | 4 dakika |

## Maç kuralları

Her mod kendi eşleştirme havuzunu kullanır. Davetler oda kodunu ve formatı taşır; aynı özel odada farklı formatlar karışmaz. Takımlar dengelenir; özel odadaki arkadaşlar takım kapasitesi elverdiğince birlikte kalır. Takım doluluğu botları da hesaba katar. Dost ateşi, zehir ve alan hasarı dahil kapalıdır. Otomatik nişan ve elle kilit takım arkadaşına yönelmez. Takım halkası, can barı, isim simgesi ve harita rengi kıyafetten bağımsızdır.

Online düelloda bot yoktur; ikinci oyuncu beklenir. Eşit can/temel hasar, simetrik siperler ve sabit karşılıklı doğuş kullanılır. Düelloda rastgele XP, kart ve güç noktası yoktur. Antrenmandaki düelloda tek bot bulunur. Diğer modlar kapasite elverdiğince sekiz toplam katılımcıya botla tamamlanır.

Eleme 3, son 8 saniyede katkıda bulunan diğer oyuncuya asist 1 puan verir. Takım skoruna katkılar eklenir. Süre sonunda hasar, oklar ve hareket durur; eleme/asist/puan tablosu açılır. Beraberlik gösterilir. 12 saniyede yeni tur başlar; bütün gerçek oyuncular hazır derse hemen rövanşa geçilir. Her yeni tur eşit başlangıçtır. Maç ortası katılım mümkündür.

## Harita, botlar, kartlar

Kadim Kalıntılar, Altın Koru ve Sessiz Açıklık farklı arazi/siper dağılımları sunar. Küçük XP ve nadir 60 XP kristalleri korunur. Orman Sunağı ilk kez 60. saniyede açılır; son 10 saniyede haritada haber verilir. Dört saniyelik kontrol gerekir; rakipler varken ilerleme durur. Yakındaki ele geçiren oyunculara 24 XP ve 2 bireysel puan, takımına toplam 2 puan verir. Aynı anda tek sunak vardır; 25 saniyede alınmazsa kapanır. Alındıktan 75 saniye sonra yeniden açılır. Düelloda sunak yoktur.

Botlar düşük canla geri çekilir, siper atış hattını gözetir, görünür yaklaşan oklardan olasılıkla kaçar ve sunağa yönelir. Gizli düşman bilgisi kullanmazlar. Doğuş kalkanındaki düşmana yaklaşabilir fakat ateş açmazlar.

12 eski karta ek olarak: Kristal Çekimi (küçük XP alanı +%40), Gölge Adımı (gerçek bir oktan atılmayla kaçışta +8 can, 6 sn), Usta Geriş (tam gerilim sonrası 2 sn +%15 germe/atış hızı), Koruyucu Kabuk (tek doğrudan vuruşta %40 azaltma, 6 sn), Geri Dönen Ok (ana ok dönüşte %40 hasar, her rakibe bir kez, siper keser). İkincil dönüş saldırıları yeniden zehir/patlama/zincir üretmez. Maç başına bir kart yenileme hakkı vardır; koruma süresini uzatmaz. Kombinasyon rehberi menüdedir; gizli hasar bonusu yoktur.

## Profil ve görünüşler

Cloudflare `PlayerProfile` SQLite Durable Object'i istatistikleri, yaprak bakiyesini, sahip olunan ve kuşanılan görünüşleri saklar. Misafir için tarayıcıda rastgele 256 bit erişim anahtarı oluşturulur. Anahtar URL'ye veya oyun durumuna yazılmaz; profil nesne kimliği SHA-256 özetidir. Başka cihazda devam etmek için profil yedeği indirilebilir ve içe aktarılabilir. Bu, e-posta hesabı veya şifre sıfırlama hizmeti değildir; yedek olmadan tarayıcı verisi silinirse misafir kimliği geri getirilemez.

17 parça: üç yay, üç pelerin, iki başlık, üç ok izi, iki doğuş efekti, iki profil çerçevesi, iki zafer pozu. Oyuncunun dört temel kıyafet rengi korunur. Parçaların hasar, can, hız veya vuruş alanına etkisi yoktur. Düşük görüntü modunda ek ok izi parçacıkları çizilmez.

En az 30 sn katıldığı tamamlanmış online tur için oyuncu 20 yaprak, en fazla 20 eleme yaprağı ve kazanırsa 10 ek yaprak alır. İlk tamamlanan maç +30 yaprak; 3 maçta gece pelerini, 30 isabette ay yayı, 3 sunakta ay doğuşu açılır. Antrenman sunucudaki bakiyeyi artırmaz. Ödülleri yalnız ArenaRoom iletir; yinelenen tur makbuzu tekrar ödemez. İstemci para, sahiplik veya sonuç göndererek ödül alamaz. Profil servisinin hatası oyunu durdurmaz; otomatik garantili ödül teslim kuyruğu yoktur.

Mağaza oynayarak kazanılan yapraklarla çalışır. **Gerçek para ödemesi, destekçi satışı, reklam ve sezon aboneliği bağlı değildir.** Gerçek satış için ödeme sağlayıcısı hesabı, doğrulanan webhook ve iade işlemleri ayrıca kurulmalıdır; çalışan satın alma varmış gibi bir ödeme düğmesi yoktur.

## Mobil ve altyapı

Okçum paneli görünüş, profil/başarımlar, yetenek rehberi ve ayarları toplar. Joystick boyutu, solak klasik yerleşim, titreşim ve görüntü kalitesi saklanır. Tek el merkez joystick düzeni korunur. PWA manifesti, iPhone ana ekran simgesi ve aynı kaynaktaki statik dosyalar için çevrimdışı önbellek eklenir. İlk başarılı yükleme/önbellekten sonra antrenman çevrimdışı kullanılabilir; online oyun ve profil bağlantı gerektirir. API ve profil yanıtları önbelleğe alınmaz.

Wrangler `v1` ve `v2` migrasyonları korunur; `v3` ile PROFILES binding'i eklenir. Ücretli Cloudflare planı açılmaz. Tur başına profil yazıları ve mod başına eşleştirme havuzları önceki maliyet hesabına ek yük getirir; az oyunculu çok sayıda ayrı oda süre tüketimini artırır. Eski JSON istemcileri çalışır; ikili protokol yeni alanlar için v2'dir.

Önceki test edilmiş sürüm: `backup-before-team-modes-2026-10-20` etiketi (`0305c1d`). Tam Git yedeği `/workspace/backups/wildbow-before-team-modes-2026-10-20.bundle` olarak doğrulandı. Eski bir sürüme dönüşte profil sınıfı ve v3 migration geçmişi korunmalıdır.
