import test from "node:test";
import assert from "node:assert/strict";
import { buildRepairPlan } from "../.tests-build/repair.js";
import { applyPlan } from "../.tests-build/update.js";
import {
  normalizeConference,
  DEFAULT_CONFERENCE_RULES,
} from "../.tests-build/conferences.js";
import { FakeItem, hostFor, published } from "./helpers.mjs";

test("published repair fills blanks while preserving every populated field and creators", async () => {
  const item = new FakeItem();
  Object.assign(item.data, published, {
    title: "My HAND Edited Title",
    abstractNote: "My edited abstract",
    pages: "1–10",
    publisher: "My publisher",
    volume: "5",
  });
  item.itemTypeID = 2;
  const metadata = {
    ...published,
    title: "MY hand edited title",
    abstractNote: "A different source abstract",
    pages: "1-12",
    publisher: "Source publisher",
    volume: "6",
    issue: "3",
    creators: [
      { firstName: "Other", lastName: "Person", creatorType: "author" },
    ],
  };
  const plan = buildRepairPlan(item, metadata, hostFor(item));
  assert.deepEqual(
    plan.changes.map((change) => change.field),
    ["issue"],
  );
  await applyPlan(item, plan, hostFor(item));
  assert.equal(item.getField("issue"), "3");
  assert.equal(item.getField("title"), "My HAND Edited Title");
  assert.equal(item.getCreators()[0].lastName, "Lu");
});
test("publication upgrade preserves case and typography in all equivalent fields, while applying substantive new publication data", () => {
  const item = new FakeItem();
  Object.assign(item.data, {
    title: "A TITLE: with Learning",
    abstractNote: "My ABSTRACT",
    publisher: "ACM",
    language: "EN",
    pages: "1–10",
    volume: "X",
    creators: [{ firstName: "ZHI", lastName: "LU", creatorType: "author" }],
  });
  const metadata = {
    ...published,
    title: "a title: WITH learning",
    abstractNote: "MY abstract",
    publisher: "acm",
    language: "en",
    pages: "1-10",
    volume: "x",
    creators: [{ firstName: "Zhi", lastName: "Lu", creatorType: "author" }],
  };
  const plan = buildRepairPlan(item, metadata, hostFor(item), undefined, true);
  for (const field of [
    "title",
    "abstractNote",
    "publisher",
    "language",
    "pages",
    "volume",
    "creators",
  ])
    assert.equal(
      plan.changes.some((change) => change.field === field),
      false,
      field,
    );
  assert.equal(
    plan.changes.find((change) => change.field === "itemType").after,
    "journalArticle",
  );
  assert.equal(
    plan.changes.find((change) => change.field === "DOI").after,
    published.DOI,
  );
  assert.equal(
    plan.changes.find((change) => change.field === "date").after,
    "2026",
  );
});
test("ECCV fix changes type and editors but retains the original venue until name formatting is enabled", () => {
  const item = new FakeItem();
  Object.assign(item.data, {
    itemType: "bookSection",
    bookTitle: "Computer Vision – ECCV2024: 18th European Conference",
    DOI: "10.1000/eccv",
    creators: [
      ...item.getCreators(),
      { lastName: "Editor", creatorType: "editor" },
    ],
  });
  item.itemTypeID = 4;
  const retrieved = {
    ...item.toJSON(),
    title: "LEARNING USEFUL REPRESENTATIONS",
    bookTitle: "Computer Vision ECCV 2024, Proceedings Part I",
    publisher: "Springer",
  };
  const off = normalizeConference(
    retrieved,
    DEFAULT_CONFERENCE_RULES,
    "original",
  );
  const plan = buildRepairPlan(
    item,
    off.metadata,
    hostFor(item),
    off.overrides,
    false,
    false,
  );
  assert.equal(
    plan.changes.find((change) => change.field === "proceedingsTitle").after,
    item.getField("bookTitle"),
  );
  assert.equal(
    plan.changes.find((change) => change.field === "itemType").after,
    "conferencePaper",
  );
  assert.equal(
    plan.changes.find((change) => change.field === "creators").after.length,
    1,
  );
  assert.equal(
    plan.changes.some((change) => change.field === "title"),
    false,
  );
  const on = normalizeConference(retrieved, DEFAULT_CONFERENCE_RULES, "short");
  const formatted = buildRepairPlan(
    item,
    on.metadata,
    hostFor(item),
    on.overrides,
    false,
    true,
  );
  assert.equal(
    formatted.changes.find((change) => change.field === "proceedingsTitle")
      .after,
    "ECCV",
  );
});
test("explicit name formatting preserves existing casing when the name is already equivalent", () => {
  const item = new FakeItem();
  Object.assign(item.data, {
    itemType: "conferencePaper",
    proceedingsTitle: "eccv",
    conferenceName: "eccv",
  });
  item.itemTypeID = 3;
  const result = normalizeConference(
    { ...item.toJSON(), proceedingsTitle: "ECCV 2024" },
    DEFAULT_CONFERENCE_RULES,
    "short",
  );
  const plan = buildRepairPlan(
    item,
    result.metadata,
    hostFor(item),
    result.overrides,
    false,
    true,
  );
  assert.equal(
    plan.changes.some((change) =>
      ["proceedingsTitle", "conferenceName"].includes(change.field),
    ),
    false,
  );
});
test("published fix repairs malformed DOI and a verified item type without replacing valid identifiers", () => {
  const item = new FakeItem();
  Object.assign(item.data, published, {
    itemType: "bookSection",
    DOI: "not-a-doi",
  });
  item.itemTypeID = 4;
  let plan = buildRepairPlan(item, published, hostFor(item));
  assert.equal(
    plan.changes.find((change) => change.field === "DOI").after,
    published.DOI,
  );
  assert.equal(
    plan.changes.find((change) => change.field === "itemType").after,
    "journalArticle",
  );
  item.data.DOI = "10.1000/my-existing-value";
  plan = buildRepairPlan(item, published, hostFor(item));
  assert.equal(
    plan.changes.some((change) => change.field === "DOI"),
    false,
  );
});

