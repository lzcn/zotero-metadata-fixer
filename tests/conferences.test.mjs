import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFERENCE_RULES,
  normalizeConference,
  parseConferenceSettings,
  validateConferenceRules,
  commonPublicationTitle,
} from "../.tests-build/conferences.js";
import { buildPlan, applyPlan } from "../.tests-build/update.js";
import { FakeItem, hostFor } from "./helpers.mjs";

const ccfName = "European Conference on Computer Vision";
const originalProceedings =
  "Computer Vision – ECCV 2024: 18th European Conference, Milan, Italy";
const authors = [{ firstName: "Zhi", lastName: "Lu", creatorType: "author" }];
const editors = [
  { firstName: "Volume", lastName: "Editor", creatorType: "editor" },
];
const bookSection = () => ({
  itemType: "bookSection",
  title: "Learning useful representations",
  bookTitle: originalProceedings,
  date: "2024",
  DOI: "10.1000/eccv",
  creators: [...authors, ...editors],
});

test("ECCV matching changes type and maps the proceedings without modifying the input", () => {
  const metadata = bookSection();
  const before = structuredClone(metadata);
  const result = normalizeConference(metadata, DEFAULT_CONFERENCE_RULES);
  assert.equal(result.metadata.itemType, "conferencePaper");
  assert.equal(result.metadata.proceedingsTitle, originalProceedings);
  assert.equal(result.metadata.conferenceName, ccfName);
  assert.equal(result.metadata.bookTitle, undefined);
  assert.equal(result.overrides.removeEditors, true);
  assert.deepEqual(metadata, before);
});

test("Publication formatting is opt-in and follows the CCF full name while preserving the paper date", () => {
  assert.equal(parseConferenceSettings().formatPublication, false);
  assert.equal(commonPublicationTitle("eccv"), ccfName);
  const off = normalizeConference(
    bookSection(),
    DEFAULT_CONFERENCE_RULES,
    false,
  );
  const on = normalizeConference(bookSection(), DEFAULT_CONFERENCE_RULES, true);
  assert.equal(off.metadata.proceedingsTitle, originalProceedings);
  assert.equal(on.metadata.proceedingsTitle, ccfName);
  assert.equal(on.metadata.date, "2024");
});

test("unknown, disabled and workshop records keep their original names and types", () => {
  for (const metadata of [
    {
      ...bookSection(),
      bookTitle: "A different conference",
      title: "A paper about ECCV",
    },
    { ...bookSection(), bookTitle: "Computer Vision – ECCV 2024 Workshops" },
    { ...bookSection(), itemType: "book" },
    { ...bookSection(), bookTitle: "NECCV 2024" },
  ]) {
    const normalized = normalizeConference(
      metadata,
      DEFAULT_CONFERENCE_RULES,
      true,
    );
    assert.equal(normalized.rule, undefined);
    assert.deepEqual(normalized.metadata, metadata);
  }
  assert.equal(
    normalizeConference(
      bookSection(),
      [{ ...DEFAULT_CONFERENCE_RULES[0], enabled: false }],
      true,
    ).rule,
    undefined,
  );
});

test("custom conferences support rules without inventing a CCF Publication name", () => {
  const rules = validateConferenceRules([
    {
      id: "custom",
      name: "Custom Conference",
      aliases: ["CUSTOM"],
      itemType: "conferencePaper",
      removeEditors: true,
      enabled: true,
    },
  ]);
  const result = normalizeConference(
    { ...bookSection(), bookTitle: "19th CUSTOM 2024" },
    rules,
    true,
  );
  assert.equal(result.metadata.itemType, "conferencePaper");
  assert.equal(result.metadata.proceedingsTitle, "19th CUSTOM 2024");
});

