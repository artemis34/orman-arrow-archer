# Wildbow: sonraki özellikler ve gelir planı

Durum: öneri ve karar belgesi. Bu belgedeki oyun modları, satın alma, profil, reklam ve mağaza özellikleri uygulanmadı. Mevcut yayın Cloudflare'da devam eder; Oracle/VPS geçişi kullanıcı ayrıca istediğinde değerlendirilir.

## Önceki altı geliştirme paketi

| Öncelik | Paket                                         | İlk deneme                                                                           | Başarı ölçütü                                                                 |
| ------- | --------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1       | Süreli maç, sonuç ekranı, asist               | 4 dakikalık tur; eleme/asist/hedef puanı; kısa rövanş                                | İlk maçın tamamlanması ve rövanşa katılım                                     |
| 2       | İnsan sayısına göre botlar ve doğal davranış  | Sekiz katılımcıya tamamlama bu sürümde uygulanır; siper/kaçış davranışı sonraki adım | Botlar azalırken maçın doluluğu ve dengesi                                    |
| 3       | Harita bölgeleri ve ortak olay                | Önceden işaretlenen Orman Sunağı; iki yaklaşma/kaçış yolu                            | Oyuncuların ortak noktada buluşması; tek oyuncunun sürekli üstünlük kurmaması |
| 4       | Yetenek kombinasyonları ve kişisel kontroller | Ok/yay/hareket temaları; okunabilir küçük kombinasyon rozetleri                      | Birden fazla geçerli oyun tarzı; aşırı güçlü kombinasyon oluşmaması           |
| 5       | Profil, kozmetikler ve ana ekrana ekleme      | Misafir başlangıcı; kişisel rekorlar; kazanılan görünüşler; PWA                      | Oyuna geri dönme, cihazlar arası kayıt ihtiyacı                               |
| 6       | Düello ve 2v2                                 | Önce botsuz, eşit başlangıçlı 1v1; sonra takım kuralları                             | Adil maçlar, kısa bekleme, yeniden oynama                                     |

Altı paketin ayrıntıları [geliştirme yol haritasında](development-roadmap.md) korunur. Tek el kontrolü bu paketlerden bağımsız bir giriş seçeneğidir; ayrı eşleşme havuzu oluşturmaz.

## Düello için ilk taslak

- Davet bağlantısıyla iki arkadaş, botsuz arena.
- Eşit can/hasar ve simetrik siperler; ilk prototipte rastgele yetenek avantajı yok.
- Üç raundun ikisini kazanan alır; raundlar yaklaşık 45–60 saniye olabilir.
- Bekleyen oyuncuya açık bir hazır durumu; maç bitince rövanş veya ana menü.
- Kopma, geç katılım ve beraberlik kuralları uygulamadan önce seçilir. Oda daveti, tek başına gizli/şifreli erişim anlamına gelmez.

## Ek fikirler: yalnızca öneri

1. **Rövanş ve arkadaş daveti:** maç sonundan tek dokunuşla aynı oyuncularla tekrar oyna.
2. **Kısa kişisel hedefler:** maç tamamlama, farklı yay tarzlarını deneme; zorunlu günlük seri veya ağır görev yükü olmadan.
3. **Ölüm açıklaması:** son vuruş, kullanılan etki ve kısa bir karşı oyun ipucu.
4. **Erişilebilir kontroller:** joystick boyutu, sol/sağ el yerleşimi, yüksek kontrastlı hedef halkası, titreşim seçimi.
5. **Hafif görüntü modu:** gölge/efekt sınırı ve pil tasarrufu; oynanış kuralları aynı kalır.
6. **Yetenek koleksiyonu:** menüde okunabilir kart açıklamaları ve olası kombinasyonlar; maç ekranını doldurmaz.
7. **Oda ayarları:** arkadaş odasında bot sayısı, süre ve eşit başlangıç; genel eşleşmeye karışmaz.
8. **İzleyici ve turnuva araçları:** yeterli oyuncu talebi oluşursa; canlı gizli bilgiyi rakiplere sızdırmayacak gecikmeli izleme düşünülür.

## Gelir modeli

İlk tercih doğrudan satılan, ne alındığı açık **kozmetik paketler**. Can, hasar, menzil, atış hızı ve yetenek olasılıkları satın almayla değişmez. Misafir oyuncu doğrudan oynayabilmeye devam eder.

### İlk ürünler

- **Okçu kıyafeti:** Orman İzci, Köz Muhafızı, Ay Avcısı gibi temalar. Karakterin boyutu ve vuruş alanı aynı kalır.
- **Yay görünümü:** malzeme, küçük şekil ayrıntısı ve renk; yay germe okunabilirliği korunur.
- **Pelerin ve başlık:** yakın/uzak görünümde ayırt edilebilir; çevreyle görünmezlik avantajı sağlamaz.
- **Ok izi ve doğuş efekti:** sınırlı parçacık bütçesi; rakibin koruma süresini ve okun yönünü gizlemez.
- **Profil çerçevesi ve zafer pozu:** savaşı etkilemeyen görünüşler.

Ücretsiz kazanılan görünüşler de bulunur. İlk mağaza taslağı az sayıda net paket sunar; rastgele kutu veya gereksiz ara para birimi gerekmez. Başlangıç için paket başına $2,99–4,99 yalnızca araştırılacak fiyat hipotezidir; ücret, bölge ve ödeme masrafları doğrulanmadan fiyatlandırma kararı değildir.

### İkinci aşama

- **Destekçi paketi:** birkaç görünüş ve profil rozeti; güç avantajı yok.
- **Kozmetik sezon yolu:** yeterli içerik ve geri dönen oyuncu oluşursa; ücretsiz hat korunur.
- **Reklam:** ancak uygun kitle ve ölçüm oluşursa, menü/maç sonrası veya isteğe bağlı kozmetik önizlemesinde değerlendirilir. Canlı maç sırasında reklam, PvP'de satın alınan yeniden doğuş veya reklamla güç artışı planlanmaz.

### Gerekli teknik temel

Ödeme özelliği eklenmeden önce cihazlar arası profil, sunucuda doğrulanan kozmetik sahipliği, ödeme sağlayıcısı webhook'u, tekrar gelen olayların güvenli işlenmesi ve iade sonrası sahiplik güncellemesi gerekir. Tarayıcıdaki bir bayrak satın alma kanıtı olamaz. Misafir ilerlemesinin hesaba aktarılması ayrıca tasarlanır.

Bu sürüme ödeme sağlayıcısı, gerçek mağaza, ücretli plan veya reklam SDK'sı eklenmez. Önce oyun akıcılığı, maç tamamlama ve geri dönen oyuncu ölçülür; ardından bir küçük kozmetik paketle talep sınanır.

## Menü yönü

Bu sürüm: oyuncu adı/rengi, Çok oyunculu/Antrenman, Klasik/Tek el, Hızlı katıl/Arkadaş odası ve tek bir Oyna düğmesi. Kısa ekranlarda içerik normal akışta kayar; ekranda işlevsiz mağaza düğmesi gösterilmez.

Gelecekte profil/özelleştirme hazır olduğunda menünün ikincil alanına alınabilir. Düello ve takım modları gerçekten çalışır hale geldikten sonra mod seçimine eklenir.
