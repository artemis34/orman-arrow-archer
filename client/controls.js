export class Controls {
  constructor(canvas, scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.keys = new Set();
    this.x = 0;
    this.z = 0;
    this.angle = 0;
    this.charge = false;
    this.dash = false;
    this.heal = false;
    this.active = false;
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    this.touchAim = false;
    this.joy = { x: 0, z: 0 };
    addEventListener("keydown", (e) => {
      if (!this.active || /INPUT|TEXTAREA/.test(document.activeElement.tagName))
        return;
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code,
        )
      )
        e.preventDefault();
      this.keys.add(e.code);
      if (e.code === "Space" && !e.repeat) this.dash = true;
      if (e.code === "KeyE" && !e.repeat) this.heal = true;
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse") {
        this.mouse = { x: e.clientX, y: e.clientY };
        this.touchAim = false;
      }
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.active || e.pointerType !== "mouse") return;
      this.audio.unlock();
      if (e.button === 0) {
        this.charge = true;
        this.audio.play("charge");
      }
      if (e.button === 2) this.dash = true;
    });
    addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse" && e.button === 0) this.charge = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    addEventListener("blur", () => this.reset());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.reset();
    });
    document.getElementById("dash").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.active) {
        this.audio.unlock();
        this.dash = true;
      }
    });
    document.getElementById("heal").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.active) {
        this.audio.unlock();
        this.heal = true;
      }
    });
    this.stick("move-stick", false);
    this.stick("aim-stick", true);
  }
  reset() {
    this.keys.clear();
    this.charge = false;
    this.dash = false;
    this.heal = false;
    this.joy = { x: 0, z: 0 };
    for (const k of document.querySelectorAll(".stick-knob"))
      k.style.transform = "";
  }
  stick(id, aim) {
    const el = document.getElementById(id),
      knob = el.querySelector(".stick-knob");
    let pointer = null;
    const update = (e) => {
      const r = el.getBoundingClientRect(),
        radius = r.width * 0.35,
        dx = e.clientX - r.left - r.width / 2,
        dz = e.clientY - r.top - r.height / 2,
        l = Math.hypot(dx, dz),
        scale = l > radius ? radius / l : 1;
      knob.style.transform = `translate(${dx * scale}px,${dz * scale}px)`;
      if (aim) {
        if (l > 8) {
          this.touchAim = true;
          this.angle = Math.atan2(dz, dx);
          if (!this.charge) this.audio.play("charge");
          this.charge = true;
        }
      } else {
        this.joy = { x: (dx * scale) / radius, z: (dz * scale) / radius };
      }
    };
    el.addEventListener("pointerdown", (e) => {
      if (pointer !== null || !this.active) return;
      e.preventDefault();
      this.audio.unlock();
      pointer = e.pointerId;
      el.setPointerCapture(pointer);
      update(e);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId === pointer) update(e);
    });
    const end = (e) => {
      if (pointer !== e.pointerId) return;
      pointer = null;
      knob.style.transform = "";
      if (aim) this.charge = false;
      else this.joy = { x: 0, z: 0 };
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  }
  sample(me) {
    let x =
        this.joy.x +
        (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
        (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0),
      z =
        this.joy.z +
        (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0) -
        (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0),
      len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    if (me && !this.touchAim)
      this.angle = this.scene.aimAt(this.mouse.x, this.mouse.y, me);
    const input = {
      x: this.active ? x : 0,
      z: this.active ? z : 0,
      angle: this.angle,
      charge: this.active && this.charge,
      dash: this.active && this.dash,
      heal: this.active && this.heal,
    };
    this.dash = false;
    this.heal = false;
    return input;
  }
}
