import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PublicationFinder } from "../.tests-build/providers.js";
import { MetadataRetriever } from "../.tests-build/translate.js";
import { Runtime } from "../.tests-build/runtime.js";
import { en } from "../.tests-build/strings.js";
import { selectPublication } from "../.tests-build/selection.js";
import { FakeItem } from "./helpers.mjs";

const note = JSON.parse(
  await readFile(
    new URL("fixtures/openreview-rbfm-2024.json", import.meta.url),
  ),
);

test("accepted RBFM search metadata survives an inaccessible forum lookup", async () => {
  const item = new FakeItem();
  item.data.title = note.content.title.value;
  item.data.creators = note.content.authors.value.map((name) => ({
    firstName: name.split(" ").slice(0, -1).join(" "),
    lastName: name.split(" ").at(-1),
    creatorType: "author",
  }));
  const requests = [];
  const finder = new PublicationFinder({
    json: async (url) => {
      requests.push(url);
      if (url.includes("/notes/search?")) return { notes: [note] };
      throw new Error("HTTP 403: forum lookup blocked");
    },
  });
  for (const name of ["related", "crossref", "openAlex", "dblp"])
    finder[name] = async () => [];
  for (const name of ["semanticScholar", "pubmed", "googleScholar", "usenix"])
    finder[name] = async () =>
      assert.fail("Accepted result should stop discovery");
  const retriever = new MetadataRetriever({}, finder, {});
  retriever.bibtex = async (text) => {
    assert.equal(text, note.content._bibtex.value);
    return {
      itemType: "conferencePaper",
      title: item.data.title,
      proceedingsTitle:
        "Workshop on Responsibly Building the Next Generation of Multimodal Foundational Models",
      date: "2024",
      creators: item.getCreators(),
    };
  };
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
  assert.equal(
    lookup.candidates[0].url,
    "https://openreview.net/forum?id=iSL0FHZStr",
  );
  assert.equal(metadata.proceedingsTitle, "NeurIPS 2024 Workshop RBFM");
  assert.equal(metadata.conferenceVenue.id, "NeurIPS.cc/2024/Workshop/RBFM");
  assert.equal(requests.length, 1);
  assert.deepEqual(lookup.warnings, []);
});

test("OpenReview reuses accepted search records and invalidates a later rejected result", async () => {
  let record = structuredClone(note);
  const requests = [];
  const finder = new PublicationFinder({
    json: async (url) => {
      requests.push(url);
      return { notes: [record] };
    },
  });
  const item = new FakeItem();
  const [accepted] = await finder.openreview(item);
  assert.deepEqual(await finder.openreview(item, note.id), [accepted]);
  assert.equal(requests.length, 1);
  record.content.venue.value = "Rejected Submission";
  assert.deepEqual(await finder.openreview(item), []);
  assert.deepEqual(await finder.openreview(item, note.id), []);
  assert.equal(requests.length, 3);
});

test("cached OpenReview records retain contradictory workshop identities", async () => {
  const other = structuredClone(note);
  other.content.venueid.value = "NeurIPS.cc/2024/Workshop/Other";
  const finder = new PublicationFinder({
    json: async () => ({ notes: [note, other] }),
  });
  const item = new FakeItem();
  item.data.title = note.content.title.value;
  item.data.creators = [];
  await finder.openreview(item);
  const cached = await finder.openreview(item, note.id);
  assert.equal(cached.length, 2);
  assert.equal(selectPublication(item, cached), undefined);
});

