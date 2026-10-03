import test from "node:test";
import assert from "node:assert/strict";
import { selectPublication } from "../.tests-build/selection.js";
import { FakeItem } from "./helpers.mjs";
const item = new FakeItem();
const candidate = {
  source: "Crossref",
  title: item.getField("title"),
  authors: ["Zhi Lu"],
  venue: "CVPR 2026",
  doi: "10.1000/paper",
};

test("one strong publication is selected without prompting; weak titles or mismatched authors are rejected", () => {
  assert.equal(selectPublication(item, [candidate]).doi, candidate.doi);
  assert.equal(
    selectPublication(item, [
      { ...candidate, title: "Learning representations" },
    ]),
    undefined,
  );
  assert.equal(
    selectPublication(item, [{ ...candidate, authors: undefined }]).doi,
    candidate.doi,
  );
  assert.equal(
    selectPublication(item, [{ ...candidate, authors: ["Someone Else"] }]),
    undefined,
  );
});
test("equivalent source records combine a DOI with the official IEEE URL", () => {
  const selected = selectPublication(item, [
    candidate,
    {
      ...candidate,
      source: "DBLP",
      doi: undefined,
      venue: "IEEE/CVF Conference on Computer Vision and Pattern Recognition",
      url: "https://ieeexplore.ieee.org/document/123456",
    },
  ]);
  assert.equal(selected.doi, candidate.doi);
  assert.equal(selected.url, "https://ieeexplore.ieee.org/document/123456");
});
test("conflicting DOI records are skipped; a server-linked publication takes precedence", () => {
  const other = { ...candidate, doi: "10.1000/another" };
  assert.equal(selectPublication(item, [candidate, other]), undefined);
  assert.equal(
    selectPublication(item, [{ ...candidate, linked: true }, other]).doi,
    candidate.doi,
  );
});
