/** Legacy scenarios describe a direction at pointerdown. Express that as a
 * real press-at-centre followed by a drag for the new floating controllers.
 * Dedicated floating-origin tests use raw CDP and do not use this adapter. */
export function installFloatingGestures(page) {
  const find = async (points) =>
    page.evaluate(
      (points) =>
        points.map((p) => {
          const stick = document
            .elementFromPoint(p.x, p.y)
            ?.closest(".joystick");
          if (!stick) return p;
          const b = stick.getBoundingClientRect();
          return { ...p, x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }),
      points,
    );
  const context = page.context(),
    create = context.newCDPSession.bind(context);
  context.newCDPSession = async (target) => {
    const cdp = await create(target);
    if (target !== page) return cdp;
    const send = cdp.send.bind(cdp),
      active = new Set();
    cdp.send = async (method, params) => {
      if (method !== "Input.dispatchTouchEvent") return send(method, params);
      const points = params.touchPoints || [];
      if (params.type === "touchStart") {
        const newPoints = points.filter((p) => !active.has(p.id)),
          centres = await find(newPoints),
          byId = new Map(centres.map((p) => [p.id, p]));
        const starts = points.map((p) => byId.get(p.id) || p);
        await send(method, { ...params, touchPoints: starts });
        newPoints.forEach((p) => active.add(p.id));
        if (starts.some((p, i) => p.x !== points[i].x || p.y !== points[i].y))
          await send(method, {
            ...params,
            type: "touchMove",
            touchPoints: points,
          });
        return;
      }
      if (params.type === "touchCancel" || params.type === "touchEnd") {
        if (points.length) points.forEach((p) => active.delete(p.id));
        else active.clear();
      }
      return send(method, params);
    };
    return cdp;
  };
  const move = page.mouse.move.bind(page.mouse),
    down = page.mouse.down.bind(page.mouse);
  let pointer = { x: 0, y: 0 };
  page.mouse.move = async (x, y, options) => {
    pointer = { x, y };
    return move(x, y, options);
  };
  page.mouse.down = async (options) => {
    const [centre] = await find([pointer]);
    const end = { ...pointer };
    if (centre.x !== end.x || centre.y !== end.y) {
      await move(centre.x, centre.y);
      await down(options);
      await move(end.x, end.y);
      return;
    }
    return down(options);
  };
}
