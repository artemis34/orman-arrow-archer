# Wildbow v2: web ve Swift istemci sözleşmesi

Bu belge `7397e49` sürümünden sabitlenen v2 temel sözleşmesini tarif eder. Yeni bir protokol veya Swift oyun
istemcisi devreye alınmamıştır. Makine tarafından okunabilir sözleşme
[`protocol/wildbow-v2.json`](../protocol/wildbow-v2.json), çalışan sürümden
alınmış sabit örnekler
[`protocol-v2-7397e49.json`](../tests/fixtures/protocol-v2-7397e49.json) içindedir.

Güncel geriye uyumlu kritik/ikmal metadata'sı, ranked ve profil/topluluk HTTP uçları
[orman ilerlemesi notlarında](forest-ranked-social.md) açıklanır. Tuple sırası ve
protokol numarası değişmez; istemci bilinmeyen isteğe bağlı alanları yok sayar.

## Sunucu ve taşıma

Üretimde Cloudflare Worker HTTP yönlendirmesi, `ArenaRoom` Durable Object ise
tek odanın otoritesidir. Swift, `URLSessionWebSocketTask` ile aynı standart WSS
adresine bağlanabilir. Node.js geliştirme sunucusundaki Socket.IO ayrı bir
adaptördür; Socket.IO/Engine.IO çerçeveleri standart WebSocket mesajları değildir.
Swift istemcisi için Cloudflare yolunu kullanmak Socket.IO bağımlılığı gerektirmez.

1. Genel oda için `GET /api/matchmake?format=t8` çağrısı `room` ve tek kullanımlık
   `ticket` verir. `arena` varsayılandır. Arkadaş odası doğrudan oda koduyla açılır.
2. `wss://HOST/api/rooms/ROOM?format=t8&ticket=TICKET` bağlantısı açılır. Arkadaş
   odasında bilet bulunmaz. Oda kodu 3–24 küçük harf/rakam/tire içerir.
3. İlk mesaj UTF-8 JSON'dur:

```json
{"type":"join","data":{"name":"Okçu","skin":0,"protocol":2,"viewRadius":34,"format":"t8"}}
```

Profil kullanılacaksa mevcut 64 haneli profil anahtarı `data.profileToken` ile
iletilir. Bu, Cloudflare hesap/API tokenı değildir. Sunucu ekipmanı profilden
doğrular. Sunucu `welcome` mesajıyla `id`, `obstacles`, `rules`, `room`,
`protocol` ve `format` döndürür. İstemci kimliğini kendisi seçmez.

4. `welcome.data.protocol === 2` ise durumlar ve kontroller ikilidir. Başka/eski
   sürüm bildiren istemciler mevcut JSON yolunu kullanır; bu dal bu desteği korur.
   JSON durum biçimi `{"type":"state","data":{...}}` şeklindedir.
5. `upgrade` (metin beceri kimliği), `respawn`, `reroll`, `rematch`, `ping` ve
   `view` (sayı yarıçapı) mevcut `{type,data}` JSON mesajları olarak kalır.
   `profile`, `pong`, `full` ve `error` JSON'dur. Profillerin ödül yazma yolu
   istemcilere açılmaz.

Web için origin kontrolü korunur. Mevcut Worker, `Origin` içermeyen yerel
istemci isteklerini reddetmez. Origin gönderilecekse mevcut izinlerle uyumlu
olmalıdır; Swift için bu kontrolde bir gevşetme yapılmamıştır.

## İkili değer kodlaması

Her mesaj `57 42 02` hex (`87,66,2`) başlığı ve bir değer içerir. Sayı bayt sırası
little-endian'dır. WebSocket mesaj sınırları korunur; TCP parçalarını ayrı paket
olarak yorumlamayın.

| Etiket | İçerik |
| --- | --- |
| 0 | null; JavaScript `undefined` değerleri de böyle yazılır |
| 1 / 2 | false / true |
| 3 | Zigzag tamsayı; ardından 7 bitlik unsigned varint |
| 4 | 8 bayt IEEE-754 Float64, little-endian |
| 5 | Varint UTF-8 **bayt** uzunluğu, ardından metin |
| 6 | Varint eleman sayısı, ardından değerler |
| 7 | Varint anahtar/değer çifti sayısı, ardından metin anahtar ve değer |

Varint düşük 7 biti önce yazar; devam bayrağı `0x80`'dir. Zigzag pozitif/sıfır
için `n*2`, negatif için `-n*2-1` kullanır. Kodlayıcı yalnızca güvenli tamsayı ve
`abs(n) < 1e12` durumunda etiket 3 seçer. Diğer sayılar Float64'tür; sonlu olmayan
girdi mevcut JS davranışıyla Float64 sıfır olarak yazılır. Swift tarafında
`Double` ve yeterli aralıkta `Int64`/`UInt64` kullanın; Float32'ye düşürmeyin.

Çözücü sınırları: mesaj 262.144 bayt, koleksiyon 16.384 öğe, iç içelik 12 ve
varint en çok 6 bayttır. Sunucuya gelen kontrol mesajı ayrıca 4.096 baytla
sınırlıdır. Başlık, taşma, eksik veri ve sonda kalan veri reddedilir. Kesilmiş
Float64, sıfır dolgu yapılarak kabul edilmez. JS UTF-8 çözücüsü geçersiz dizileri
yerine koyma karakteriyle çözer; Swift `String(decoding:as:)` davranışı buna uygundur.

Sözlük anahtar sırası anlamsal değildir. Sabit JS kodlama örnekleri mevcut JS
anahtar sırasını içerir. Swift genel sözlükleri birebir aynı baytlarla yeniden
yazmak istiyorsa sıralı anahtar çiftleri kullanmalıdır. Oyun kontrolleri ve
durum kayıtları konumsal dizilerdir; bunların alan sırası zorunludur.

