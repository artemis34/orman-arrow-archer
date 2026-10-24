import { selectControlMode } from "./helpers/control-mode.js";
import { setPlayerName } from "./helpers/identity.js";
import { installFloatingGestures } from "./helpers/floating-gestures.js";
import { chromium, webkit, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { annotateFailure } from "./report.js";
import { SnapshotDecoder, decodeInputs } from "../shared/protocol.js";
const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
const room = `ui-${Date.now().toString(36)}`;
const browserType = engine === "webkit" ? webkit : chromium;
const launchOptions = {
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
};
const browsers = [];
const errors = [];
const probes = new Map();
async function open(mobile, name) {
  // Real desktop/phone clients have independent browser/GPU processes. Keep
  // cold shader compilation from queuing both renderers through one shared
  // browser GPU process when this test uses software rendering.
  const browser = await browserType.launch(launchOptions);
  browsers.push(browser);
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
  installFloatingGestures(page);
  page.on("pageerror", (e) => errors.push(e.message));
  // Observe actual browser WebSocket traffic; the app exposes no debug world.
  page.on("websocket", (socket) => {
    const decoder = new SnapshotDecoder();
    socket.on("framesent", ({ payload }) => {
      try {
        const packet =
          typeof payload === "string"
            ? JSON.parse(payload)
            : { type: "input", data: decodeInputs(payload).at(-1) };
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
        packet =
          typeof payload === "string"
            ? JSON.parse(payload)
            : { type: "state", data: decoder.decode(payload) };
      } catch {
        return;
      }
      if (packet.type === "welcome") probe.id = packet.data.id;
      if (packet.type === "state") {
        probe.state = packet.data;
        probe.events.push(...packet.data.events);
        for (const player of packet.data.roster || packet.data.players)
          probe.seen.add(player.id);
      }
    });
  });
  await page.bringToFront();
  // Exercise the shipped two-human duel, including its real matchmaking rules.
  // Confirm the document response committed, then gate on the real app below.
  // Browser lifecycle delivery can be delayed by a cold WebGL renderer; neither
  // load nor DOMContentLoaded establishes that this multiplayer app is ready.
  // Keep explicit lobby, completed-frame and authoritative-join deadlines,
  // including on the deliberately slow second renderer.
  await page.goto(`${base}/?room=${room}&format=duel`, {
    waitUntil: "commit",
  });
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await expect(page.locator("#lobby")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#online-mode")).toHaveClass(/selected/);
  await expect(page.locator("#room-code")).toHaveValue(room);
  await expect(page.locator("#server-address")).toBeHidden();
  await setPlayerName(page, name);
  if (mobile) await selectControlMode(page, "classic");
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
  const activate = (selector, timeout = 5000) =>
    page.locator(selector)[touch ? "tap" : "click"]({ timeout });
  if (await page.locator("#death").isVisible()) await activate("#back-lobby");
  else {
    try {
      if (!(await page.locator("#leader-panel").isVisible()))
        await activate("#leaders-toggle");
      await activate("#exit", 5000);
    } catch (error) {
      // The arena keeps running while menus are open. A bot may kill this
      // player between the initial visibility check and the actual exit tap.
      if (!(await page.locator("#death").isVisible())) throw error;
      await activate("#back-lobby");
    }
  }
  await expect(page.locator("#lobby")).toBeVisible();
}
async function ready(client, touch = false) {
  await client.page.bringToFront();
  const activate = (selector) =>
    client.page.locator(selector)[touch ? "tap" : "click"]();
  // This is a live arena: bots continue fighting while the other WebGL browser
  // compiles shaders. Resume through the same death/respawn flow as a player.
  if (!client.me()?.alive) {
    await expect(client.page.locator("#death")).toBeVisible();
    await expect(client.page.locator("#respawn")).toBeEnabled({
      timeout: 6000,
    });
    await activate("#respawn");
    await expect.poll(() => client.me()?.alive).toBe(true);
    await expect(client.page.locator("#death")).toBeHidden();
  }
  for (let n = 0; n < 4 && client.me()?.choices.length; n++) {
    const before = client.me().pending;
    await activate("#upgrade-options button:first-child");
    await expect.poll(() => client.me()?.pending).toBeLessThan(before);
  }
  if (client.me()?.hp < 100 && client.me()?.healCd <= 0) {
    await activate("#heal");
    await expect.poll(() => client.me()?.healCd).toBeGreaterThan(0);
  }
}
try {
  const a = await open(false, "CF Desktop"),
    b = await open(true, "CF Mobile");
  const status = await (await fetch(`${base}/api/rooms/${room}/status`)).json();
  assert.equal(status.humans, 2);
  assert.equal(status.capacity, 2);
  assert.notEqual(a.probe.id, b.probe.id);
  await expect.poll(() => a.probe.state?.match?.phase).toBe("playing");
  assert.equal(a.probe.state.roster.filter((p) => p.bot).length, 0);
  await ready(a);
  await a.page.locator("#emote-toggle").click();
  await expect(a.page.locator("#emote-options")).toBeVisible();
  await a.page.locator('[data-emote="heart"]').click();
  await expect(a.page.locator("#emote-options")).toBeHidden();
  await expect
    .poll(() =>
      b.probe.events.some(
        (event) =>
          event.type === "emote" &&
          event.owner === a.probe.id &&
          event.key === "heart",
      ),
    )
    .toBe(true);
  await b.page.locator("#emote-toggle").tap();
  await b.page.locator('[data-emote="gg"]').tap();
  await expect
    .poll(() =>
      a.probe.events.some(
        (event) =>
          event.type === "emote" &&
          event.owner === b.probe.id &&
          event.key === "gg",
      ),
    )
    .toBe(true);
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
  await ready(b, true);
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
  await ready(b, true);
  await b.page.locator("#auto-fire").tap();
  await expect(b.page.locator("#auto-fire")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => b.probe.inputs.at(-1)?.data.autoFire).toBe(true);
  await b.page.locator("#auto-fire").tap();
  await expect.poll(() => b.probe.inputs.at(-1)?.data.autoFire).toBe(false);
  await ready(b, true);
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
    `CLOUDFLARE_BROWSER_OK ${engine}: two real desktop/mobile browser players, shared authoritative shots/actors, rate-limited emoji over native WebSocket, automatic-fire toggle, joystick movement, map, landscape, invitation URL and empty-room shutdown.`,
  );
} catch (error) {
  const diagnostics = [];
  for (const [i, page] of browsers
    .flatMap((browser) => browser.contexts())
    .flatMap((context) => context.pages())
    .entries()) {
    diagnostics.push({
      page: i,
      url: page.url(),
      loadingVisible: await page
        .locator("#loading")
        .isVisible()
        .catch(() => null),
      lobbyVisible: await page
        .locator("#lobby")
        .isVisible()
        .catch(() => null),
      documentState: await page
        .evaluate(() => document.readyState)
        .catch(() => null),
      performance: await page
        .evaluate(() => {
          const navigation = performance.getEntriesByType("navigation")[0];
          return {
            now: performance.now(),
            completedFrames: window.__completedFrames,
            navigation: navigation
              ? {
                  responseStart: navigation.responseStart,
                  responseEnd: navigation.responseEnd,
                  domInteractive: navigation.domInteractive,
                  domContentLoadedEventStart:
                    navigation.domContentLoadedEventStart,
                  loadEventStart: navigation.loadEventStart,
                  duration: navigation.duration,
                }
              : null,
          };
        })
        .catch(() => null),
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
  await Promise.all(browsers.map((browser) => browser.close()));
}
