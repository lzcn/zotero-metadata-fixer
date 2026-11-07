import test from "node:test";
import assert from "node:assert/strict";
import { PublicationFinder } from "../.tests-build/providers.js";
import { MetadataRetriever } from "../.tests-build/translate.js";
import {
  matchesPublication,
  hasPublicationEvidence,
} from "../.tests-build/metadata.js";
import { buildRepairPlan } from "../.tests-build/repair.js";
import { applyPlan } from "../.tests-build/update.js";
import { FakeItem, hostFor } from "./helpers.mjs";

const paper = {
  itemType: "journalArticle",
  title: "Learning useful representations",
  publicationTitle: "Regional Methods Journal",
  date: "2026",
  volume: "7",
  pages: "11-19",
  creators: [{ firstName: "Zhi", lastName: "Lu", creatorType: "author" }],
  url: "https://uncatalogued-publisher.test/articles/paper",
};

function finderWithEmptyIndexes() {
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
    finder[name] = async () => [];
  return finder;
}

function retrieverFor(metadata, finder) {
  class Web {
    setDocument() {}
    getTranslators() {
      return ["embedded-metadata"];
    }
    setTranslator() {}
    setHandler() {}
    async translate(options) {
      assert.deepEqual(options, { libraryID: false, saveAttachments: false });
      return [metadata];
    }
  }
  return new MetadataRetriever(
    { Translate: { Web } },
    finder,
    {},
    () => true,
    async () => ({ querySelectorAll: () => [] }),
  );
}

async function discover(item, finder, retriever) {
  let metadata;
  const lookup = await finder.find(item, false, async (candidate) => {
    const record = await retriever.candidate(candidate);
    if (
      !matchesPublication(item, candidate, record) ||
      !hasPublicationEvidence(candidate, record)
    )
      throw new Error("Unverified publication metadata");
    metadata = record;
    return true;
  });
  return { lookup, metadata };
}

for (const metadata of [
  paper,
  {
    ...paper,
    itemType: "conferencePaper",
    publicationTitle: undefined,
    proceedingsTitle: "Proceedings of the Unlisted Systems Meeting",
    url: "https://unlisted-meeting.test/2026/papers/17",
  },
  {
    ...paper,
    itemType: "bookSection",
    publicationTitle: undefined,
    bookTitle: "Collected Research Methods",
    url: "https://independent-press.test/chapters/methods",
  },
])
  test(`DOI-free ${metadata.itemType} at an uncatalogued origin is corroborated by an index`, async () => {
    const item = new FakeItem();
    item.data.url = "";
    item.data.archiveID = "";
    const before = item.toJSON();
    const finder = finderWithEmptyIndexes();
    finder.openAlex = async () => [
      {
        source: "OpenAlex",
        title: metadata.title,
        url: metadata.url,
        venue:
          metadata.publicationTitle ||
          metadata.proceedingsTitle ||
          metadata.bookTitle,
        publicationEvidence: "index",
      },
    ];
    finder.dblp = async () =>
      assert.fail("Unnecessary later search after verified index");
    const result = await discover(item, finder, retrieverFor(metadata, finder));
    assert.equal(result.lookup.candidates[0].source, "OpenAlex");
    assert.equal(result.metadata.itemType, metadata.itemType);
    const host = hostFor(item);
    await applyPlan(
      item,
      buildRepairPlan(item, result.metadata, host, undefined, true),
      host,
      true,
    );
    assert.equal(item.itemType, metadata.itemType);
    assert.equal(item.getField("DOI"), "");
    assert.equal(item.getField("volume"), "7");
    for (const field of [
      "collections",
      "tags",
      "relations",
      "notes",
      "attachments",
    ])
      assert.deepEqual(item.data[field], before[field]);
  });

test("OpenAlex retains DOI-free publisher pages and ignores repository/submitted copies", async () => {
  const work = {
    display_name: paper.title,
    type: "article",
    doi: null,
    publication_year: 2026,
    authorships: [{ author: { display_name: "Zhi Lu" } }],
    primary_location: {
      source: { type: "repository", display_name: "University Repository" },
      landing_page_url: "https://repository.test/paper",
    },
    locations: [
      {
        source: { type: "journal", display_name: paper.publicationTitle },
        landing_page_url: paper.url,
        version: "publishedVersion",
      },
    ],
  };
  const source = new PublicationFinder({
    json: async () => ({
      results: [
        work,
        { ...work, locations: [] },
        { ...work, type: "preprint" },
        {
          ...work,
          locations: [{ ...work.locations[0], version: "submittedVersion" }],
        },
      ],
    }),
  });
  const [candidate, ...others] = await source.openAlex(new FakeItem());
  assert.deepEqual(others, []);
  assert.equal(candidate.doi, undefined);
  assert.equal(candidate.url, paper.url);
  const finder = finderWithEmptyIndexes();
  finder.openAlex = async () => [candidate];
  finder.dblp = async () => assert.fail("Unnecessary later search");
  const result = await discover(
    new FakeItem(),
    finder,
    retrieverFor(paper, finder),
  );
  assert.equal(result.metadata.publicationTitle, paper.publicationTitle);
  assert.equal(result.lookup.candidates[0].source, "OpenAlex");
});