## Kontroller

```text
["input", [[seq, x*10000, z*10000, angle*10000, flags, lockTarget], ...]]
```

Çarpımlar JS `Math.round((value || 0) * scale)` kuralıyla yuvarlanır. Yarım
değerler **pozitif sonsuz yönüne** gider; Swift'in varsayılan yarımdan uzağa
yuvarlamasını doğrudan kullanmayın. Örneğin negatif yarım için sonuç değişebilir.
Konum birimi dünya birimi, açı radyandır. Eksenler temizlenmiş yön girdileridir;
istemci konum, hasar, ok hızı veya vurma iddiası göndermez.

| Bit | Eylem |
| --- | --- |
| 0 | charge |
| 1 | dash |
| 2 | heal |
| 3 | quickShot |
| 4 | cancelShot |
| 5 | autoFire |

`lockTarget` false ise seçim değişmez; null kilidi kaldırır; metin belirli hedef
kimliğidir. Bool false ile null'ı birleştirmeyin. Bir pakette 1–4 kare kabul
edilir; mevcut istemci normalde iki sıralı 30 Hz kareyi yaklaşık 15 paket/sn
olarak gönderir. Başlatma/bırakma, durma ve tek basımlık eylemler hemen gönderilir.
Sıradaki kareler otoritede bir fizik turunda en çok birer kez işlenir. Normal
girdi sıklığını ve `seq` semantiğini bu optimizasyon dalında değiştirmedik.

## Durum, deltalar ve kimlikler

Durum dizisi 14 öğedir:

```text
["state", reset, timeMs, addedPlayers, changedPlayers, removedPlayerIds,
 arrows, addedOrbs, removedOrbIds, powerups, events, rosterOrNull,
 matchOrNull, objectiveOrNull]
```

`addedPlayers`: `[id, ...42 alan]`. Alanların eksiksiz sırası ve ölçekleri
manifesttedir. `changedPlayers`: `[id, alanIndex, değer, alanIndex, değer, ...]`.
Alan indeksleri sıfırdan başlar ve değiştirilemez. Konum/hız 100, oyuncu açısı ve
kısa süreler 1000 ölçeğindedir; HP de 100 ölçeğindedir.

`reset` geldiğinde önce oyuncu ve XP temelini temizleyin. Oyuncu patch'inin
temeli yoksa tahmin yürütmeyin; mevcut istemci bağlantıyı hata koduyla kapatır.
İlk durum tam temeldir; sonra her 75 durumda bir yeniden temel verilir
(15 Hz'de 5 sn). Bağlantı değişiminde eski odanın temelini kullanmayın.

Oklar yakındaki **tam listedir**, delta değildir:
`[id,x*100,z*100,angle*1000,poison,effect,trail]`.
Yeni XP kayıtları `[id,x*100,z*100,value,rare]`; silinenler kimlik listesidir.
`rosterOrNull === null` önceki sıralamayı korur. `match` ve `objective` isteğe
bağlı JSON-benzeri değerlerdir. Olaylar yalnızca görsel/ses sunumunu tetikler;
istemci bunlardan yeni hasar hesaplamaz. Kimlikleri paket içindeki özgün sayı
veya metin türleriyle koruyun; Swift tek bir sayısal kimlik türü varsaymamalıdır.

Gizli oyuncu/uzak oyuncu filtreleri ve oyuncuya özel seçimler otoriteden gelir.
Roster konum içermez. Nadir XP, harita işaretleri için uzakta da gönderilebilir.
Bu kuralları yerel hedef seçimiyle geçersiz kılmayın.

## Swift uygulamasının sınırları

Önerilen katmanlar: `URLSession transport → v2 codec → immutable SnapshotStore →
presentation/prediction → renderer`. Input üretimi ve 30 Hz gönderim saati
render döngüsünden ayrılmalıdır. Web/Swift aynı `World` sunucusuna bağlanır;
Swift'e Three.js veya Socket.IO taşımak gerekmez.

Mevcut sunucu-otoriter hareket, ok uçuşu, çarpışma, hasar ve seviye sistemi
JavaScript sunucusunda kalır. Yerel hareket tahmini Swift'e aktarılacaksa
`advanceMovement`/`moveBody` kuralları için ayrıca aynı girdilerle sayısal
karşılaştırma gerekir. Bu çalışma yeni bir tahmin veya ok fiziği tasarlamaz.
Mevcut web sunumu 90 ms interpolasyon ve yaklaşık 85 ms görsel uzlaştırma
kullanır; yalnızca indeks oluşturma zamanı optimize edilmiştir.

Profil HTTP API'si aynı kalır. Swift profil anahtarını Keychain'de saklayabilir.
Kozmetik ve beceri kimlikleri sabit veri kimlikleridir; istemcinin çizim motoru
bunları kendi assetlerine eşler. Katalogların native build'e aktarımı sonraki
iştir; mevcut `CATALOG` JavaScript içindedir, yeni bir katalog API'si eklenmemiştir.

Bir sonraki native doğrulama: sabit input paketlerinin Swift'te aynı baytlarla
kodlanması, tüm kayıtların aynı değerlerle çözülmesi, ardından yerel workerd'de
web + Swift oturumu. Bu dalda Swift derlemesi/iOS cihaz testi yapılmış değildir.
Protokolü değiştirecek sonraki çalışmalar ayrı sürüm ve yetenek anlaşmasıyla
eski v2/JSON yolu korunarak yapılmalıdır.
