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

test("the same DOI in different wrappers is not treated as conflicting records", () => {
  const selected = selectPublication(item, [
    { ...candidate, doi: "https://doi.org/10.1000/paper" },
    { ...candidate, source: "DBLP", doi: "10.1000/PAPER" },
  ]);
  assert.equal(selected.doi, "https://doi.org/10.1000/paper");
});

test("DMLNet compound-word typography matches without weakening author or DOI checks", () => {
  const paper = new FakeItem();
  paper.data.title =
    "DMLNet: Differential Saliency with Multi-Domain Learning Network for Moving Infrared Small Target Detection";
  paper.data.date = "2026-00-00 2026";
  paper.data.creators = [
    { firstName: "Zhenming", lastName: "Peng", creatorType: "author" },
  ];
  const record = {
    source: "Crossref",
    title:
      "DMLNet: Differential Saliency With Multidomain Learning Network for Moving Infrared Small-Target Detection",
    authors: ["Yi Rong", "Junhai Luo", "Zhenming Peng"],
    venue: "IEEE Geoscience and Remote Sensing Letters",
    year: 2026,
    doi: "10.1109/LGRS.2026.3708839",
  };
  assert.equal(selectPublication(paper, [record]).doi, record.doi);
  assert.equal(
    selectPublication(paper, [{ ...record, authors: ["Someone Else"] }]),
    undefined,
  );
  assert.equal(
    selectPublication(paper, [
      record,
      { ...record, doi: "10.1109/LGRS.2026.9999999" },
    ]),
    undefined,
  );
  assert.equal(
    selectPublication(paper, [
      {
        ...record,
        title: record.title.replace(
          "Moving Infrared Small-Target",
          "Visible Large-Object",
        ),
      },
    ]),
    undefined,
  );
});

test("revision dates do not exclude older publications and identity conflicts still prevent selection", () => {
  const paper = new FakeItem();
  paper.data.title =
    "IR2: Implicit Rendezvous for Robotic Exploration Teams under Sparse Intermittent Connectivity";
  paper.data.date = "2025-10-21";
  paper.data.creators = [
    { firstName: "Derek Ming Siang", lastName: "Tan", creatorType: "author" },
  ];
  const record = {
    source: "Crossref",
    title: paper.data.title,
    authors: ["Derek Ming Siang Tan"],
    year: 2024,
    venue:
      "2024 IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS)",
    doi: "10.1109/IROS58592.2024.10801761",
  };
  assert.equal(selectPublication(paper, [record]).doi, record.doi);
  assert.equal(
    selectPublication(paper, [{ ...record, authors: ["Someone Else"] }]),
    undefined,
  );
  assert.equal(
    selectPublication(paper, [record, { ...record, doi: "10.1000/another" }]),
    undefined,
  );
});
