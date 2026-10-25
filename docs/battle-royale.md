# Battle Royale ve dereceli karşılaşmalar

Solo BR 32 oyuncu; ikili BR 16 takım × 2 oyuncu. Boş hazırlık koltukları botlarla
tamamlanır. İnsanlar botların yerini alır; maç başladıktan sonra yeni giriş veya
boşalan koltuğa bot eklenmesi yoktur. Hazırlık 12 saniye, tam insan kadrosu
hazırsa hemen başlangıçtır. Var olan 84 × 84 harita, grafik ve daralan alan
korunur: 20 saniye hazırlık, 60 → 42 → 28 → 16 → 7 → 0 yarıçapları ve
5 / 8 / 12 / 18 / 30 saniyelik fırtına hasarı.

Solo oyuncu elenince dönmez. İkilide takım arkadaşı hayattaysa 15 saniyenin
sonunda, onun yakınındaki uygun bir noktada otomatik doğar. Seviye ve ekipman
normal yeniden doğuşta olduğu gibi sıfırlanır. İki takım üyesi de ölürse dönüş
yoktur. Son kalan takım kazanır; iki üye aynı takım sıralamasını alır.

Çevrimiçi solo ve ikili BR her zaman derecelidir; açma/kapatma seçeneği yoktur.
Düellolar dereceyi etkilemez. Eski `ranked` bağlantısı normal düelloya,
`brranked` solo `br`, `brduoranked` ikili `brduo` kuyruğuna yönlenir. Böylece eski
bağlantılar farklı eşleştirme havuzları oluşturmaz. Antrenman RP vermez.

Profillerde `ratings.solo` ve `ratings.duo` ayrı puan, maç ve galibiyet sayısı
tutar. İki genel sıralama da ayrıdır. Eski ortak `ranked` kaydı korunur;
modu bilinmeyen geçmiş sonuçlar yeni kayıtlara dağıtılmaz. Yeni iki kayıt 0 RP
ile başlar. Kozmetikler, yapraklar ve ömür boyu istatistikler korunur.

Dereceli maçlar doğrulanmış profil ve eşleştirme bileti ister. Botlu maçlar da RP
verir. Ölçek maç başındaki gerçek oyuncu / toplam oyuncu oranıdır (en az %20).
Solo 1–10. sıralar pozitif, 11–32. sıralar negatif RP alır. İkilide 1–8.
takımlar pozitif, 9–16. takımlar negatif RP alır; takım arkadaşlarının sırası
aynıdır. Tam insan kadrosunda birincilik +25, son pozitif sıra +2, ilk negatif
sıra −1 ve sonunculuk −10 RP'dir; aradaki sıralar doğrusal dağıtılıp yuvarlanır.
Bot ölçeği bu puanlara uygulanır; pozitif/negatif sonuç en az 1 RP'dir.
Tek insan +31 botta birincilik +5, sonunculuk −2 RP'dir. Puan 0'ın altına inmez.
Ölçek ölümler ve ayrılmalarla yeniden hesaplanmaz. Yalnızca birincilik galibiyet
sayılır. BR'den ayrılmak kalan oyuncuların maçını bitirmez; ayrılana, önceden
elenmişse kaydedilen sırası, hâlâ hayattaysa ayrıldığı andaki kalan taraf sayısı
üzerinden tek makbuzla sonuç kaydedilir.

Öğretici normal maçlarda otomatik açılmaz. Menüdeki “Nasıl oynanır” yerel,
7 botlu ayrı bir arena başlatır. Hareket, atılma, atış ve yetenek seçimi gerçek
oyun eylemleriyle öğretilir. Eğitim RP vermez ve çevrimiçi odaya bağlanmaz.
Tamamlayınca veya “Eğitimden çık”a basınca önceki menü seçimleri geri gelir.
Daha önce bitirilmiş olsa bile butondan tekrar oynanabilir.

Opsiyonel match metadata: `zone`, `survivors`, `winnerId`, `winnerTeam`,
`survivingTeams`, `reviveDelay` ve sonuç satırı `placement`. v2 oyuncu tuple'ları
ve giriş bayrakları değişmez; yerel/Swift istemcileri bunları sunucudan okur.

Düello elmas hatası: boşalan sabit noktaların saniyede çok kez doldurulması
engellenir. Normal noktalar 8 sn, nadir noktalar 45 sn bekler. Oyuncu 2,5 birim
mesafedeyken aynı yerde yeniden elmas çıkmaz. Paraşütlü ikmalin ayrı zamanlaması
korunur; ölüm kristalleri de sabit nokta yenileme sayılmaz.

Online sayaç botları saymaz. Menü `/api/presence` üzerinden 30 sn'de bir toplamı
okur; oynarken ek sayaç sorgusu yapılmaz. Odalar katılım/ayrılmada ve 30 sn'de bir
özel Community binding'ine bildirir. Çöken odaların bildirimi 90 sn'de zaman aşar.
İstemci varlık sayısını yazamaz. Arena menüsünde insan/bot sayıları ayrıca vardır.
