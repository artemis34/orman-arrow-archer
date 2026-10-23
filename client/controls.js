import { selectTarget, aimedAngle, angleDelta } from "../shared/aim.js";
import { RULES, clamp } from "../shared/config.js";
import { TapDashDetector } from "./tap-dash.js";
/** A radial dead zone removes resting-thumb noise without snapping diagonals. */
export function stickVector(dx, dz, radius) {
  const length = Math.hypot(dx, dz);
  const dead = radius * 0.18;
  if (length <= dead) return { x: 0, z: 0 };
  const strength = Math.min(1, (length - dead) / (radius - dead));
  return { x: (dx / length) * strength, z: (dz / length) * strength };
}
/** Only a fresh press in the lower thumb area can create a floating pad.
 * Once captured, a drag remains free to cross the boundary without stopping. */
export function floatingStickStartAllowed(y, width, height) {
  if (!Number.isFinite(y) || width <= 0 || height <= 0) return false;
  return y >= height * (height >= width ? 0.6 : 0.5) && y <= height;
}
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
    this.quickShot = false;
    this.cancelShot = false;
    this.active = false;
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    this.releasedAim = null;
    this.autoFire = false;
    this.oneHanded = false;
    this.doubleTapDash = true;
    this.tapDash = new TapDashDetector();
    this.lastMoveJoy = { x: 0, z: 0 };
    this.dashVector = null;
    this.lockRequest = undefined;
    this.focused = !document.hidden;
    this.joy = { x: 0, z: 0 };
    this.aimJoy = { x: 0, z: 0 };
    this.stickResets = [];
    this.floatingSticks = [];
    this.isTouch = matchMedia("(pointer:coarse)").matches;
    let canvasTouch = null;
    canvas.addEventListener("pointerdown", (e) => {
      if (
        !this.active ||
        (e.pointerType !== "touch" && !this.oneHanded) ||
        canvasTouch ||
        e.button > 0
      )
        return;
      if (!this.oneHanded) return;
      // Lower empty-space taps belong to movement/double-tap dodge. They must
      // not clear an existing target lock or compete with the floating stick.
      if (
        floatingStickStartAllowed(e.clientY, innerWidth, innerHeight) &&
        !this.scene.pickPlayer(
          e.clientX,
          e.clientY,
          this.latestState?.players || [],
          this.latestMe?.id,
        )
      )
        return;
      this.tapDash.reset();
      if (e.pointerType === "touch") this.isTouch = true;
      this.audio.unlock();
      canvasTouch = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        time: e.timeStamp,
      };
      canvas.setPointerCapture(e.pointerId);
    });
    // The floating pad appears beneath the finger after pointerdown. On touch
    // browsers its release can target that pad; finish the original gesture
    // globally, still accepting only its captured pointer ID.
    addEventListener("pointerup", (e) => {
      if (canvasTouch?.id !== e.pointerId) return;
      if (
        this.active &&
        e.timeStamp - canvasTouch.time < 280 &&
        Math.hypot(e.clientX - canvasTouch.x, e.clientY - canvasTouch.y) < 14
      ) {
        if (this.oneHanded)
          this.lockRequest =
            this.scene.pickPlayer(
              e.clientX,
              e.clientY,
              this.latestState?.players || [],
              this.latestMe?.id,
            )?.id || null;
        else this.quickShot = true;
      }
      canvasTouch = null;
    });
    addEventListener("pointercancel", (e) => {
      if (canvasTouch?.id === e.pointerId) canvasTouch = null;
    });
    this.stickResets.push(() => {
      if (canvasTouch) {
        const id = canvasTouch.id;
        canvasTouch = null;
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      }
    });
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
        this.isTouch = false;
        this.mouse = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.active || e.pointerType !== "mouse") return;
      if (this.oneHanded && e.button === 0) return;
      this.isTouch = false;
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
    // Restrict browser gesture suppression to the active arena. Pointer events
    // still drive aiming and dodge; menus retain normal touch interaction.
    canvas.addEventListener("dblclick", (e) => {
      if (this.active && this.isTouch) e.preventDefault();
    });
    canvas.addEventListener(
      "touchend",
      (e) => {
        if (this.active && this.oneHanded && e.cancelable) e.preventDefault();
      },
      { passive: false },
    );
    addEventListener("blur", () => {
      this.focused = false;
      this.reset();
    });
    addEventListener("focus", () => (this.focused = !document.hidden));
    const resume = (event) => {
      // A real gesture can return focus before mobile browsers emit `focus`.
      // Existing held fingers stay reset; only fresh input resumes play.
      if (event.isTrusted && !document.hidden) this.focused = true;
    };
    addEventListener("pointerdown", resume, { capture: true });
    addEventListener("keydown", resume, { capture: true });
    document.addEventListener("visibilitychange", () => {
      this.focused = !document.hidden && document.hasFocus();
      if (document.hidden) this.reset();
    });
    document.getElementById("dash").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.tapDash.reset();
      if (this.active) {
        this.audio.unlock();
        this.dash = true;
      }
    });
    document.getElementById("heal").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.tapDash.reset();
      if (this.active) {
        this.audio.unlock();
        this.heal = true;
      }
    });
    this.stick("move-stick", false);
    this.stick("aim-stick", true);
    canvas.addEventListener("pointerdown", (e) => {
      if (
        !this.active ||
        (e.pointerType !== "touch" && !this.oneHanded) ||
        e.button > 0
      )
        return;
      if (
        this.oneHanded &&
        this.scene.pickPlayer(
          e.clientX,
          e.clientY,
          this.latestState?.players || [],
          this.latestMe?.id,
        )
      )
        return;
      const leftHanded = document.body.classList.contains("left-handed");
      const move =
        this.oneHanded ||
        (leftHanded ? e.clientX >= innerWidth / 2 : e.clientX < innerWidth / 2);
      this.floatingSticks[move ? 0 : 1]?.begin(e, canvas);
    });
  }
  reset() {
    this.tapDash?.reset();
    this.dashVector = null;
    this.lastMoveJoy = { x: 0, z: 0 };
    this.cancelShot ||= this.charge;
    for (const release of this.stickResets) release();
    this.releasedAim = null;
    this.lockRequest = null;
    this.quickShot = false;
    this.keys.clear();
    this.charge = false;
    this.dash = false;
    this.heal = false;
    this.joy = { x: 0, z: 0 };
    this.aimJoy = { x: 0, z: 0 };
    for (const k of document.querySelectorAll(".stick-knob"))
      k.style.transform = "";
  }
  setAutoFire(enabled) {
    this.autoFire = enabled === true;
  }
  setDoubleTapDash(enabled) {
    this.doubleTapDash = enabled !== false;
    this.tapDash.reset();
  }
  setOneHanded(enabled) {
    this.reset();
    this.oneHanded = enabled === true;
    if (this.oneHanded) this.autoFire = true;
  }
  stick(id, aim) {
    const el = document.getElementById(id),
      knob = el.querySelector(".stick-knob");
    let pointer = null,
      dragged = false,
      pressedAt = 0,
      startX = 0,
      startY = 0;
    let captureTarget = el;
    const update = (e) => {
      const r = el.getBoundingClientRect(),
        radius = r.width * 0.35,
        dx = e.clientX - startX,
        dz = e.clientY - startY,
        l = Math.hypot(dx, dz),
        scale = l > radius ? radius / l : 1;
      const vector = stickVector(dx, dz, radius);
      knob.style.transform = `translate(${dx * scale}px,${dz * scale}px)`;
      if (aim) {
        if (vector.x || vector.z) {
          this.aimJoy = vector;
          this.releasedAim = null;
          if (!this.charge) this.audio.play("charge");
          this.charge = true;
        }
      } else {
        this.joy = vector;
        if (vector.x || vector.z) this.lastMoveJoy = { ...vector };
      }
    };
    const begin = (e, target = el) => {
      if (
        pointer !== null ||
        !this.active ||
        !floatingStickStartAllowed(e.clientY, innerWidth, innerHeight)
      )
        return;
      e.preventDefault();
      this.audio.unlock();
      this.isTouch = true;
      dragged = false;
      pressedAt = e.timeStamp;
      startX = e.clientX;
      startY = e.clientY;
      captureTarget = target;
      el.style.setProperty("--floating-x", `${startX}px`);
      el.style.setProperty("--floating-y", `${startY}px`);
      el.classList.add("floating-origin");
      pointer = e.pointerId;
      captureTarget.setPointerCapture(pointer);
      update(e);
    };
    this.floatingSticks.push({ begin });
    el.addEventListener("pointerdown", (e) => begin(e));
    addEventListener("pointermove", (e) => {
      if (e.pointerId === pointer) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8)
          dragged = true;
        update(e);
      }
    });
    const release = () => {
      const captured = pointer;
      pointer = null;
      if (captured !== null && captureTarget.hasPointerCapture(captured))
        captureTarget.releasePointerCapture(captured);
      el.classList.remove("floating-origin");
      knob.style.transform = "";
      if (aim) {
        this.charge = false;
        this.aimJoy = { x: 0, z: 0 };
      } else this.joy = { x: 0, z: 0 };
    };
    this.stickResets.push(release);
    const end = (e) => {
      if (pointer === e.pointerId) {
        if (!aim && this.oneHanded && this.doubleTapDash) {
          const dash = this.tapDash.release({
            x: e.clientX,
            y: e.clientY,
            startedAt: pressedAt,
            endedAt: e.timeStamp,
            dragged,
            cancelled: e.type !== "pointerup",
            pointerType: e.pointerType,
          });
          if (dash && this.active) {
            this.dash = true;
            this.dashVector = { ...this.lastMoveJoy };
          }
        }
        // Keep the release direction for the shot, then return the torso to
        // walking. A sticky aiming flag used to lock it after the first touch.
        if (aim)
          this.releasedAim =
            e.type === "pointerup" && this.charge ? { ...this.aimJoy } : null;
        if (aim && e.type !== "pointerup" && this.charge)
          this.cancelShot = true;
        if (
          aim &&
          e.type === "pointerup" &&
          !dragged &&
          e.timeStamp - pressedAt < 280 &&
          this.active
        )
          this.quickShot = true;
        release();
      }
    };
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
    addEventListener("lostpointercapture", end);
  }
  sample(me, state, obstacles = []) {
    this.latestMe = me;
    this.latestState = state;
    const active = this.active && this.focused !== false;
    const manualAim = this.charge ? this.aimJoy : this.releasedAim;
    let movement = this.joy;
    if (this.dash && this.dashVector && !(movement.x || movement.z))
      movement = this.dashVector;
    if (me && this.isTouch && (movement.x || movement.z)) {
      const direction = this.scene.aimFromStick(movement.x, movement.z, me);
      const strength = Math.hypot(movement.x, movement.z);
      movement = {
        x: Math.cos(direction) * strength,
        z: Math.sin(direction) * strength,
      };
    }
    let x =
        movement.x +
        (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
        (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0),
      z =
        movement.z +
        (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0) -
        (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0),
      len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    if (me) {
      if (this.isTouch) {
        if (manualAim && (manualAim.x || manualAim.z))
          this.angle = this.scene.aimFromStick(manualAim.x, manualAim.z, me);
        else if (len > 0) this.angle = Math.atan2(z, x);
      } else this.angle = this.scene.aimAt(this.mouse.x, this.mouse.y, me);
    }
    let angle = this.angle;
    if (me?.alive && state) {
      const automatic = this.autoFire && !this.charge && !manualAim;
      if (this.quickShot) {
        const target = selectTarget(me, state.players, obstacles);
        if (target) {
          angle = this.angle = aimedAngle(
            me,
            target,
            19 + RULES.quickShotCharge * 23,
            obstacles,
          );
        } else this.onNoTarget?.();
      } else if (automatic) {
        const locked =
          me.lockedTargetId &&
          state.players.find((p) => p.id === me.lockedTargetId);
        const target =
          (locked && selectTarget(me, [locked], obstacles)) ||
          selectTarget(me, state.players, obstacles);
        if (target)
          angle = this.angle = aimedAngle(
            me,
            target,
            19 + RULES.quickShotCharge * 23,
            obstacles,
          );
      } else if (this.isTouch && this.charge) {
        const target = selectTarget(me, state.players, obstacles, {
          angle,
          cone: 0.16,
        });
        if (target)
          angle +=
            clamp(
              angleDelta(
                aimedAngle(me, target, 19 + me.charge * 23, obstacles),
                angle,
              ),
              -0.12,
              0.12,
            ) * 0.35;
      }
    }
    const input = {
      x: active ? x : 0,
      z: active ? z : 0,
      angle,
      charge: active && this.charge,
      dash: active && this.dash,
      heal: active && this.heal,
      quickShot: active && this.quickShot,
      // A blur/help reset must still cancel an existing draw while inactive.
      cancelShot: !!this.cancelShot,
      autoFire: active && this.autoFire && !!me?.alive,
      lockTarget: this.lockRequest,
    };
    this.dash = false;
    this.dashVector = null;
    this.heal = false;
    this.quickShot = false;
    this.cancelShot = false;
    this.releasedAim = null;
    this.lockRequest = undefined;
    return input;
  }
}
