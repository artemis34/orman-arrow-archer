import test from "node:test";
import assert from "node:assert/strict";
import { warmupRenderer } from "../client/renderer-warmup.js";

function fixture(readyAt = 0) {
  let time = 0;
  let lost = false;
  const calls = [];
  const delays = [];
  const scene = {},
    camera = {};
  const program = {
    isReady() {
      calls.push(["ready", time]);
      return time >= readyAt;
    },
    getUniforms() {
      calls.push(["uniforms", time]);
    },
    getAttributes() {
      calls.push(["attributes", time]);
    },
  };
  const renderer = {
    info: { programs: [program] },
    debug: { checkShaderErrors: true },
    getContext() {
      return {
        isContextLost() {
          calls.push(["context", time]);
          return lost;
        },
      };
    },
    compile(actualScene, actualCamera) {
      assert.equal(actualScene, scene);
      assert.equal(actualCamera, camera);
      calls.push(["compile", time]);
    },
  };
  const options = {
    budgetMs: 50,
    now: () => time,
    async sleep(ms) {
      delays.push(ms);
      time += ms;
    },
  };
  return {
    renderer,
    scene,
    camera,
    program,
    calls,
    delays,
    options,
    time: () => time,
    advance(ms) {
      time += ms;
    },
    loseContext() {
      lost = true;
    },
  };
}

test("pending shaders become ready and prime bindings once without changing diagnostics", async () => {
  const f = fixture(30);
  const debug = { ...f.renderer.debug };
  assert.equal(
    await warmupRenderer(f.renderer, f.scene, f.camera, f.options),
    true,
  );
  assert.deepEqual(f.delays, [16, 16]);
  assert.deepEqual(
    f.calls.filter(([kind]) => kind === "ready"),
    [
      ["ready", 0],
      ["ready", 16],
      ["ready", 32],
    ],
  );
  assert.deepEqual(
    f.calls.filter(([kind]) => ["uniforms", "attributes"].includes(kind)),
    [
      ["uniforms", 32],
      ["attributes", 32],
    ],
  );
  assert.deepEqual(f.renderer.debug, debug);
  assert.equal(Object.hasOwn(f.renderer, "compileAsync"), false);
});

test("a never-ready program stops exactly at the deadline with no orphan sleep or probes", async () => {
  const f = fixture(Infinity);
  f.options.budgetMs = 35;
  assert.equal(
    await warmupRenderer(f.renderer, f.scene, f.camera, f.options),
    false,
  );
  assert.deepEqual(f.delays, [16, 16, 3]);
  assert.equal(f.time(), 35);
  assert.deepEqual(
    f.calls.filter(([kind]) => kind === "ready"),
    [
      ["ready", 0],
      ["ready", 16],
      ["ready", 32],
    ],
  );
  const completed = structuredClone(f.calls);
  await Promise.resolve();
  f.advance(10000);
  await Promise.resolve();
  assert.deepEqual(
    f.calls,
    completed,
    "no background readiness callback remains",
  );
  assert.equal(
    f.calls.some(([kind]) => kind === "uniforms"),
    false,
  );
});

test("context loss between polls stops before another readiness or binding call", async () => {
  const f = fixture(Infinity);
  f.options.sleep = async (ms) => {
    f.delays.push(ms);
    f.advance(ms);
    f.loseContext();
  };
  assert.equal(
    await warmupRenderer(f.renderer, f.scene, f.camera, f.options),
    false,
  );
  assert.deepEqual(f.delays, [16]);
  assert.deepEqual(
    f.calls.filter(([kind]) => kind === "ready"),
    [["ready", 0]],
  );
  assert.equal(
    f.calls.some(([kind]) => kind === "uniforms"),
    false,
  );
});

test("an already lost context does not start compilation", async () => {
  const f = fixture();
  f.loseContext();
  assert.equal(
    await warmupRenderer(f.renderer, f.scene, f.camera, f.options),
    false,
  );
  assert.deepEqual(f.calls, [["context", 0]]);
  assert.deepEqual(f.delays, []);
});

test("synchronous compilation errors propagate for the caller's normal loading fallback", async () => {
  const f = fixture();
  const error = new Error("driver compilation failed");
  f.renderer.compile = () => {
    throw error;
  };
  await assert.rejects(
    warmupRenderer(f.renderer, f.scene, f.camera, f.options),
    error,
  );
  assert.deepEqual(f.delays, []);
  assert.equal(
    f.calls.some(([kind]) => kind === "ready"),
    false,
  );
});

test("synchronous compile time consumes the readiness budget", async () => {
  const f = fixture();
  const compile = f.renderer.compile;
  f.renderer.compile = (...args) => {
    compile(...args);
    f.advance(51);
  };
  assert.equal(
    await warmupRenderer(f.renderer, f.scene, f.camera, f.options),
    false,
  );
  assert.deepEqual(f.delays, []);
  assert.equal(
    f.calls.some(([kind]) => kind === "ready"),
    false,
  );
});

test("missing readiness APIs fall back immediately without probing uniforms or sleeping", async () => {
  const f = fixture();
  delete f.program.isReady;
  assert.equal(
    await warmupRenderer(f.renderer, f.scene, f.camera, f.options),
    false,
  );
  assert.deepEqual(f.calls, [
    ["context", 0],
    ["compile", 0],
  ]);
  assert.deepEqual(f.delays, []);
  delete f.renderer.info.programs;
  assert.equal(
    await warmupRenderer(f.renderer, f.scene, f.camera, f.options),
    false,
  );
});

test("optional binding methods and the program list's later mutation remain safe", async () => {
  const f = fixture(16);
  delete f.program.getAttributes;
  f.options.sleep = async (ms) => {
    f.delays.push(ms);
    f.advance(ms);
    f.renderer.info.programs.push({});
  };
  assert.equal(
    await warmupRenderer(f.renderer, f.scene, f.camera, f.options),
    true,
  );
  assert.deepEqual(f.delays, [16]);
  assert.deepEqual(
    f.calls.filter(([kind]) => kind === "uniforms"),
    [["uniforms", 16]],
  );
});

test("binding failures propagate and never schedule another poll", async () => {
  const f = fixture();
  const error = new Error("uniform introspection failed");
  f.program.getUniforms = () => {
    throw error;
  };
  await assert.rejects(
    warmupRenderer(f.renderer, f.scene, f.camera, f.options),
    error,
  );
  assert.deepEqual(f.delays, []);
});

test("loss during binding setup avoids touching the remaining programs", async () => {
  const f = fixture();
  const ready = [];
  f.renderer.info.programs.push({
    isReady: () => true,
    getUniforms() {
      ready.push("second");
    },
  });
  f.program.getAttributes = () => f.loseContext();
  assert.equal(
    await warmupRenderer(f.renderer, f.scene, f.camera, f.options),
    false,
  );
  assert.deepEqual(ready, []);
  assert.deepEqual(f.delays, []);
});
