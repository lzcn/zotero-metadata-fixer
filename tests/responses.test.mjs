import test from "node:test";
import assert from "node:assert/strict";
import {
  JSONResponseError,
  parseJSONResponse,
} from "../.tests-build/responses.js";

test("JSON responses allow a BOM and whitespace", () => {
  assert.deepEqual(parseJSONResponse('\uFEFF {"ok":true}\n'), { ok: true });
});

test("HTTP-200 bot-check HTML is classified without a JSON SyntaxError", () => {
  const html =
    "<!doctype html><html><title>Making sure you&#39;re not a bot!</title></html>";
  assert.throws(
    () =>
      parseJSONResponse(html, { blocked: "访问受限", invalid: "非 JSON 内容" }),
    (error) =>
      error instanceof JSONResponseError &&
      error.blocked &&
      error.message === "访问受限",
  );
});

test("HTML errors, empty replies and broken JSON remain failures", () => {
  for (const body of [
    "<!doctype html><html>Service unavailable</html>",
    "",
    '{"broken":',
  ])
    assert.throws(
      () => parseJSONResponse(body),
      (error) => error instanceof JSONResponseError && !error.blocked,
    );
});
