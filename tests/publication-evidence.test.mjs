import test from "node:test";
import assert from "node:assert/strict";
import {
  hasPublicationEvidence,
  matchesPublication,
  supplementMetadata,
} from "../.tests-build/metadata.js";
import { PublicationFinder } from "../.tests-build/providers.js";
import { MetadataRetriever } from "../.tests-build/translate.js";
import { Runtime } from "../.tests-build/runtime.js";
import { en } from "../.tests-build/strings.js";
import { FakeItem, published, hostFor } from "./helpers.mjs";
import { buildRepairPlan } from "../.tests-build/repair.js";
import { applyPlan } from "../.tests-build/update.js";

test("bibliographic identity and a claimed DOI on a personal page do not prove publication", () => {
  const item = new FakeItem();
  item.data.title = published.title;
  const candidate = {
    source: "URL",
    title: published.title,
    url: "https://author.example/paper",
    doi: published.DOI,
  };
  assert.equal(matchesPublication(item, candidate, published), true);
  assert.equal(hasPublicationEvidence(candidate, published), false);
  assert.throws(
    () =>
      Runtime.prototype.validatePublication.call(
        { s: en },
        item,
        candidate,
        published,
      ),
    /Unverified/,
  );
});

test("explicit evidence and official proceedings authorize upgrades without a DOI", async () => {
  const item = new FakeItem();
  item.data.title = published.title;
  for (const evidence of ["identifier", "index", "proceedings"]) {
    const candidate = {
      source: "Index",
      title: published.title,
      publicationEvidence: evidence,
    };
    const metadata = {
      ...published,
      DOI: undefined,
      publicationEvidence: evidence,
    };
    assert.equal(hasPublicationEvidence(candidate, metadata), true);
    Runtime.prototype.validatePublication.call(
      { s: en },
      item,
      candidate,
      metadata,
    );
    const host = hostFor(item);
    await applyPlan(item, buildRepairPlan(item, metadata, host), host);
    assert.equal(item.data.publicationEvidence, undefined);
  }
  assert.equal(
    hasPublicationEvidence(
      {
        source: "URL",
        title: published.title,
        url: "https://proceedings.mlr.press/v306/example26a.html",
      },
      published,
    ),
    true,
  );
  for (const url of [
    "https://openreview.net/forum?id=unaccepted",
    "https://neurips.cc/virtual/2026/poster/151663",
  ])
    assert.equal(
      hasPublicationEvidence(
        { source: "URL", title: published.title, url },
        published,
      ),
      false,
    );
});

test("OpenReview needs an accepted venue identity rather than a presentation label", async () => {
  const note = {
    id: "paper",
    content: {
      title: published.title,
      authors: ["Zhi Lu"],
      venue: "ICLR 2026 poster",
      venueid: "ICLR.cc/2026/Conference",
    },
  };
  const finder = new PublicationFinder({
    json: async () => ({ notes: [note] }),
  });
  assert.equal(
    (await finder.openreview(new FakeItem()))[0].publicationEvidence,
    "index",
  );
  for (const venueid of [
    "",
    "ICLR.cc/2026/Conference/Submission",
    "ICLR.cc/2026/Conference/Rejected_Submission",
    "ICLR.cc/2026/Conference/Under_Review",
    "ICLR.cc/2026/Conference/Authors",
    "ICLR.cc/2026/Conference/-/Submission",
  ]) {
    note.content.venueid = venueid;
    assert.deepEqual(await finder.openreview(new FakeItem()), [], venueid);
  }
});

test("identifier evidence comes from a completed DOI or PMID translation", async () => {
  class Search {
    setIdentifier() {}
    getTranslators() {
      return ["identifier"];
    }
    setTranslator() {}
    setHandler() {}
    async translate() {
      return [{ ...published }];
    }
  }
  const retriever = new MetadataRetriever({ Translate: { Search } }, {}, {});
  assert.equal(
    (await retriever.identifier({ DOI: published.DOI })).publicationEvidence,
    "identifier",
  );
  assert.equal(
    (await retriever.identifier({ PMID: "12345" })).publicationEvidence,
    "index",
  );
});

test("OpenAlex version evidence is explicit and never inferred from a journal name", async () => {
  const work = {
    display_name: published.title,
    type: "article",
    primary_location: {
      source: { type: "journal", display_name: published.publicationTitle },
      landing_page_url: "https://new-journal.example/article",
    },
  };
  const finder = new PublicationFinder({
    json: async () => ({ results: [work] }),
  });
  assert.equal(
    (await finder.openAlex(new FakeItem()))[0].publicationEvidence,
    undefined,
  );
  work.primary_location.version = "publishedVersion";
  assert.equal(
    (await finder.openAlex(new FakeItem()))[0].publicationEvidence,
    "index",
  );
});

test("later index evidence confirms an equivalent URL after the unconfirmed record was checked", async () => {
  const item = new FakeItem();
  item.data.title = published.title;
  const record = {
    source: "OpenAlex",
    title: published.title,
    authors: ["Zhi Lu"],
    venue: published.publicationTitle,
    url: "https://new-journal.example/article",
  };
  const finder = new PublicationFinder({});
  for (const name of ["related", "crossref", "openreview"])
    finder[name] = async () => [];
  finder.openAlex = async () => [record];
  finder.dblp = async () => [
    { ...record, source: "DBLP", publicationEvidence: "index" },
  ];
  finder.googleScholar = async () =>
    assert.fail("Confirmed record should stop broad search");
  const attempts = [];
  const lookup = await finder.find(item, false, async (candidate) => {
    attempts.push(candidate.publicationEvidence);
    return hasPublicationEvidence(candidate, { ...published, DOI: undefined });
  });
  assert.deepEqual(attempts, [undefined, "index"]);
  assert.equal(lookup.candidates[0].publicationEvidence, "index");
});

test("publication evidence cannot be borrowed from another venue while retaining an unconfirmed BibTeX venue", () => {
  const unconfirmed = {
    ...published,
    DOI: undefined,
    itemType: "conferencePaper",
    publicationTitle: undefined,
    proceedingsTitle: "Unconfirmed Research Meeting",
  };
  assert.throws(
    () =>
      supplementMetadata(unconfirmed, {
        ...published,
        publicationEvidence: "identifier",
      }),
    /Conflicting publication venues/,
  );
});