test("conference rules apply type and editor corrections even in fill-empty mode", async () => {
  const item = new FakeItem();
  Object.assign(item.data, bookSection());
  item.itemTypeID = 4;
  const host = hostFor(item);
  const original = item.toJSON();
  const normalized = normalizeConference(
    bookSection(),
    DEFAULT_CONFERENCE_RULES,
    true,
  );
  const plan = buildPlan(
    item,
    normalized.metadata,
    "blank",
    host,
    normalized.overrides,
  );
  assert.ok(
    plan.changes.some(
      (change) =>
        change.field === "itemType" && change.after === "conferencePaper",
    ),
  );
  assert.deepEqual(
    plan.changes.find((change) => change.field === "creators").after,
    authors,
  );
  await applyPlan(item, plan, host);
  assert.equal(item.itemType, "conferencePaper");
  assert.equal(item.getField("proceedingsTitle"), ccfName);
  assert.deepEqual(item.getCreators(), authors);
  assert.equal(item.id, 42);
  assert.equal(item.key, "OLDKEY42");
  assert.deepEqual(item.data.attachments, original.attachments);
  assert.ok(item.data.extra.startsWith(original.extra));
});

test("missing or editor-only retrieved creators cannot erase existing paper authors", () => {
  const item = new FakeItem();
  Object.assign(item.data, bookSection());
  item.itemTypeID = 4;
  for (const creators of [undefined, editors]) {
    const normalized = normalizeConference(
      { ...bookSection(), creators },
      DEFAULT_CONFERENCE_RULES,
    );
    const plan = buildPlan(
      item,
      normalized.metadata,
      "replace",
      hostFor(item),
      normalized.overrides,
    );
    assert.deepEqual(
      plan.changes.find((change) => change.field === "creators").after,
      authors,
    );
  }
});

test("numeric host editor roles are removed and editor-only items can receive paper authors", () => {
  const item = new FakeItem();
  Object.assign(item.data, bookSection());
  item.itemTypeID = 4;
  item.data.creators = [
    ...authors,
    { firstName: "Volume", lastName: "Editor", creatorTypeID: 99 },
  ];
  const normalized = normalizeConference(
    bookSection(),
    DEFAULT_CONFERENCE_RULES,
  );
  const plan = buildPlan(
    item,
    normalized.metadata,
    "blank",
    hostFor(item),
    normalized.overrides,
  );
  assert.deepEqual(
    plan.changes.find((change) => change.field === "creators").after,
    authors,
  );
  item.data.creators = editors;
  const empty = buildPlan(
    item,
    normalized.metadata,
    "blank",
    hostFor(item),
    normalized.overrides,
  );
  assert.deepEqual(
    empty.changes.find((change) => change.field === "creators").after,
    authors,
  );
});

test("rules can remove the final editor but retain editors when that option is disabled", () => {
  const item = new FakeItem();
  Object.assign(item.data, bookSection());
  item.itemTypeID = 4;
  item.data.creators = editors;
  const normalized = normalizeConference(
    { ...bookSection(), creators: editors },
    DEFAULT_CONFERENCE_RULES,
  );
  const plan = buildPlan(
    item,
    normalized.metadata,
    "blank",
    hostFor(item),
    normalized.overrides,
  );
  assert.deepEqual(
    plan.changes.find((change) => change.field === "creators").after,
    [],
  );
  const disabled = normalizeConference(bookSection(), [
    { ...DEFAULT_CONFERENCE_RULES[0], removeEditors: false },
  ]);
  const keep = buildPlan(
    item,
    disabled.metadata,
    "replace",
    hostFor(item),
    disabled.overrides,
  );
  assert.ok(
    keep.changes
      .find((change) => change.field === "creators")
      .after.some((creator) => creator.creatorType === "editor"),
  );
});

test("settings validate unique IDs and persist the Publication switch", () => {
  const defaults = parseConferenceSettings();
  const restored = parseConferenceSettings(
    JSON.stringify({
      ...defaults,
      formatPublication: true,
      publicationStyle: "standard",
    }),
  );
  assert.equal(restored.formatPublication, true);
  assert.deepEqual(restored.rules, defaults.rules);
  assert.throws(
    () => validateConferenceRules([defaults.rules[0], defaults.rules[0]]),
    /unique ID/,
  );
  assert.throws(
    () => parseConferenceSettings('{"rules":[],"formatPublication":"yes"}'),
    /formatting option/,
  );
  assert.throws(
    () => validateConferenceRules([{ ...defaults.rules[0], aliases: [" "] }]),
    /non-empty/,
  );
});

