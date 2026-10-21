# Ok akıcılığı ve bot sıkışması düzeltmesi

Başlangıç sürümü: `3284564c4d1a2a76e0cf77545832329fe9549ae8`.

## Yeniden üretilen sorunlar

- Online oklar paketlerin geliş zamanına göre çiziliyordu. 15 Hz yayında, 70 ms'ye varan sıralı ağ dalgalanması testinde 120 Hz çizimin 226 karesinin 35'inde ok hareketsiz kalıyordu. Yeni okların ilk görünmesi ve sonradan silinmesi de eski görüntü tamponuna bağlıydı.
- Antrenmanda ok konumları doğrudan 30 Hz fizik adımlarından çiziliyordu; aradaki görüntü karelerinde ilerlemiyordu.
- Canı azalan botlar köşede arena dışına kaçmaya çalışıyor, fizik sınırda tuttuğundan hareket edemiyordu. Taş önündeki itme alanında ileri–geri giderek hedefe ulaşamayan bir durum da yeniden üretildi. Dokuz harita tohumu ve 90'ar saniyelik gözlemde 2,5 saniyeyi aşan 12 hareketsizlik örneği vardı.

## Değişiklikler

Online ok çizimi mevcut sekiz snapshot'lık tampon ve sunucunun zaten gönderdiği simülasyon zamanını kullanır. Yaklaşık 100 ms görüntü tamponu, yavaş ve sınırlı saat düzeltmesiyle birlikte paket gelişindeki düzensizliği ayırır. Kısa boşluklarda yalnızca gözlenen düz uçuş en fazla 100 ms görsel olarak uzatılır; siper ve arena sınırından geçmez. Sekme/yön değişimi ve geri dönüşte eski hızla devam edilmez. Sunucunun kaldırdığı ok hemen silinir. Tur değişimi eski ok geçmişini kullanmaz.

Antrenman okları ardışık iki fizik adımı arasında görüntü karesinin oranıyla çizilir. Bu işlem dünyaya ek fizik adımı işletmez.

Botlar ilerlemelerini bir zaman penceresinde takip eder; tamamen sınırda kaldıklarında veya ilerleyemediklerinde kısa bir açık yön seçip yürürler. Yön seçimi `WeakMap` içinde tutulur, yeniden doğuşta temizlenir. Işınlanma, ek hız, ücretsiz dash veya hasar değişikliği yoktur. Hedefleme ve savaş durum makinesi korunur; sıkışmadan çıkan botların maç içindeki yolları ve dolayısıyla karşılaşmaları değişebilir.

## Doğrulama

- İlk dokuz regresyon testi başlangıç sürümünde başarısız oldu; düzeltmeyle geçti. Ek testler görsel devamın sınırlarını, siperleri, çalıları, ok kaldırılmasını, doğuşu, tur değişimini ve geri dönen okları kontrol eder.
- Chromium'da gerçek WebGL ok matrisleri telefon ve masaüstü boyutlarında kontrol edildi. Otoriter dünyadan üretilen v2 paketleriyle, dalgalanmalı ağın kontrollü 120 Hz çizim örneklerinin 82'sinde donan kare yoktu. Bu, fiziksel telefonda 120 FPS garantisi değildir. Yerel okların ara konumları ve silinen okların mesh'lerinin kaybolması da doğrulandı.
- Aynı dokuz tohum/90 saniye bot taramasında 2,5 saniyeyi aşan hareketsizlik örneği 12'den 0'a indi. Dört köşe ve taş etrafından çıkış ayrıca deterministik testlerle doğrulanır; her adım normal yürüme hızıyla ve mevcut çarpışmalarla sınırlıdır.
- İnsanlardan oluşan 8 ve 16 kişilik senaryoların fizik, JSON, v2 paket baytları, girdileri ve hasar/atış izleri eski optimizasyon referansıyla birebir aynı kalır. Botlu senaryo ve okların görüntü izi, bu bilinçli düzeltme için ayrı referansta saklanır; eski referans dosyası korunur.
- Protokol v2 ve altın paket vektörleri değişmez. Yeni alan, ek snapshot, daha sık mesaj veya Swift istemcisini değiştirmeyi gerektiren bir sunucu sözleşmesi yoktur.
- CI, yeni ok çizim testini hem Chromium hem WebKit ile; mevcut ağ, mobil kontrol, render bütçesi ve Cloudflare çok oyunculu testleriyle birlikte çalıştırır. Yayın işleri yalnızca `main` için açıktır.

Uzun bağlantı kesintisinde okları sınırsız ilerletmek yerine görsel devam sınırlandırılır. İsabet, hasar, ok ömrü ve çarpışma kararı her zaman sunucudadır.
