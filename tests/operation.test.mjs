import test from "node:test";
import assert from "node:assert/strict";
import { Operation } from "../.tests-build/operation.js";

test("cancellation releases waiters without waiting for a remote promise", async () => {
  const operation = new Operation();
  const running = operation.wait(new Promise(() => {}));
  operation.cancel();
  await assert.rejects(running, /cancelled/);
  assert.equal(operation.active(), false);
});

test("cancellation wins over completed work before or immediately after waiting", async () => {
  for (const timing of ["before", "after"]) {
    const operation = new Operation();
    const error = new Error("Cancelled task must not return stale data");
    if (timing === "before") operation.cancel(error);
    const result = operation.wait(Promise.resolve("stale result"));
    if (timing === "after") operation.cancel(error);
    await assert.rejects(result, (actual) => actual === error);
  }
});

test("cancellation releases every request even if one abort fails", () => {
  const operation = new Operation();
  const errors = [];
  operation.onError = (error) => errors.push(error);
  let cancelled = 0;
  operation.onCancel(() => {
    throw new Error("Broken request");
  });
  operation.onCancel(() => cancelled++);
  operation.cancel();
  operation.cancel();
  assert.equal(cancelled, 1);
  assert.equal(errors.length, 1);
});

test("completed requests unregister their abort handlers", () => {
  const operation = new Operation();
  let cancelled = 0;
  const release = operation.onCancel(() => cancelled++);
  release();
  operation.cancel();
  assert.equal(cancelled, 0);
});

test("stalled work times out and stops the operation", async () => {
  const operation = new Operation();
  await assert.rejects(operation.wait(new Promise(() => {}), 5), /timed out/);
  assert.equal(operation.active(), false);
});

test("arXiv throttling is cancelled without leaving its timer running", async () => {
  const operation = new Operation();
  const waiting = operation.delay(30000);
  operation.cancel();
  await assert.rejects(waiting, /cancelled/);
});
