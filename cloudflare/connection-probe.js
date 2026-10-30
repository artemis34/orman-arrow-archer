/** Short, isolated echo: no player, reservation, world, tick or profile write. */
export function connectionProbe(request, context) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    return new Response("WebSocket connection required", { status: 426 });
  const [client, server] = Object.values(new WebSocketPair());
  let count = 0,
    closed = false;
  const deadline = setTimeout(() => close(1000, "test complete"), 25000);
  function close(code, reason) {
    if (closed) return;
    closed = true;
    clearTimeout(deadline);
    try {
      server.close(code, reason);
    } catch {}
  }
  server.addEventListener("close", () => close(1000, "test complete"));
  server.addEventListener("error", () => close(1011, "probe error"));
  server.addEventListener("message", ({ data }) => {
    if (typeof data !== "string" || data.length > 128 || ++count > 24) {
      close(1008, "probe limit");
      return;
    }
    try {
      const packet = JSON.parse(data);
      if (
        packet.type !== "probe" ||
        !Number.isInteger(packet.id) ||
        packet.id < 0 ||
        packet.id > 24
      )
        return;
      server.send(JSON.stringify({ type: "probe", id: packet.id }));
    } catch {}
  });
  server.accept();
  server.send(
    JSON.stringify({
      type: "ready",
      ...(context
        ? context.kind === "edge"
          ? { route: context }
          : { context }
        : {}),
    }),
  );
  return new Response(null, { status: 101, webSocket: client });
}
