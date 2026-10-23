# Wildbow — iOS ve tekrar oynama önerileri

23 Ekim 2026. Aşağıdakiler öneridir; bu sürüm yeni ödeme, reklam veya günlük ödül sistemi açmaz. Mevcut misafir profil, sunucuda doğrulanan kozmetikler, kazanılan yapraklar ve maç ödülleri temel alınır.

## Önce ilk maç ve rövanş

İlk girişte hesap açtırmadan tek el oynanışını 20–30 saniyelik güvenli bir karşılaşmayla öğretelim. Hareket, hedefe dokunma, atılma ve ilk kart seçimi sırayla gösterilsin. Sonuç ekranında tek büyük **Tekrar oyna** düğmesi ve anlaşılır bir ilerleme özeti bulunsun. Kalabalık bir ana menüye geri dönmek gerekmemeli.

Ölçüm: ilk maça başlama ve tamamlama oranı, ilk maçtan sonra rövanş, oyundan çıkılan adım. Botlu öğretici ile ranked istatistikleri ayrılmalı.

## Kazanılan kozmetikler ve küçük hedefler

Günde üç kısa, birbiriyle değiştirilebilir görev deneyelim: bir maç tamamla, bir ikmal al, takım arkadaşına asist yap. Ödül mevcut yaprak para birimi ve görünüş ilerlemesi olsun; hasar, can veya eşleşme avantajı vermesin. Kaçırılan gün için seri kaybı cezası olmasın. Ödüller maç sonucundan sunucuda türetilip bir defa verilsin; istemci kendi kazancını bildiremesin.

Haftalık ücretsiz kozmetik yolu, görünür bir sonraki ödül ve maç sonrası kısa kazanım animasyonu sürükleyiciliği artırabilir. Önce küçük bir içerik havuzuyla deneyelim; çok sayıda görev/para birimi eklemeyelim.

Ölçüm: ertesi gün ve yedinci gün geri dönüş (D1/D7), ödül sonrası rövanş, farklı görevlerin tamamlanması. Süreyi uzatmak tek başına başarı sayılmamalı.

## Arkadaşla geri dönme nedeni

Son rakiple rövanş, tek bağlantıyla arkadaş grubu, 2v2 ve dörtlü takımlar arasında hızlı geçiş öncelikli olabilir. Emoji tepkileri şimdi vardır; daha sonra maç sonunda karşılıklı takdir ve kozmetik rozet eklenebilir. Genel sohbet için ayrıca moderasyon ve engelleme gerekir.

## Adil ve anlaşılır gelir

İlk satış deneyi birkaç net fiyatlı yay, pelerin ve profil paketi olabilir. Oyun gücü satılmasın, rastgele ücretli kutu açılmasın. Apple uygulamasında dijital ürünler için uygun StoreKit satın alma, sunucu işlem doğrulaması, satın almaları geri yükleme ve iade işlemleri tasarlanmalı. Web ve Swift istemcileri aynı sunucu sahiplik kaydını kullanmalı.

İsteğe bağlı reklam ancak maç sonrasında kozmetik ödülü için düşünülebilir; savaş sırasında reklam veya ranked'de reklamla canlanma uygun değil. Reklam SDK'sı ve izleme tercihleri ayrıca değerlendirilecek; şu anda eklenmedi.

## Yayın öncesi kapı

Gerçek iPhone'da uzun oturum, ısınma/pil, arka plana geçiş, Wi-Fi–mobil ağ değişimi ve iki parmak/tek parmak testleri gerekir. Swift istemcisi sunucu otoritesini ve v2 mesaj sözleşmesini kullanmalı; fizik/ödül hesaplarını cihazlara dağıtmamalı. Uygulama değerlendirmesinde yeterli yerel deneyim ve Apple'ın o tarihteki kuralları ayrıca kontrol edilmeli. Başarı garantisi yerine ölçümlü küçük denemelerle ilerleyelim.