test("the CCF catalog covers all 386 conferences and 10 categories with provenance", async () => {
  const { conferenceInfo } = await import("../.tests-build/conferences.js");
  assert.equal(DEFAULT_CONFERENCE_RULES.length, 513);
  const info = DEFAULT_CONFERENCE_RULES.map((rule) =>
    conferenceInfo(rule.id),
  ).filter((row) => row.source.startsWith("https://www.ccf.org.cn/"));
  assert.equal(info.length, 386);
  assert.equal(new Set(info.map((row) => row.category)).size, 10);
  assert.equal(info.filter((row) => row.rank === "A").length, 58);
  for (const row of info) {
    assert.ok(row.source.startsWith("https://www.ccf.org.cn/"));
    assert.ok(row.sourcePage >= 5 && row.sourcePage <= 72);
    assert.equal(row.catalogVersion, "CCF-2026-7");
    assert.ok(row.name && row.aliases.length);
  }
  for (const id of ["cvpr", "iccv", "iclr", "neurips", "eccv", "icml", "acl"])
    assert.ok(conferenceInfo(id));
});

test("legacy settings gain new conferences while retaining edits, disabled rules and custom entries", () => {
  const old = {
    ...DEFAULT_CONFERENCE_RULES[0],
    name: "My ECCV",
    enabled: false,
  };
  const upgraded = parseConferenceSettings(
    JSON.stringify({ rules: [old], formatPublication: true }),
  );
  assert.equal(upgraded.rules.length, DEFAULT_CONFERENCE_RULES.length);
  assert.equal(upgraded.rules[0].name, "My ECCV");
  assert.equal(upgraded.rules[0].enabled, false);
  const deleted = parseConferenceSettings(
    JSON.stringify({
      ...upgraded,
      catalogVersion: "previous",
      removedRuleIDs: ["iclr"],
      rules: upgraded.rules.filter((rule) => rule.id !== "iclr"),
    }),
  );
  assert.equal(
    deleted.rules.some((rule) => rule.id === "iclr"),
    false,
  );
  assert.equal(
    parseConferenceSettings(JSON.stringify({ ...upgraded, rules: [] })).rules
      .length,
    0,
  );
});

test("ambiguous FSE and SEC acronyms require a specific conference name", () => {
  for (const venue of ["FSE 2026", "SEC 2026"])
    assert.equal(
      normalizeConference(
        { ...bookSection(), bookTitle: venue },
        DEFAULT_CONFERENCE_RULES,
      ).rule,
      undefined,
    );
  for (const [venue, id] of [
    ["Fast Software Encryption", "fse-crypto"],
    [
      "ACM International Conference on the Foundations of Software Engineering",
      "fse-software",
    ],
    ["ACM/IEEE Symposium on Edge Computing", "sec-edge"],
  ])
    assert.equal(
      normalizeConference(
        { ...bookSection(), bookTitle: venue },
        DEFAULT_CONFERENCE_RULES,
      ).rule.id,
      id,
    );
});

test("legacy names and attached years match while secondary tracks in any venue field stay distinct", () => {
  for (const [venue, id] of [
    ["ECCV2024", "eccv"],
    ["NIPS 2017", "neurips"],
    ["IEEE/CVF Conference on Computer Vision and Pattern Recognition", "cvpr"],
    ["USENIX ATC 2024", "acm-sigops-atc"],
  ])
    assert.equal(
      normalizeConference(
        { ...bookSection(), bookTitle: venue },
        DEFAULT_CONFERENCE_RULES,
      ).rule.id,
      id,
    );
  assert.equal(
    normalizeConference(
      {
        ...bookSection(),
        conferenceName: ccfName,
        bookTitle: "ECCV 2024 Workshops",
      },
      DEFAULT_CONFERENCE_RULES,
    ).rule,
    undefined,
  );
  assert.equal(
    normalizeConference(
      {
        ...bookSection(),
        bookTitle: "Findings of the Association for Computational Linguistics",
      },
      DEFAULT_CONFERENCE_RULES,
    ).rule,
    undefined,
  );
});

test("genuine journal proceedings are preserved by default and can be explicitly overridden", () => {
  const metadata = {
    ...bookSection(),
    itemType: "journalArticle",
    conferenceName: "SIGMOD",
    publicationTitle: "Proceedings of the ACM on Management of Data",
  };
  assert.deepEqual(
    normalizeConference(metadata, DEFAULT_CONFERENCE_RULES, true).metadata,
    metadata,
  );
  const rules = DEFAULT_CONFERENCE_RULES.map((rule) =>
    rule.id === "sigmod" ? { ...rule, preserveJournalArticles: false } : rule,
  );
  assert.equal(
    normalizeConference(metadata, rules, true).metadata.itemType,
    "conferencePaper",
  );
});

