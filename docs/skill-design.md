# Ok yetenekleri ve PvP dengesi

Araştırma kaynağı: [ArcheroWiki topluluk yetenek verileri](https://github.com/enzo405/ArcheroWiki/blob/91d1da7106f4c5d9621e13a1a3d01693cf2f8503/web-project/calculator/data/wiki_data.py). İncelenen kayıtlar: Ricochet, Freeze, Explosive Arrow, Rear Arrow ve Multishot. Topluluk verileri sürümlere göre değişebilir; aşağıdaki sayılar Wildbow için tasarlanan, sunucuda uygulanan değerlerdir. Fandom ve bazı rehber siteleri bulut ağında 403 döndürdüğünden erişilebilen bu kaynak kullanıldı. Kaynaktan kod veya görsel alınmadı.

| Yetenek       | Wildbow davranışı                                 | PvP sınırı                                                                                                            |
| ------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Zincir ok     | Ana ok, yakın başka bir düşmana seker.            | Tek sekme; 6 birim, görüş hattı ve %40 hasar. Aynı hedefe dönmez; gizli/korumalı/takım arkadaşını seçmez.             |
| Buz oku       | Ana isabet kısa yavaşlatma uygular.               | %18, 0,65 saniye. 2,2 saniye tekrar etkilenmeme; hareket veya atışı kilitlemez, atılma kullanılabilir.                |
| Kor patlaması | Ana isabet çevresindeki diğer düşmanları etkiler. | 2 birim içinde 4 hasar; 1,1 saniye bekleme. İlk hedefe ek hasar, duvar arkasına etki veya patlama zinciri yoktur.     |
| Artçı ok      | Arkaya ek fiziksel ok.                            | Tek kademe; %50 hasar. Ana oka özel buz/patlama/zincir/uzak mesafe etkilerini çoğaltmaz.                              |
| Uzak avcı     | Uzun uçuş sonrası bonus.                          | 12 birim uçuş mesafesi sonrası %20; çarpan mesafeyle daha fazla büyümez. Temel ok 15, bonuslu ana ok en çok 18 hasar. |

Bu beş yetenek tek kademelidir; ek hasar sınırsız katlanmaz. Çoklu atışın yan okları %30 hasar ve azaltılmış zehir taşır; ana oka özel yeni etkileri çoğaltmaz. Botların %25 hasar indirimi alan ve zehir hasarına da uygulanır. Siper, takım kuralları ve kısa atılma dokunulmazlığı korunur. Oklar fiziksel olarak uçar; yeni yetenekler isabet garantisi veya duvar delme sağlamaz.

Seviye koruması oyuncuyu 3 saniye sabitler, hareket/atış/aktif iyileştirmeyi engeller ve hasarı durdurur. Daha önce atılan oklar ve devam eden saldırı zehirleri iptal edilir. Yeni XP aynı bekleyen seçimler varken süreyi yenilemez; seçimler erken tamamlansa da koruma 3 saniyeyi doldurur. Altın ışık, yükselen kıvılcımlar ve azalan halka koruma bitene kadar tüm izleyicilere görünür; koruma sırasında çalı kamuflajı açılır. Süre dolunca seçilmemiş kartlar kalır ama hareket ve savaş geri gelir. Koruma istemci tarafından talep edilemez; yalnızca sunucunun gerçek seviye artışıyla başlar. Botlar seçimlerini anında yapar ve bu korumayı almaz.

Yeni etkilerin, siperin, korumanın ve süre sınırlarının kontrolleri `tests/skills.test.js` içindedir. `tests/hud.smoke.js`, gerçek Socket.io üzerinden beş görünümde korumayı, erken seçimi, süre sonunda kontrolün dönmesini ve küçük açılır panelleri oynayarak doğrular.
