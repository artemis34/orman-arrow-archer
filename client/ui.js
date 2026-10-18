/** Native click remains for mouse/keyboard; touch also works with a held joystick.
 * Mobile browsers can suppress synthetic clicks when another finger is down.
 */
let lastTouchAction = -Infinity;
export function bindAction(button, action) {
  let finger = null;
  button.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" || finger || button.disabled) return;
    event.preventDefault();
    finger = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragged: false,
    };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener("pointermove", (event) => {
    if (
      finger?.id === event.pointerId &&
      Math.hypot(event.clientX - finger.x, event.clientY - finger.y) > 12
    )
      finger.dragged = true;
  });
  button.addEventListener("pointerup", (event) => {
    if (finger?.id !== event.pointerId) return;
    const activate = !finger.dragged && !button.disabled;
    finger = null;
    lastTouchAction = performance.now();
    event.preventDefault();
    if (activate) action();
  });
  const cancel = () => {
    finger = null;
  };
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("lostpointercapture", cancel);
  button.addEventListener("click", (event) => {
    if (
      event.pointerType === "touch" ||
      event.sourceCapabilities?.firesTouchEvents
    )
      return;
    // A touch can also produce a compatibility click marked as mouse (or with
    // no pointerType). Never toggle twice or pick a newly revealed card with it.
    if (event.detail !== 0 && performance.now() - lastTouchAction < 700) return;
    if (!button.disabled) action();
  });
}
