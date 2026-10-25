/** Non-blocking first-match guidance, advanced by real authoritative gameplay. */
export class FirstGameTutorial {
  constructor({ get, set, root, title, note, skip }) {
    Object.assign(this, { get, set, root, title, note });
    this.step = 0;
    this.active = false;
    skip.addEventListener("click", () => this.finish());
  }
  start(onehand, progression = true) {
    this.total = progression ? 4 : 3;
    this.onehand = onehand;
    this.step = 0;
    this.origin = null;
    this.active = this.get("wildbow-tutorial-v1") !== "done";
    this.render();
  }
  finish() {
    this.active = false;
    this.set("wildbow-tutorial-v1", "done");
    this.render();
  }
  stop() {
    this.active = false;
    this.render();
  }
  observe(me) {
    if (!this.active) return;
    if (!me?.alive) {
      this.origin = null;
      return;
    }
    this.origin ||= { x: me.x, z: me.z };
    const complete = [
      Math.hypot(me.x - this.origin.x, me.z - this.origin.z) > 2,
      me.dashCd > 0,
      me.shotCd > 0,
      Object.keys(me.upgrades).length > 0,
    ][this.step];
    if (complete) {
      this.step++;
      if (this.step === this.total) {
        this.finish();
        return;
      }
      this.render();
    }
  }
  render() {
    this.root.classList.toggle("hidden", !this.active);
    if (!this.active) return;
    const steps = this.onehand
      ? [
          [
            "Hareket et",
            "Ekranın alt bölümüne dokun, joystick’i çekerek yürü.",
          ],
          [
            "Atılmayı dene",
            "Biraz daha çek: o yönde ϟ hedefi çıkar. Parmağını hedefe götür.",
          ],
          [
            "İlk okunu at",
            "Yakındaki rakibe yaklaş. Otomatik nişan ve atış hazır; rakibe dokunarak kilitlenebilirsin.",
          ],
          [
            "Bir yetenek seç",
            "Kristalleri topla. Kartlar çıkınca parmağını kaldırmadan yeni yönde çek ve kısa bekle. Merkeze dönmek iptal eder.",
          ],
        ]
      : [
          ["Hareket et", "WASD / ok tuşlarını veya sol joystick’i kullan."],
          ["Atılmayı dene", "Space, sağ tık veya ϟ tuşu ile atıl."],
          [
            "İlk okunu at",
            "Fareyle nişan al, basılı tut ve bırak. Mobilde sağ joystick’i çekip bırak.",
          ],
          [
            "Bir yetenek seç",
            "Kristalleri topla, seviye atla. Kartlara dokun veya 1/2/3 tuşlarıyla seç.",
          ],
        ];
    this.title.textContent = `${this.step + 1}/${this.total} · ${steps[this.step][0]}`;
    this.note.textContent = steps[this.step][1];
  }
}
