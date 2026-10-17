/** Native click remains for mouse/keyboard; touch also works with a held joystick.
 * Mobile browsers can suppress synthetic clicks when another finger is down.
 */
export function bindAction(button, action) {
  let finger = null,
    lastTouch = -Infinity;
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
    lastTouch = performance.now();
    event.preventDefault();
    if (activate) action();
  });
  const cancel = () => {
    finger = null;
  };
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("lostpointercapture", cancel);
  button.addEventListener("click", (event) => {
    if (event.detail !== 0 && performance.now() - lastTouch < 700) return;
    if (!button.disabled) action();
  });
}