test("PubMed records without a DOI retain their individual record URL", async () => {
  const finder = new PublicationFinder({
    json: async (url) =>
      url.includes("esearch")
        ? { esearchresult: { idlist: ["12345", "missing"] } }
        : {
            result: {
              12345: {
                title: paper.title,
                fulljournalname: paper.publicationTitle,
                pubdate: "2026",
                articleids: [],
                authors: [{ name: "Lu Z" }],
              },
            },
          },
  });
  const records = await finder.pubmed(new FakeItem());
  assert.equal(records.length, 1);
  assert.equal(records[0].url, "https://pubmed.ncbi.nlm.nih.gov/12345/");
  assert.equal(records[0].doi, undefined);
});

test("single-record BibTeX from any HTTP origin can complete an indexed DOI-free paper", async () => {
  const item = new FakeItem();
  const metadata = {
    ...paper,
    itemType: "conferencePaper",
    publicationTitle: undefined,
    proceedingsTitle: "Unlisted Systems Meeting",
  };
  const candidate = {
    source: "DBLP",
    publicationEvidence: "index",
    title: paper.title,
    authors: ["Zhi Lu"],
    venue: metadata.proceedingsTitle,
    url: "https://unlisted-meeting.test/paper.bib",
  };
  const finder = finderWithEmptyIndexes();
  finder.dblp = async () => [candidate];
  finder.googleScholar = async () =>
    assert.fail("BibTeX should stop broad search");
  const retriever = new MetadataRetriever({}, finder, {
    text: async () => "@inproceedings{paper}",
  });
  retriever.bibtex = async () => metadata;
  const result = await discover(item, finder, retriever);
  assert.equal(result.metadata.proceedingsTitle, metadata.proceedingsTitle);
  assert.equal(result.lookup.candidates[0].source, "DBLP");
});

test("an unverified DOI-free match cannot become a successful discovery or fallback repair", async () => {
  for (const change of [
    { title: "Different paper" },
    {
      creators: [
        { firstName: "Someone", lastName: "Else", creatorType: "author" },
      ],
    },
    { creators: [] },
    { itemType: "webpage" },
    { publicationTitle: "Under review at Regional Methods Journal" },
    { publicationTitle: "" },
    { DOI: "10.48550/arXiv.2601.12345" },
  ]) {
    const item = new FakeItem();
    item.data.url = paper.url;
    item.data.archiveID = "";
    const finder = finderWithEmptyIndexes();
    const retriever = retrieverFor(
      { ...paper, publicationEvidence: "index", ...change },
      finder,
    );
    const result = await discover(item, finder, retriever);
    assert.deepEqual(result.lookup.candidates, []);
    assert.equal(result.metadata, undefined);
    // Preprints remain retrievable as preprints, never authorize an upgrade.
    if (!change.DOI)
      await assert.rejects(retriever.retrieveCurrent(item), /Unverified/);
    assert.equal(item.saved, 0);
  }
});

test("DOI-free identity validation distinguishes the indexed venue from another publication", () => {
  const item = new FakeItem();
  const candidate = {
    source: "Index",
    title: paper.title,
    venue: "Unlisted Systems Meeting 2026",
  };
  const metadata = {
    ...paper,
    itemType: "conferencePaper",
    publicationTitle: undefined,
    proceedingsTitle: "Proceedings of the Unlisted Systems Meeting 2026",
  };
  assert.equal(matchesPublication(item, candidate, metadata), true);
  for (const proceedingsTitle of [
    "Unlisted Systems Meeting Workshop 2026",
    "Other Systems Meeting 2026",
  ])
    assert.equal(
      matchesPublication(item, candidate, { ...metadata, proceedingsTitle }),
      false,
    );
});

test("cancelling a generic BibTeX request stops import before metadata can be applied", async () => {
  let active = true;
  const retriever = new MetadataRetriever(
    {},
    {},
    {
      text: async () => {
        active = false;
        return "@article{paper}";
      },
    },
    () => active,
  );
  retriever.bibtex = async () => assert.fail("Import after cancellation");
  await assert.rejects(
    retriever.url("https://unlisted-publisher.test/paper.bib"),
    /cancelled/,
  );
});
