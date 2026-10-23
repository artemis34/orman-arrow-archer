# Tek el, düello ve akıcılık sürümü

23 Ekim 2026. Başlangıç yedeği: [`backup/pre-onehand-default-b23ed91`](https://github.com/artemis34/orman-arrow-archer/tree/backup/pre-onehand-default-b23ed91), commit `b23ed9151355e43ad2cd57482999d1adc65db2b4`. Geliştirmeler ayrı `feature/onehand-flow-performance` dalında hazırlanır. Yerel tam geçmiş yedeği: `/workspace/backups/wildbow-pre-onehand-default-b23ed91.bundle`.

- Telefonlarda ilk tercih tek el/otomatik atış; bilgisayarlarda klavye ve fare. Cihaz türlerinin kontrol tercihleri ayrı saklanır. Klasik kontrol, ad ve renk ayarlardadır.
- Sol el seçimi eylem tuşlarını ve emoji düğmesini sola taşır. Atılma için hareket alanında çift dokunma seçeneği vardır; oyun dışı sayfanın yakınlaştırması kısıtlanmaz.
- Herkese açık düello simetrik XP, yetenek, geçici buff ve ikmal içerir. Ranked eşit başlangıcı ve rastgele ilerleme içermeyen kuralları korur.
- Yetenek seçme koruması beş saniye; tüm bekleyen seçimler bitince koruma ve donma hemen kalkar. Süre dolunca seçim yapılmasa da hareket geri gelir.
- Altı sabit emoji, küçük açılır düğmeden gönderilir. Sunucu dört saniyelik bekleme uygular; oyuncu metin veya koordinat gönderemez. Emoji atan oyuncu balon süresince çalıda görünür olur.
- Buff yerleşimi ağaç taçlarını ve yaklaşma boşluğunu hesaba katar. Renkli simge ve ışın, buff türünü uzaktan gösterir.

Sunucu otoritesi, ok hasarı, çarpışma kuralları, 30 Hz simülasyon, 15 Hz yayın ve v2 paket alanları korunur. Yeni kozmetik olay eski istemciler için isteğe bağlıdır. İstemci konum sunumu ve çizim önbellekleriyle ilgili sayısal sonuçlar performans raporunda tutulur.

[Öncesi/sonrası performans ölçümleri ve sınırlar](onehand-performance.md). [iOS ve ödül önerileri](ios-retention-roadmap.md) ayrı bir sonraki aşamadır.