test("per-conference exclusions and custom Publication names take effect only when configured", () => {
  const rules = [
    {
      ...DEFAULT_CONFERENCE_RULES[0],
      publicationTitleOverride: "ECCV",
      excludeAliases: ["Demo"],
    },
  ];
  assert.equal(
    normalizeConference(bookSection(), rules, true).metadata.proceedingsTitle,
    "ECCV",
  );
  assert.equal(
    normalizeConference(bookSection(), rules, false).metadata.proceedingsTitle,
    originalProceedings,
  );
  assert.equal(
    normalizeConference(
      { ...bookSection(), bookTitle: "ECCV Demo" },
      rules,
      true,
    ).rule,
    undefined,
  );
});

test("one naming setting offers original, standard and short names and migrates the old switch", () => {
  const metadata = {
    itemType: "conferencePaper",
    title: "Paper",
    proceedingsTitle: "2026ICCV, 35th edition",
  };
  assert.equal(
    normalizeConference(metadata, DEFAULT_CONFERENCE_RULES, "original").metadata
      .proceedingsTitle,
    metadata.proceedingsTitle,
  );
  assert.equal(
    normalizeConference(metadata, DEFAULT_CONFERENCE_RULES, "standard").metadata
      .proceedingsTitle,
    "International Conference on Computer Vision",
  );
  assert.equal(
    normalizeConference(metadata, DEFAULT_CONFERENCE_RULES, "short").metadata
      .proceedingsTitle,
    "ICCV",
  );
  assert.equal(
    parseConferenceSettings(
      JSON.stringify({ rules: [], formatPublication: true }),
    ).publicationStyle,
    "standard",
  );
  assert.equal(
    parseConferenceSettings(
      JSON.stringify({ rules: [], formatPublication: false }),
    ).publicationStyle,
    "original",
  );
  assert.throws(
    () =>
      parseConferenceSettings(
        JSON.stringify({
          rules: [],
          formatPublication: true,
          publicationStyle: "invalid",
        }),
      ),
    /naming style/,
  );
});

test("CVPR standard mode supplies the official IEEE/CVF full name without the source year", () => {
  const metadata = {
    itemType: "conferencePaper",
    title: "Paper",
    date: "2026",
    conferenceName: "My existing CVPR event",
    proceedingsTitle:
      "Conference on computer vision and pattern recognition 2026 .",
  };
  const original = normalizeConference(
    metadata,
    DEFAULT_CONFERENCE_RULES,
    "original",
  );
  assert.equal(original.rule.id, "cvpr");
  assert.equal(original.metadata.proceedingsTitle, metadata.proceedingsTitle);
  const standard = normalizeConference(
    metadata,
    DEFAULT_CONFERENCE_RULES,
    "standard",
  );
  const fullName =
    "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition";
  assert.equal(standard.metadata.proceedingsTitle, fullName);
  assert.equal(standard.metadata.conferenceName, metadata.conferenceName);
  assert.equal(standard.metadata.date, "2026");
  const short = normalizeConference(
    metadata,
    DEFAULT_CONFERENCE_RULES,
    "short",
  );
  assert.equal(short.metadata.proceedingsTitle, "CVPR");
  assert.equal(short.metadata.conferenceName, metadata.conferenceName);
  const legacy = parseConferenceSettings(
    JSON.stringify({
      rules: DEFAULT_CONFERENCE_RULES,
      formatPublication: true,
      catalogVersion: "CCF-2026-7",
    }),
  );
  assert.equal(
    normalizeConference(metadata, legacy.rules, legacy.publicationStyle)
      .metadata.proceedingsTitle,
    fullName,
  );
});

test("the library's previously unmatched venues recognize verified conferences and retain ambiguous records", async () => {
  const { readFile } = await import("node:fs/promises");
  const cases = JSON.parse(
    await readFile(new URL("./conference-cases.json", import.meta.url), "utf8"),
  );
  for (const { venue, rule } of cases) {
    const original = { ...bookSection(), bookTitle: venue };
    const result = normalizeConference(
      original,
      DEFAULT_CONFERENCE_RULES,
      "standard",
    );
    assert.equal(result.rule?.id ?? null, rule, venue);
    if (!rule) assert.deepEqual(result.metadata, original, venue);
  }
});

