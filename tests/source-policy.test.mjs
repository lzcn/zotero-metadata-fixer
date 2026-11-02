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

test("Crossref search and DOI requests respect their different public limits", async () => {
  const policy = new SourcePolicy();
  const clock = Date.now;
  let now = 100000;
  Date.now = () => now;
  const operation = new Operation();
  const waits = [];
  operation.delay = async (ms) => {
    waits.push(ms);
    now += ms;
  };
  try {
    for (const path of [
      "works?query.title=one",
      "works?query.title=two",
      "works/10.1000/one",
      "works/10.1000/two",
      "works?query.title=three",
    ])
      (await policy.acquire("https://api.crossref.org/" + path, operation))();
    assert.deepEqual(waits, [1100, 1100, 250, 1100]);
  } finally {
    Date.now = clock;
  }
});

test("arXiv API and abstract requests share one paced queue", async () => {
  const policy = new SourcePolicy();
  const clock = Date.now;
  let now = 100000;
  Date.now = () => now;
  const operation = new Operation();
  operation.delay = async (ms) => {
    assert.equal(ms, 3000);
    now += ms;
  };
  try {
    (
      await policy.acquire(
        "https://export.arxiv.org/api/query?id_list=2501.01234",
        operation,
      )
    )();
    (await policy.acquire("https://arxiv.org/abs/2501.01234", operation))();
    assert.equal(now, 103000);
  } finally {
    Date.now = clock;
  }
});

test("403 and HTTP-200 challenges stop a source across batches without mirror hopping", async () => {
  for (const error of [{ status: 403 }, { blocked: true }]) {
    const policy = new SourcePolicy();
    policy.failed("https://dblp.org/search", error);
    await assert.rejects(
      policy.acquire("https://dblp.uni-trier.de/search", new Operation()),
      (error) => error.status === 403 && error.cooldown,
    );
    (await policy.acquire("https://api.crossref.org/works", new Operation()))();
    policy.clear();
    (await policy.acquire("https://dblp.org/search", new Operation()))();
  }
});
