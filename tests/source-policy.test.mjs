import test from "node:test";
import assert from "node:assert/strict";
import { SourcePolicy } from "../.tests-build/source-policy.js";
import { Operation } from "../.tests-build/operation.js";

test("429 cooldown follows Retry-After and affects a source across batches, not other hosts", async () => {
  const policy = new SourcePolicy();
  const clock = Date.now;
  let now = 100000;
  Date.now = () => now;
  try {
    policy.failed("https://dblp.org/search", {
      status: 429,
      xmlhttp: { getResponseHeader: () => "120" },
    });
    const operation = new Operation();
    await assert.rejects(
      policy.acquire("https://dblp.dagstuhl.de/search", operation),
      (error) => error.status === 429 && error.cooldown,
    );
    const release = await policy.acquire(
      "https://other.test/search",
      operation,
    );
    release();
    now += 119000;
    await assert.rejects(
      policy.acquire("https://dblp.org/search", new Operation()),
      /rate-limited/,
    );
    now += 1001;
    (await policy.acquire("https://dblp.org/search", new Operation()))();
  } finally {
    Date.now = clock;
  }
});

test("request slots are serialized and cancelling a queued request does not stall its successor", async () => {
  const policy = new SourcePolicy();
  const owner = new Operation();
  const release = await policy.acquire("https://example.test/one", owner);
  const queued = new Operation();
  const waiting = policy.acquire("https://example.test/two", queued);
  const rejected = assert.rejects(waiting, /cancelled/);
  queued.cancel();
  await rejected;
  let acquired = false;
  const successor = policy
    .acquire("https://example.test/three", new Operation())
    .then((done) => {
      acquired = true;
      return done;
    });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(acquired, false);
  release();
  (await successor)();
});

test("successful JSON cache expires, stays bounded and clears on shutdown", () => {
  const policy = new SourcePolicy();
  const clock = Date.now;
  let now = 100000;
  Date.now = () => now;
  try {
    for (let i = 0; i < 140; i++) policy.remember(String(i), "{}");
    assert.equal(policy.cached("0"), undefined);
    assert.equal(policy.cached("139"), "{}");
    policy.remember("large", "x".repeat(1024 * 1024 + 1));
    assert.equal(policy.cached("large"), undefined);
    now += 300001;
    assert.equal(policy.cached("139"), undefined);
    policy.remember("new", "{}");
    policy.clear();
    assert.equal(policy.cached("new"), undefined);
  } finally {
    Date.now = clock;
  }
});