test("upgrading to a DOI-free published conference moves the preprint DOI into Extra", async () => {
  const item = new FakeItem();
  item.data.DOI = "10.48550/arXiv.2501.01234";
  const metadata = {
    ...item.toJSON(),
    itemType: "conferencePaper",
    DOI: "",
    proceedingsTitle: "ICLR 2026",
    url: "https://openreview.net/forum?id=accepted",
  };
  const plan = buildRepairPlan(item, metadata, hostFor(item), undefined, true);
  await applyPlan(item, plan, hostFor(item), true);
  assert.equal(item.getField("DOI"), "");
  assert.match(
    item.getField("extra"),
    /Preprint DOI: 10.48550\/arXiv.2501.01234/,
  );
  assert.equal(item.itemType, "conferencePaper");
  assert.equal(item.key, "OLDKEY42");
});

test("a preprint DOI incorrectly left on a published item is fixed and retained as provenance", async () => {
  const item = new FakeItem();
  Object.assign(item.data, published, { DOI: "10.48550/arXiv.2501.01234" });
  item.itemTypeID = 2;
  const plan = buildRepairPlan(item, published, hostFor(item));
  await applyPlan(item, plan, hostFor(item));
  assert.equal(item.getField("DOI"), published.DOI);
  assert.match(
    item.getField("extra"),
    /Preprint DOI: 10.48550\/arXiv.2501.01234/,
  );
});

test("CVPR name normalization repairs missing IEEE/CVF and removes the year while preserving casing-only edits", async () => {
  const item = new FakeItem();
  Object.assign(item.data, {
    itemType: "conferencePaper",
    title: "My Hand Edited TITLE",
    date: "2026",
    DOI: "10.1000/cvpr",
    conferenceName:
      "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition",
    proceedingsTitle:
      "Conference on computer vision and pattern recognition 2026 .",
  });
  item.itemTypeID = 3;
  const metadata = { ...item.toJSON(), title: "MY HAND EDITED TITLE" };
  const standard = normalizeConference(
    metadata,
    DEFAULT_CONFERENCE_RULES,
    "standard",
  );
  await applyPlan(
    item,
    buildRepairPlan(
      item,
      standard.metadata,
      hostFor(item),
      standard.overrides,
      false,
      true,
    ),
    hostFor(item),
  );
  assert.equal(
    item.getField("proceedingsTitle"),
    "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition",
  );
  assert.equal(
    item.getField("conferenceName"),
    "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition",
  );
  assert.equal(item.getField("title"), "My Hand Edited TITLE");
  assert.equal(item.getField("date"), "2026");
  item.data.proceedingsTitle =
    "proceedings of the ieee/cvf conference on computer vision and pattern recognition";
  item.data.conferenceName = item.data.proceedingsTitle;
  const equivalent = normalizeConference(
    item.toJSON(),
    DEFAULT_CONFERENCE_RULES,
    "standard",
  );
  assert.equal(
    buildRepairPlan(
      item,
      equivalent.metadata,
      hostFor(item),
      equivalent.overrides,
      false,
      true,
    ).changes.length,
    0,
  );
});

test("a proceedings title misplaced in Conference Name repairs Proceedings Title even when formatting is off", async () => {
  const item = new FakeItem();
  const misplaced =
    "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition";
  Object.assign(item.data, {
    itemType: "conferencePaper",
    proceedingsTitle:
      "Conference on computer vision and pattern recognition 2026",
    conferenceName: misplaced,
    DOI: "10.1000/cvpr",
  });
  item.itemTypeID = 3;
  const normalized = normalizeConference(
    item.toJSON(),
    DEFAULT_CONFERENCE_RULES,
    "original",
  );
  const plan = buildRepairPlan(
    item,
    normalized.metadata,
    hostFor(item),
    normalized.overrides,
    false,
    false,
  );
  assert.deepEqual(
    plan.changes.map((change) => change.field),
    ["proceedingsTitle"],
  );
  await applyPlan(item, plan, hostFor(item));
  assert.equal(item.getField("proceedingsTitle"), misplaced);
  assert.equal(item.getField("conferenceName"), misplaced);
});
