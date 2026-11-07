import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PublicationFinder } from "../.tests-build/providers.js";
import { MetadataRetriever } from "../.tests-build/translate.js";
import { conferenceSiteMetadata } from "../.tests-build/conference-site.js";
import {
  officialPublicationURL,
  conferenceSiteHint,
} from "../.tests-build/identifiers.js";
import { Runtime } from "../.tests-build/runtime.js";
import { en } from "../.tests-build/strings.js";
import { buildRepairPlan } from "../.tests-build/repair.js";
import { applyPlan } from "../.tests-build/update.js";
import { FakeItem, hostFor } from "./helpers.mjs";

const fixture = await readFile(
  new URL("fixtures/neurips-beyond-selection.html", import.meta.url),
  "utf8",
);
const work = JSON.parse(fixture.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
const url = "https://neurips.cc/virtual/2026/poster/151663";
const documentFor = (record = work, title = work.name) => ({
  querySelectorAll: () => [{ textContent: JSON.stringify(record) }],
  querySelector: (selector) =>
    selector === "h1.event-title" ? { textContent: title } : null,
});
const link = (href, title = work.name) => ({
  getAttribute: () => href,
  textContent: title,
});

for (const [conference, host, id] of [
  ["ICML", "icml.cc", "66328"],
  ["ICLR", "iclr.cc", "10006831"],
]) {
  const html = await readFile(
    new URL(`fixtures/${conference.toLowerCase()}-2026.html`, import.meta.url),
    "utf8",
  );
  const record = JSON.parse(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
  test(`${conference} DOI-free records use item venue/year hints and survive a private OpenReview match`, async () => {
    const item = new FakeItem();
    Object.assign(item.data, {
      itemType: "conferencePaper",
      title: record.name,
      proceedingsTitle: conference,
      date: "2026",
      url: "",
      archiveID: "",
      creators: [
        {
          firstName: record.author[0].name.split(" ")[0],
          lastName: record.author[0].name.split(" ").at(-1),
          creatorType: "author",
        },
      ],
    });
    const pageURL = `https://${host}/virtual/2026/poster/${id}`;
    const requests = [];
    const finder = new PublicationFinder({
      text: async (value) => {
        requests.push(value);
        return "official list";
      },
      html: () => ({
        querySelectorAll: () => [
          link(pageURL, record.name),
          link(url, record.name),
        ],
      }),
    });
    for (const name of ["related", "crossref", "openAlex", "dblp"])
      finder[name] = async () => [];
    finder.openreview = async () => [
      {
        source: "OpenReview",
        title: record.name,
        authors: record.author.map((author) => author.name),
        venue: `${conference} 2026`,
        year: 2026,
        url: "https://openreview.net/forum?id=private",
      },
    ];
    const retriever = new MetadataRetriever(
      {},
      finder,
      {},
      () => true,
      async () => documentFor(record, record.name),
    );
    let metadata;
    const lookup = await finder.find(item, false, async (candidate) => {
      if (candidate.source === "OpenReview") throw new Error("HTTP 403");
      metadata = await retriever.candidate(candidate);
      Runtime.prototype.validatePublication.call(
        { s: en },
        item,
        candidate,
        metadata,
      );
      return true;
    });
    assert.equal(lookup.candidates[0].url, pageURL);
    assert.match(lookup.warnings[0], /403/);
    assert.equal(metadata.proceedingsTitle, `${conference} 2026`);
    assert.equal(metadata.date, "2026");
    assert.equal(metadata.DOI, undefined);
    assert.equal(metadata.creators.length, record.author.length);
    assert.equal(officialPublicationURL(pageURL), true);
    await finder.conferenceSite(item, `${conference} 2026`);
    assert.deepEqual(requests, [`https://${host}/virtual/2026/papers.html`]);
    assert.throws(
      () => conferenceSiteMetadata(documentFor(work), pageURL),
      /Unverified/,
    );
  });
}

test("conference hints recognize names and NIPS while rejecting unsupported or yearless venues", () => {
  for (const [name, expected] of [
    ["NIPS 2016", "NeurIPS"],
    ["Advances in Neural Information Processing Systems 2026", "NeurIPS"],
    ["International Conference on Machine Learning 2026", "ICML"],
    ["International Conference on Learning Representations 2026", "ICLR"],
  ])
    assert.equal(conferenceSiteHint(name).conference, expected);
  for (const name of ["ICLR", "CVPR 2026", "2026", "ICML 26"])
    assert.equal(conferenceSiteHint(name), undefined);
});

test("a poster outside the official paper list cannot be promoted to the main conference", async () => {
  let active = true;
  const finder = { conferenceSite: async () => [] };
  const retriever = new MetadataRetriever(
    {},
    finder,
    {},
    () => active,
    async () => documentFor(),
  );
  await assert.rejects(retriever.url(url), /not in the official paper list/);
  finder.conferenceSite = async () => {
    active = false;
    return [];
  };
  await assert.rejects(retriever.url(url), /cancelled/);
});

test("NeurIPS official records upgrade Beyond Selection when OpenReview is inaccessible", async () => {
  const item = new FakeItem();
  Object.assign(item.data, {
    title: work.name,
    url: "http://arxiv.org/abs/2609.35232",
    archiveID: "arXiv:2609.35232",
    DOI: "10.48550/arXiv.2609.35232",
    creators: [{ firstName: "Rui", lastName: "Zhong", creatorType: "author" }],
  });
  const before = item.toJSON();
  const requests = [];
  const finder = new PublicationFinder({
    text: async (value) => {
      requests.push(value);
      return "official list";
    },
    html: () => ({
      querySelectorAll: () => [
        link("/virtual/2026/poster/151663"),
        link("https://example.org/virtual/2026/poster/151663"),
        link("/virtual/2025/poster/151663"),
        link("/virtual/2026/workshop/151663"),
        link("/virtual/2026/poster/999", "Another paper"),
      ],
    }),
  });
  finder.related = async (_, hint) => {
    hint("Accepted at NeurIPS 2026 (Spotlight). Code: https://example.org");
    return [];
  };
  for (const name of ["crossref", "openAlex", "dblp"])
    finder[name] = async () => [];
  finder.openreview = async () => {
    throw new Error("HTTP 403");
  };
  finder.googleScholar = async () => assert.fail("Unnecessary broad search");
  const retriever = new MetadataRetriever(
    {},
    finder,
    {},
    () => true,
    async () => documentFor(),
  );
  let metadata;
  const lookup = await finder.find(item, true, async (candidate) => {
    metadata = await retriever.candidate(candidate);
    Runtime.prototype.validatePublication.call(
      { s: en },
      item,
      candidate,
      metadata,
    );
    return true;
  });
  assert.deepEqual(requests, ["https://neurips.cc/virtual/2026/papers.html"]);
  assert.equal(lookup.candidates.length, 1);
  assert.match(lookup.warnings[0], /OpenReview.*403/);
  assert.equal(metadata.itemType, "conferencePaper");
  assert.equal(metadata.proceedingsTitle, "NeurIPS 2026");
  assert.equal(metadata.date, "2026");
  assert.equal(metadata.DOI, undefined);
  const host = hostFor(item);
  await applyPlan(
    item,
    buildRepairPlan(item, metadata, host, undefined, true),
    host,
    true,
  );
  assert.equal(item.getField("url"), url);
  assert.equal(item.getField("DOI"), "");
  assert.equal(item.id, 42);
  for (const field of [
    "tags",
    "collections",
    "relations",
    "notes",
    "attachments",
  ])
    assert.deepEqual(item.data[field], before[field]);
  assert.throws(
    () =>
      Runtime.prototype.validatePublication.call(
        { s: en },
        item,
        lookup.candidates[0],
        {
          ...metadata,
          creators: [{ firstName: "Other", lastName: "Author" }],
        },
      ),
    /Unverified/,
  );
});

test("NeurIPS lookup needs a conference-year hint and never infers acceptance from it", async () => {
  const finder = new PublicationFinder({
    text: async () => assert.fail("No conference hint"),
  });
  assert.deepEqual(await finder.conferenceSite(new FakeItem(), ""), []);
  assert.deepEqual(await finder.conferenceSite(new FakeItem(), "NeurIPS"), []);
  finder.net = {
    text: async () => "<html></html>",
    html: () => ({ querySelectorAll: () => [] }),
  };
  assert.deepEqual(
    await finder.conferenceSite(new FakeItem(), "Accepted at NeurIPS 2026"),
    [],
  );
});

test("NeurIPS metadata rejects missing, conflicting and ambiguous official records", () => {
  for (const record of [
    { ...work, creditText: "NeurIPS 2025" },
    { ...work, name: "Unrelated paper" },
    { ...work, author: [] },
    { ...work, author: [{ "@type": "Person", name: "" }] },
    [work, work],
    null,
  ])
    assert.throws(
      () => conferenceSiteMetadata(documentFor(record), url),
      /Unverified/,
    );
  assert.equal(officialPublicationURL(url), true);
  for (const value of [
    "https://neurips.cc/virtual/2026/papers.html",
    "https://neurips.cc/virtual/2026/workshop/151663",
    "https://example.org/virtual/2026/poster/151663",
    "https://constructor/virtual/2026/poster/151663",
  ]) {
    assert.equal(officialPublicationURL(value), false);
    assert.throws(
      () => conferenceSiteMetadata(documentFor(), value),
      /Unverified/,
    );
  }
});
