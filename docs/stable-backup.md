# Büyük geliştirmeler öncesi kararlı sürüm yedeği

## 24 Ekim 2026 — FPS/ping göstergesi ve ağ saati düzeltmesinden önce

`3d07703832ceccccb3fc8b58bb4d8117d6712cc0`, [`backup/pre-live-diagnostics-3d07703`](https://github.com/artemis34/orman-arrow-archer/tree/backup/pre-live-diagnostics-3d07703) etiketiyle korunur. [Gösterge, ölçüm ve düzeltme raporu](live-diagnostics-2026-10-24.md).

## 24 Ekim 2026 — yeni FPS geçişinden önce

Önceki doğrulanmış sürüm `ab4fed8eeb083b2de43c9def6f64e29ef94a1d93`, [`backup/pre-fps-pass-ab4fed8`](https://github.com/artemis34/orman-arrow-archer/tree/backup/pre-fps-pass-ab4fed8) etiketiyle korunur. Yerel tam geçmiş yedeği `/workspace/backups/wildbow-before-frame-pacing-ab4fed8.bundle` doğrulandı. [FPS değişiklikleri ve ölçüm sınırları](fps-optimization-2026-10-24.md).

## 23 Ekim 2026 — tek el varsayılanından önce

Çalışan kaynak sürümü `b23ed9151355e43ad2cd57482999d1adc65db2b4`, değişikliklerden önce GitHub'a [`backup/pre-onehand-default-b23ed91`](https://github.com/artemis34/orman-arrow-archer/tree/backup/pre-onehand-default-b23ed91) etiketiyle yedeklendi. Yerelde tam geçmişi içeren ve doğrulanan `/workspace/backups/wildbow-pre-onehand-default-b23ed91.bundle` dosyası da var. Etiketi yeni bir dala açmak geçmişi veya mevcut dalı silmez:

```sh
git switch -c restore/pre-onehand backup/pre-onehand-default-b23ed91
```

[Yeni geliştirme kapsamı ve ölçümler](onehand-release.md). Aşağıdaki 19 Ekim yedeği ayrıca korunur.

## 19 Ekim 2026 — ilk geliştirme planından önce

Yedek tarihi: 19 Ekim 2026. Amaç: geliştirme planı ve merkez joystick'li tek el deneyi öncesindeki test edilmiş oyuna dönebilmek ve oynanışı karşılaştırabilmek.

## Sabit referanslar

| Yedek                        | Referans                           | Commit                                     |
| ---------------------------- | ---------------------------------- | ------------------------------------------ |
| Kaynak etiketi               | `backup-before-roadmap-2026-10-19` | `78235b204b4cb2d0bf393fdbe488a957302868d7` |
| Kaynak yedek dalı            | `backup/pre-roadmap-2026-10-19`    | `78235b204b4cb2d0bf393fdbe488a957302868d7` |
| Derlenmiş botlu oyun etiketi | `backup-playable-2026-10-19`       | `5c0edd682d0883a71570f8ce58f5a1c52a96f088` |

- [GitHub kaynak yedeği](https://github.com/artemis34/orman-arrow-archer/tree/backup-before-roadmap-2026-10-19)
- [Kaynağı ZIP olarak indir](https://github.com/artemis34/orman-arrow-archer/archive/refs/tags/backup-before-roadmap-2026-10-19.zip)
- [Sabit oynanabilir botlu arşiv](https://rawcdn.githack.com/artemis34/orman-arrow-archer/5c0edd682d0883a71570f8ce58f5a1c52a96f088/index.html)
- [Başarılı test ve yayın çalışması](https://github.com/artemis34/orman-arrow-archer/actions/runs/39253908928)

Derlenmiş arşivin commit mesajı `deploy: 1a07271...` şeklindedir. `78235b2` ile `1a07271` arasındaki değişiklik yalnızca canlı tarayıcı testinin çıkış/ölüm geçişini düzeltir; uygulama dosyaları aynıdır. Botlu arşiv, kaynak yedeğinin oynanışını korur.

## Kapsam

Kaynak yedeği istemci, Node/Cloudflare sunucuları, ortak oyun kuralları, testler, yayın yapılandırmaları ve kilitli bağımlılık dosyasını içerir. Derlenmiş arşiv tarayıcıda botlarla eski oynanışı karşılaştırmayı sağlar.

Bu sürümde 150 başlangıç canı, 15 temel hasar, mevcut yetenekler/XP/güç noktaları, düzeltilmiş yürüyüş ve isteğe bağlı OTO düğmesi vardır. Hareket joystick'i sol alttadır. Merkez joystick ve dokunarak hedef kilidi içeren yeni deney henüz bu sürümde yoktur.

Oynanabilir arşiv botlu antrenmandır; eski bir çevrimiçi sunucuyu ayrıca çalıştırmaz. Üretim Cloudflare adresi gelecekteki yayınlarla güncellenebilir. Anlık oda/oyuncu ilerlemesi bellektedir ve bu kaynak yedeğinin parçası değildir.

## Güvenli geri dönüş

Mevcut çalışmanın üzerine yazmadan ayrı bir geri dönüş dalı oluşturulur:

```sh
git fetch origin tag backup-before-roadmap-2026-10-19
git switch -c restore/pre-roadmap-2026-10-19 backup-before-roadmap-2026-10-19
git rev-parse HEAD
# 78235b204b4cb2d0bf393fdbe488a957302868d7
npm ci
npm test
npm run check
npm run build
```

Cloudflare için `npm run build:cloudflare` ve yerel ağ/tarayıcı kontrolleri kullanılabilir. Üretime geri dönüş gerektiğinde doğrulanan sürüm mevcut Cloudflare projesinde yayımlanır; main geçmişini zorla değiştirmek gerekmez.

Cloudflare ağ/oda güncellemesi ek bir `v2` eşleştirme sınıfı migrasyonu getirir. Bu kaynak etiketi bulut hesabındaki migration geçmişini geri almaz. Bu güncellemeden sonra üretimde eski oynanışa dönülürken mevcut Durable Object sınıf dışa aktarımları, binding'ler ve migration geçmişi korunarak uyumlu bir geri dönüş derlemesi hazırlanmalıdır. Eski etiketteki Wrangler dosyasını doğrudan yeniden yayınlamak güvenilir bir migration geri alma yöntemi değildir. Sabit botlu arşiv bu altyapıdan bağımsızdır.

## Taşınabilir yerel kopya

Ek kopya: `/workspace/backups/wildbow-before-roadmap-2026-10-19.bundle`. Üç yedek referansını ve tam Git geçmişini içerir. Yanındaki `.sha256` dosyası bütünlük kontrolü sağlar.

```sh
cd /workspace/backups
sha256sum -c wildbow-before-roadmap-2026-10-19.bundle.sha256
git clone --branch backup/pre-roadmap-2026-10-19 wildbow-before-roadmap-2026-10-19.bundle wildbow-restored
```

Bundle bütünlüğü ve geçici klasöre geri yükleme yedek oluşturulurken doğrulanır. GitHub etiketleri ve yedek dalı da ayrı bir kopya olarak saklanır.

[Geliştirme planı](development-roadmap.md), `planning/gameplay-roadmap` dalında kayıtlıdır.
