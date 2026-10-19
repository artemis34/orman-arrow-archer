import { chromium, webkit, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { annotateFailure } from "./report.js";
const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
const room = `ui-${Date.now().toString(36)}`;
const browser = await (engine === "webkit" ? webkit : chromium).launch({
  headless: true,
  ...(engine === "chromium"
    ? {
        executablePath:
          process.env.CHROMIUM_PATH ||
          (existsSync("/usr/bin/chromium")
            ? "/usr/bin/chromium"
            : chromium.executablePath()),
        args: [
          "--no-sandbox",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ],
      }
    : {}),
});
const errors = [];
const probes = new Map();
async function open(mobile, name) {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  await page.addInitScript((slow) => {
    const nativeFrame = window.requestAnimationFrame.bind(window);
    window.__completedFrames = 0;
    window.requestAnimationFrame = (callback) =>
      nativeFrame((at) => {
        const run = () => {
          callback(slow ? performance.now() : at);
          window.__completedFrames++;
        };
        if (slow) setTimeout(run, 400);
        else run();
      });
  }, mobile);
  const probe = {
    id: null,
    state: null,
    events: [],
    seen: new Set(),
    inputs: [],
    maxDrawGap: 0,
    lastInputAt: 0,
  };
  probes.set(page, probe);
  page.on("pageerror", (e) => errors.push(e.message));
  // Observe actual browser WebSocket traffic; the app exposes no debug world.
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      try {
        const packet = JSON.parse(String(payload));
        if (packet.type !== "input") return;
        const at = Date.now();
        const previous = probe.inputs.at(-1);
        if (previous?.data.charge)
          probe.maxDrawGap = Math.max(probe.maxDrawGap, at - probe.lastInputAt);
        probe.lastInputAt = at;
        probe.inputs.push({ at, data: packet.data });
        if (probe.inputs.length > 240) probe.inputs.shift();
      } catch {}
    });
    socket.on("framereceived", ({ payload }) => {
      let packet;
      try {
        packet = JSON.parse(String(payload));
      } catch {
        return;
      }
      if (packet.type === "welcome") probe.id = packet.data.id;
      if (packet.type === "state") {
        probe.state = packet.data;
        probe.events.push(...packet.data.events);
        for (const player of packet.data.players) probe.seen.add(player.id);
      }
    });
  });
  await page.bringToFront();
  await page.goto(`${base}/?room=${room}`);
  await expect(page.locator("#lobby")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#online-mode")).toHaveClass(/selected/);
  await expect(page.locator("#room-code")).toHaveValue(room);
  await expect(page.locator("#server-address")).toBeHidden();
  await page.locator("#player-name").fill(name);
  await page.locator("#play").click();
  // The native transport allows 12 seconds for the handshake; a 5 second
  // assertion can fail prematurely on a cold or slow browser runner.
  await expect(page.locator("#hud")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#connection")).toHaveText("ONLINE");
  await expect.poll(() => probe.id).toBeTruthy();
  // HUD visibility does not mean the first WebGL frame/shader compilation has
  // finished. Warm the two scenes before testing a held draw against the
  // 350 ms input watchdog, while retaining the mobile's slow frame cadence.
  await page.evaluate(() => {
    window.__completedFrames = 0;
  });
  await expect
    .poll(() => page.evaluate(() => window.__completedFrames), {
      timeout: 15000,
    })
    .toBeGreaterThan(1);
  return {
    context,
    page,
    probe,
    me: () => probe.state?.players.find((p) => p.id === probe.id),
  };
}
async function exit(page, touch) {
  const activate = (selector) =>
    page.locator(selector)[touch ? "tap" : "click"]();
  if (await page.locator("#death").isVisible()) await activate("#back-lobby");
  else {
    await activate("#leaders-toggle");
    await activate("#exit");
  }
  await expect(page.locator("#lobby")).toBeVisible();
}
try {
  const a = await open(false, "CF Desktop"),
    b = await open(true, "CF Mobile");
  const status = await (await fetch(`${base}/api/rooms/${room}/status`)).json();
  assert.equal(status.humans, 2);
  assert.notEqual(a.probe.id, b.probe.id);
  await a.page.mouse.move(900, 420);
  await a.page.mouse.down();
  await expect
    .poll(() => a.me()?.charge, { timeout: 6500 })
    .toBeGreaterThan(0.3);
  await a.page.mouse.up();
  await expect
    .poll(() =>
      a.probe.events.some((e) => e.type === "shot" && e.owner === a.probe.id),
    )
    .toBe(true);
  await expect
    .poll(() =>
      b.probe.events.some((e) => e.type === "shot" && e.owner === a.probe.id),
    )
    .toBe(true);
  const aim = await b.page.locator("#aim-stick").boundingBox();
  if (engine === "chromium") {
    const cd = await b.context.newCDPSession(b.page);
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 1, x: aim.x + aim.width / 2 + 30, y: aim.y + aim.height / 2 },
      ],
    });
    await expect
      .poll(() => b.me()?.charge, { timeout: 6500 })
      .toBeGreaterThan(0.65);
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    await b.page.mouse.move(aim.x + aim.width / 2 + 30, aim.y + aim.height / 2);
    await b.page.mouse.down();
    await expect
      .poll(() => b.me()?.charge, { timeout: 6500 })
      .toBeGreaterThan(0.65);
    await b.page.mouse.up();
  }
  await expect
    .poll(() =>
      a.probe.events.some((e) => e.type === "shot" && e.owner === b.probe.id),
    )
    .toBe(true);
  await expect.poll(() => a.probe.seen.has(b.probe.id)).toBe(true);
  await expect.poll(() => b.probe.seen.has(a.probe.id)).toBe(true);
  await b.page.locator("#auto-fire").tap();
  await expect(b.page.locator("#auto-fire")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => b.probe.inputs.at(-1)?.data.autoFire).toBe(true);
  await b.page.locator("#auto-fire").tap();
  await expect.poll(() => b.probe.inputs.at(-1)?.data.autoFire).toBe(false);
  const start = { x: b.me().x, z: b.me().z };
  const move = await b.page.locator("#move-stick").boundingBox();
  if (engine === "chromium") {
    const cd = await b.context.newCDPSession(b.page);
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 2, x: move.x + move.width / 2 + 25, y: move.y + move.height / 2 },
      ],
    });
    await expect
      .poll(() => Math.hypot(b.me().x - start.x, b.me().z - start.z), {
        timeout: 6500,
      })
      .toBeGreaterThan(0.3);
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    await b.page.keyboard.down("KeyD");
    await expect
      .poll(() => Math.hypot(b.me().x - start.x, b.me().z - start.z), {
        timeout: 6500,
      })
      .toBeGreaterThan(0.3);
    await b.page.keyboard.up("KeyD");
  }
  await b.page.locator("#map-toggle").tap();
  await expect(b.page.locator("#map-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await b.page.locator("#map-toggle").tap();
  await a.page.screenshot({
    path: `/tmp/archer-validation/cloudflare-${engine}-desktop.png`,
  });
  await b.page.screenshot({
    path: `/tmp/archer-validation/cloudflare-${engine}-phone.png`,
  });
  await b.page.setViewportSize({ width: 844, height: 390 });
  assert.ok(await b.page.locator("#move-stick").isVisible());
  assert.equal(
    await b.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(
    await b.page
      .locator("#arena")
      .evaluate((canvas) => canvas.getContext("webgl2").isContextLost()),
    false,
  );
  await b.page.screenshot({
    path: `/tmp/archer-validation/cloudflare-${engine}-landscape.png`,
  });
  await exit(a.page, false);
  await expect(a.page.locator("#room-code")).toHaveValue(room);
  assert.equal(new URL(a.page.url()).searchParams.get("room"), room);
  await exit(b.page, true);
  await expect
    .poll(
      async () =>
        (await (await fetch(`${base}/api/rooms/${room}/status`)).json())
          .ticking,
    )
    .toBe(false);
  assert.deepEqual(errors, []);
  console.log(
    `CLOUDFLARE_BROWSER_OK ${engine}: two real desktop/mobile browser players, shared authoritative shots/actors, automatic-fire toggle over the real WebSocket, joystick movement, map, landscape, invitation URL and empty-room shutdown.`,
  );
} catch (error) {
  const diagnostics = [];
  for (const [i, page] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries()) {
    diagnostics.push({
      page: i,
      url: page.url(),
      join: await page
        .locator("#join-status")
        .textContent()
        .catch(() => null),
      errors,
      me: probes
        .get(page)
        ?.state?.players.find((p) => p.id === probes.get(page)?.id),
      ownShots: probes
        .get(page)
        ?.events.filter(
          (e) => e.type === "shot" && e.owner === probes.get(page)?.id,
        ).length,
      maxDrawInputGap: probes.get(page)?.maxDrawGap,
      releaseInputs: probes
        .get(page)
        ?.inputs.filter(
          (p, n, all) =>
            p.data.cancelShot ||
            (n && all[n - 1].data.charge && !p.data.charge),
        )
        .map((p) => ({ at: p.at, data: p.data }))
        .slice(-4),
    });
    await page
      .screenshot({
        path: `/tmp/archer-validation/cloudflare-${engine}-failure-${i}.png`,
      })
      .catch(() => {});
  }
  error.stack += `\nEngine: ${engine}\nJoin diagnostics: ${JSON.stringify(diagnostics)}`;
  annotateFailure(error, `Cloudflare ${engine} desktop/mobile multiplayer`);
  throw error;
} finally {
  await browser.close();
}
