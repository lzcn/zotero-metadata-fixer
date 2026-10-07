import test from "node:test";
import assert from "node:assert/strict";
import {
  JSONResponseError,
  parseJSONResponse,
  summarizeProblem,
} from "../.tests-build/responses.js";
import { en, zh } from "../.tests-build/strings.js";

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

test("problem summaries distinguish source limits, timeouts and matching failures", () => {
  for (const s of [en, zh]) {
    assert.equal(summarizeProblem("", s), "");
    assert.equal(
      summarizeProblem("Semantic Scholar: HTTP 429", s),
      s.rateLimited,
    );
    assert.equal(
      summarizeProblem("Error: Metadata request timed out", s),
      s.requestTimeout,
    );
    assert.equal(summarizeProblem("DBLP: Access blocked", s), s.sourceBlocked);
    assert.equal(
      summarizeProblem("Error: No suitable Zotero translator found", s),
      s.noTranslator,
    );
    assert.equal(summarizeProblem("Error: " + s.unsupported, s), s.unsupported);
    assert.equal(summarizeProblem(s.noPublished, s), s.noPublished);
    assert.equal(summarizeProblem("Crossref: HTTP 503", s), s.sourceFailed);
    assert.equal(summarizeProblem("Error: database failed", s), s.updateFailed);
  }
});