test("EventPrune uses the Extra conference hint when metadata services are blocked", async () => {
  const html = await readFile(
    new URL("fixtures/neurips-eventprune.html", import.meta.url),
    "utf8",
  );
  const work = JSON.parse(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
  const item = new FakeItem();
  Object.assign(item.data, {
    title: work.name,
    url: "https://arxiv.org/abs/2605.19506",
    archiveID: "arXiv:2605.19506",
    DOI: "10.48550/arXiv.2605.19506",
    extra:
      "arXiv: 2605.19506\nConference: NeurIPS 2026\nArea: Multimodal Efficiency",
    creators: work.author.map(({ name }) => ({
      firstName: name.split(" ").slice(0, -1).join(" "),
      lastName: name.split(" ").at(-1),
      creatorType: "author",
    })),
  });
  const requests = [];
  const pageURL = "https://neurips.cc/virtual/2026/poster/151793";
  const finder = new PublicationFinder({
    text: async (url) => {
      requests.push(url);
      if (url === "https://neurips.cc/virtual/2026/papers.html")
        return "paper list";
      throw new Error("HTTP 429: arXiv rate-limited");
    },
    json: async (url) => {
      requests.push(url);
      if (url.includes("crossref")) return { message: { items: [] } };
      if (url.includes("dblp")) return { result: { hits: { hit: [] } } };
      throw new Error("HTTP 403: metadata service blocked");
    },
    html: () => ({
      querySelectorAll: () => [
        { textContent: work.name, getAttribute: () => pageURL },
      ],
    }),
  });
  const retriever = new MetadataRetriever(
    {},
    finder,
    {},
    () => true,
    async () => ({
      querySelectorAll: () => [{ textContent: JSON.stringify(work) }],
      querySelector: () => ({ textContent: work.name }),
    }),
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
  assert.equal(lookup.candidates[0].url, pageURL);
  assert.equal(metadata.proceedingsTitle, "NeurIPS 2026");
  assert.equal(metadata.creators.length, 10);
  assert.equal(metadata.DOI, undefined);
  assert.equal(
    requests.filter((url) => url.includes("/papers.html")).length,
    1,
  );
  assert.deepEqual(requests, ["https://neurips.cc/virtual/2026/papers.html"]);
  assert.deepEqual(lookup.warnings, []);
});

for (const outcome of ["empty", "blocked", "wrong-author", "conflicting"]) {
  test(`a ${outcome} hinted conference result cannot authorize an upgrade`, async () => {
    const item = new FakeItem();
    item.data.extra = "Conference: NeurIPS 2026";
    const calls = [];
    const finder = new PublicationFinder({});
    for (const name of [
      "related",
      "crossref",
      "openAlex",
      "dblp",
      "openreview",
      "semanticScholar",
      "pubmed",
      "googleScholar",
      "usenix",
    ])
      finder[name] = async () => {
        calls.push(name);
        return [];
      };
    finder.conferenceSite = async () => {
      calls.push("conferenceSite");
      if (outcome === "blocked") throw new Error("HTTP 403");
      if (outcome === "empty") return [];
      const candidate = {
        source: "NeurIPS",
        title: item.data.title,
        venue: "NeurIPS 2026",
        url: "https://neurips.cc/virtual/2026/poster/1",
        publicationEvidence: "proceedings",
      };
      return outcome === "conflicting"
        ? [
            candidate,
            {
              ...candidate,
              url: "https://neurips.cc/virtual/2026/poster/2",
              venue: "Different Conference",
            },
          ]
        : [candidate];
    };
    const lookup = await finder.find(item, true, async (candidate) => {
      Runtime.prototype.validatePublication.call({ s: en }, item, candidate, {
        itemType: "conferencePaper",
        title: item.data.title,
        proceedingsTitle: "NeurIPS 2026",
        publicationEvidence: "proceedings",
        creators: [
          { firstName: "Other", lastName: "Author", creatorType: "author" },
        ],
      });
      return true;
    });
    assert.equal(calls[0], "conferenceSite");
    assert.equal(calls.filter((name) => name === "conferenceSite").length, 1);
    if (outcome === "conflicting") {
      assert.equal(lookup.candidates.length, 2);
      assert.deepEqual(calls, ["conferenceSite"]);
    } else {
      assert.deepEqual(lookup.candidates, []);
      assert.ok(calls.includes("crossref"));
    }
    assert.equal(item.saved, 0);
  });
}
