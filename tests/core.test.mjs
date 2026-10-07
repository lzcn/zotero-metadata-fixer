import test from "node:test";
import assert from "node:assert/strict";
import {
  identifiers,
  arxivID,
  canonicalDOI,
  cleanDOI,
  isPreprint,
} from "../.tests-build/identifiers.js";
import { buildPlan, applyPlan } from "../.tests-build/update.js";
import { rankCandidates, publishedVenue } from "../.tests-build/matching.js";
import { FakeItem, hostFor, published } from "./helpers.mjs";

test("identifiers support versioned modern and legacy arXiv IDs, DOI URLs and Extra PMID", () => {
  assert.equal(
    arxivID("https://arxiv.org/pdf/hep-th/9901001v2.pdf"),
    "hep-th/9901001v2",
  );
  assert.equal(arxivID("10.48550/ARXIV.2501.01234"), "2501.01234");
  assert.equal(
    arxivID("https://arxiv.org.evil.test/abs/2501.01234"),
    undefined,
  );
  assert.equal(
    cleanDOI("https://doi.org/10.1000%2Fexample"),
    "10.1000/example",
  );
  const item = new FakeItem();
  item.data.extra += "\nPMID: 123456";
  assert.equal(identifiers(item).PMID, "123456");
  assert.equal(identifiers(item).arXiv, "2501.01234v1");
});

test("publication update keeps original identity, children, user metadata and citation key", async () => {
  const item = new FakeItem();
  const host = hostFor(item);
  const original = item.toJSON();
  const metadata = {
    ...published,
    key: "NEWKEY",
    extra: "Citation Key: other",
    tags: [],
    collections: [],
    notes: [],
    attachments: [],
  };
  await applyPlan(item, buildPlan(item, metadata, "replace", host), host, true);
  assert.equal(item.id, 42);
  assert.equal(item.key, "OLDKEY42");
  assert.equal(item.libraryID, 1);
  assert.equal(item.itemType, "journalArticle");
  assert.equal(item.getField("DOI"), published.DOI);
  for (const field of [
    "attachments",
    "notes",
    "collections",
    "tags",
    "relations",
    "dateAdded",
  ])
    assert.deepEqual(item.data[field], original[field]);
  assert.ok(item.data.extra.startsWith(original.extra));
  assert.match(
    item.data.extra,
    /Preprint URL: https:\/\/arxiv.org\/abs\/2501.01234v1/,
  );
  assert.match(item.data.extra, /Original archiveID: arXiv:2501.01234v1/);
  assert.doesNotMatch(item.data.extra, /other/);
  assert.equal(item.saved, 1);
});

test("fill mode keeps populated fields, creators and type", async () => {
  const item = new FakeItem();
  const host = hostFor(item);
  const plan = buildPlan(item, published, "blank", host);
  assert.ok(
    !plan.changes.some((change) =>
      ["title", "date", "itemType", "creators"].includes(change.field),
    ),
  );
  await applyPlan(item, plan, host);
  assert.equal(item.itemType, "preprint");
  assert.equal(item.getField("title"), "Learning useful representations");
  assert.equal(item.getField("DOI"), published.DOI);
});

test("unselected fields are not overwritten", async () => {
  const item = new FakeItem();
  const host = hostFor(item);
  const plan = buildPlan(item, published, "replace", host);
  plan.changes = plan.changes.filter((change) => change.field === "DOI");
  await applyPlan(item, plan, host);
  assert.equal(item.itemType, "preprint");
  assert.equal(item.getField("date"), "2025-01-02");
});

test("concurrent edits reject a stale preview without writing", async () => {
  const item = new FakeItem();
  const host = hostFor(item);
  const plan = buildPlan(item, published, "replace", host);
  item.data.title = "Edited by user";
  await assert.rejects(applyPlan(item, plan, host), /changed during update/);
  assert.equal(item.saved, 0);
  assert.equal(item.data.title, "Edited by user");
});

test("failed transaction reloads original in-memory fields and type", async () => {
  const item = new FakeItem();
  const host = hostFor(item);
  const original = item.toJSON();
  const plan = buildPlan(item, published, "replace", host);
  item.failSave = true;
  await assert.rejects(applyPlan(item, plan, host, true), /database failed/);
  assert.deepEqual(item.toJSON(), original);
  assert.equal(item.itemTypeID, 1);
  assert.equal(item.reloaded, 1);
});

