import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROTOCOL,
  encodePacket,
  decodePacket,
  encodeInputs,
  decodeInputs,
  SnapshotEncoder,
  SnapshotDecoder,
} from "../shared/protocol.js";
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/protocol-v2-7397e49.json", import.meta.url)),
);
const plain = (value) => JSON.parse(JSON.stringify(value));
test("production v2 golden packets remain byte-identical and decode at nonzero buffer offsets", () => {
  assert.equal(PROTOCOL, fixture.protocol);
  for (const vector of fixture.cases) {
    const expected = Buffer.from(vector.base64, "base64"),
      actual = Buffer.from(encodePacket(vector.value));
    assert.deepEqual(actual, expected, vector.id);
    assert.deepEqual(plain(decodePacket(expected)), vector.decoded, vector.id);
    const padded = Buffer.concat([
      Buffer.from([9, 8, 7]),
      expected,
      Buffer.from([6, 5]),
    ]);
    assert.deepEqual(
      plain(decodePacket(padded.subarray(3, -2))),
      vector.decoded,
      vector.id,
    );
  }
});
test("production input bytes retain all flags, quantization rounding, ordered actions and explicit unlock", () => {
  for (const vector of fixture.inputs) {
    assert.equal(
      Buffer.from(encodeInputs(vector.inputs)).toString("base64"),
      vector.base64,
      vector.id,
    );
    assert.deepEqual(
      plain(decodeInputs(Buffer.from(vector.base64, "base64"))),
      vector.decoded,
      vector.id,
    );
  }
});
test("old production decoder/new encoder and old production packets/new decoder share the same baselines", () => {
  const encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder();
  for (const vector of fixture.snapshots) {
    while (encoder.count < (vector.encoderIndex || 0))
      encoder.encode(vector.state);
    const encoded = encoder.encode(vector.state);
    assert.equal(
      Buffer.from(encoded).toString("base64"),
      vector.base64,
      vector.id,
    );
    assert.deepEqual(
      plain(decoder.decode(Buffer.from(vector.base64, "base64"))),
      vector.decoded,
      vector.id,
    );
  }
});
test("production malformed-packet rejection is preserved", () => {
  for (const vector of fixture.malformed)
    assert.throws(
      () => decodePacket(Buffer.from(vector.base64, "base64")),
      (error) => error.message === vector.error,
      vector.id,
    );
});
test("encoded packets own their bytes across repeated floating-point encodes and reentrant getters", () => {
  const first = encodePacket([1.1, 2.2, 3.3]),
    copy = Buffer.from(first).toString("hex");
  const nested = {
    get value() {
      encodePacket([Math.PI, Math.E]);
      return 7.7;
    },
  };
  for (let i = 0; i < 100; i++) encodePacket([i / 7, nested, -i / 11]);
  assert.equal(Buffer.from(first).toString("hex"), copy);
  assert.deepEqual(decodePacket(encodePacket([1.1, nested, 2.2]))[0], 1.1);
});