test("supplementary conferences have independent sources, full names and short names", async () => {
  const { conferenceInfo } = await import("../.tests-build/conferences.js");
  for (const [id, venue, short] of [
    [
      "igarss",
      "2024 IEEE International Geoscience and Remote Sensing Symposium",
      "IGARSS",
    ],
    [
      "wacv",
      "2025 IEEE/CVF Winter Conference on Applications of Computer Vision (WACV)",
      "WACV",
    ],
    [
      "embc",
      "2024 46th Annual International Conference of the IEEE Engineering in Medicine and Biology Society (EMBC)",
      "EMBC",
    ],
    ["cvpr-workshops", "CVPRW", "CVPRW"],
    ["iccv-workshops", "ICCV 2023 Workshops", "ICCVW"],
    ["eacl", "EACL", "EACL"],
    ["colm", "CoLM", "COLM"],
    [
      "neurips-autodiff",
      "NeurIPS Autodiff Workshop",
      "NeurIPS Autodiff Workshop",
    ],
  ]) {
    const info = conferenceInfo(id);
    assert.ok(info.source.startsWith("https://"), id);
    assert.equal(info.sourcePDF, undefined, id);
    const metadata = { ...bookSection(), bookTitle: venue };
    const standard = normalizeConference(
      metadata,
      DEFAULT_CONFERENCE_RULES,
      "standard",
    );
    const compact = normalizeConference(
      metadata,
      DEFAULT_CONFERENCE_RULES,
      "short",
    );
    const original = normalizeConference(
      metadata,
      DEFAULT_CONFERENCE_RULES,
      "original",
    );
    assert.equal(standard.rule.id, id);
    assert.equal(standard.metadata.proceedingsTitle, info.publicationTitle);
    assert.equal(compact.metadata.proceedingsTitle, short);
    assert.equal(original.metadata.proceedingsTitle, venue);
    const journal = { ...metadata, itemType: "journalArticle" };
    assert.deepEqual(
      normalizeConference(journal, DEFAULT_CONFERENCE_RULES, "standard")
        .metadata,
      journal,
    );
  }
  for (const venue of [
    "ECCV Unlisted Workshop",
    "WACV Unlisted Workshop",
    "ICCE",
    "SAS",
    "USENIX",
    "Pattern Recognition",
  ]) {
    assert.equal(
      normalizeConference(
        { ...bookSection(), bookTitle: venue },
        DEFAULT_CONFERENCE_RULES,
      ).rule,
      undefined,
      venue,
    );
  }
});

test("catalog upgrades add rules and refresh untouched aliases without overriding user edits", async () => {
  const { readFile } = await import("node:fs/promises");
  const oldRules = JSON.parse(
    await readFile(
      new URL("../data/conferences.json", import.meta.url),
      "utf8",
    ),
  );
  const www = oldRules.find((rule) => rule.id === "www");
  const nsdi = oldRules.find((rule) => rule.id === "nsdi");
  nsdi.aliases = ["My own NSDI alias"];
  www.enabled = false;
  const custom = {
    ...www,
    id: "personal",
    name: "My Conference",
    aliases: ["My Conference"],
  };
  const settings = parseConferenceSettings(
    JSON.stringify({
      rules: [www, nsdi, custom],
      formatPublication: false,
      publicationStyle: "original",
      catalogVersion: "CCF-2026-7",
      removedRuleIDs: ["wacv"],
    }),
  );
  assert.equal(settings.publicationStyle, "original");
  assert.equal(
    settings.rules.some((rule) => rule.id === "wacv"),
    false,
  );
  assert.equal(settings.rules.find((rule) => rule.id === "www").enabled, false);
  assert.ok(
    settings.rules
      .find((rule) => rule.id === "www")
      .aliases.includes("International Conference on World Wide Web"),
  );
  assert.deepEqual(settings.rules.find((rule) => rule.id === "nsdi").aliases, [
    "My own NSDI alias",
  ]);
  assert.equal(
    settings.rules.find((rule) => rule.id === "personal").name,
    "My Conference",
  );
  assert.deepEqual(parseConferenceSettings(JSON.stringify(settings)), settings);
});