test("cancelled and read-only items cannot be updated", async () => {
  const item = new FakeItem();
  const host = hostFor(item);
  const plan = buildPlan(item, published, "replace", host);
  await assert.rejects(
    applyPlan(item, plan, { ...host, active: () => false }),
    /cancelled/,
  );
  item.editable = false;
  await assert.rejects(applyPlan(item, plan, host), /cannot be edited/);
  assert.equal(item.saved, 0);
});

test("cancellation while waiting for the transaction prevents mutation", async () => {
  const item = new FakeItem();
  const host = hostFor(item);
  let active = true;
  const plan = buildPlan(item, published, "replace", host);
  await assert.rejects(
    applyPlan(item, plan, {
      ...host,
      active: () => active,
      transaction: async (run) => {
        active = false;
        return run();
      },
    }),
    /cancelled/,
  );
  assert.equal(item.saved, 0);
  assert.equal(item.itemType, "preprint");
});

test("cancellation during save rolls back the transaction", async () => {
  const item = new FakeItem();
  const host = hostFor(item);
  const original = item.toJSON();
  const plan = buildPlan(item, published, "replace", host);
  let active = true;
  const save = item.save.bind(item);
  item.save = async () => {
    await save();
    active = false;
  };
  await assert.rejects(
    applyPlan(item, plan, { ...host, active: () => active }),
    /cancelled/,
  );
  assert.deepEqual(item.toJSON(), original);
});

test("matching uses identity rather than item dates and excludes homonyms, preprints and duplicate DOIs", () => {
  const item = new FakeItem();
  const match = {
    source: "Crossref",
    title: published.title,
    doi: published.DOI,
    authors: ["Zhi Lu"],
    venue: published.publicationTitle,
    year: 2026,
  };
  const found = rankCandidates(item, [
    match,
    { ...match, source: "DBLP" },
    { ...match, doi: "10.1000/older", year: 2024 },
    { ...match, doi: "10.1000/homonym", authors: ["Other Person"] },
    { ...match, doi: "10.48550/arXiv.2501.01234" },
  ]);
  assert.equal(found.length, 2);
  assert.equal(found[0].doi, published.DOI);
  for (const venue of [
    "CoRR 2026",
    "Submitted to ICLR 2026",
    "Rejected",
    "Withdrawn",
  ])
    assert.equal(publishedVenue(venue), false);
});

test("canonical DOI comparisons fold case and URL wrappers", () => {
  assert.equal(
    canonicalDOI("https://doi.org/10.1000%2FExample"),
    "10.1000/example",
  );
  assert.equal(canonicalDOI("doi: 10.1000/EXAMPLE"), "10.1000/example");
  assert.equal(canonicalDOI("not-a-doi"), undefined);
});

test("duplicate records are folded by canonical DOI and title typography", () => {
  const item = new FakeItem();
  const base = {
    source: "Crossref",
    title: published.title,
    doi: published.DOI,
    authors: ["Zhi Lu"],
    venue: published.publicationTitle,
    year: 2026,
  };
  const byDOI = rankCandidates(item, [
    base,
    { ...base, source: "DBLP", doi: "https://doi.org/10.1000/PUBLISHED" },
  ]);
  assert.equal(byDOI.length, 1);
  assert.equal(byDOI[0].doi, published.DOI);
  const byTitle = rankCandidates(item, [
    { ...base, doi: undefined },
    { ...base, source: "Scholar", doi: undefined, title: `${base.title}.` },
  ]);
  assert.equal(byTitle.length, 1);
});

test("preprint-server wording is never treated as a published venue", () => {
  for (const venue of [
    "Preprints",
    "pre-print",
    "Pre-Prints",
    "ResearchSquare",
    "Under Review",
  ])
    assert.equal(publishedVenue(venue), false, venue);
  assert.equal(
    publishedVenue("IEEE Geoscience and Remote Sensing Letters"),
    true,
  );
});

test("published items with retained arXiv provenance are not upgraded again", () => {
  const item = new FakeItem();
  assert.equal(isPreprint(item), true);
  item.data.itemType = "journalArticle";
  item.data.publicationTitle = "Journal of Useful Research";
  assert.equal(isPreprint(item), false);
});

test("retrieved empty values do not erase populated fields", () => {
  const item = new FakeItem();
  const plan = buildPlan(
    item,
    { ...published, date: "", creators: [], url: "" },
    "replace",
    hostFor(item),
  );
  assert.ok(
    !plan.changes.some((change) =>
      ["date", "url", "creators"].includes(change.field),
    ),
  );
});
