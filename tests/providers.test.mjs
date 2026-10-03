import test from "node:test";
import assert from "node:assert/strict";
import { PublicationFinder } from "../.tests-build/providers.js";
import { MetadataRetriever } from "../.tests-build/translate.js";
import { FakeItem, published } from "./helpers.mjs";

test("CVPR candidates resolve metadata through their official IEEE URL, with DOI fallback on source failure", async () => {
  const retriever = new MetadataRetriever({}, {}, {});
  const candidate = {
    source: "DBLP",
    title: published.title,
    venue: "CVPR",
    doi: published.DOI,
    url: "https://ieeexplore.ieee.org/document/12345678",
  };
  const calls = [];
  retriever.url = async (url) => {
    calls.push(url);
    return published;
  };
  retriever.identifier = async () => {
    calls.push("DOI");
    return published;
  };
  assert.equal(await retriever.candidate(candidate), published);
  assert.deepEqual(calls, [candidate.url]);
  retriever.url = async () => {
    throw new Error("IEEE unavailable");
  };
  await retriever.candidate(candidate);
  assert.equal(calls.at(-1), "DOI");
  calls.length = 0;
  await assert.rejects(
    retriever.candidate(candidate, () => false),
    /IEEE unavailable/,
  );
  assert.equal(calls.length, 0);
});

test("publication search keeps successful matches and reports failed sources separately", async () => {
  const finder = new PublicationFinder({});
  const item = new FakeItem();
  finder.related = async () => [];
  finder.semanticScholar = async () => {
    throw new Error("429 rate limited");
  };
  finder.crossref = async () => [
    {
      source: "Crossref",
      title: published.title,
      doi: published.DOI,
      authors: ["Zhi Lu"],
      year: 2026,
    },
  ];
  finder.dblp = async () => [];
  finder.pubmed = async () => [];
  finder.openreview = async () => [];
  const lookup = await finder.find(item);
  assert.equal(lookup.candidates[0].doi, published.DOI);
  assert.match(lookup.warnings[0], /429/);
  assert.equal(lookup.answered, 5);
});

test("linked preprint DOI wins without querying title-based sources", async () => {
  const finder = new PublicationFinder({});
  finder.related = async () => [
    {
      source: "arXiv",
      title: "Original title",
      doi: published.DOI,
      linked: true,
    },
  ];
  finder.crossref = async () => {
    throw new Error("must not run");
  };
  const lookup = await finder.find(new FakeItem());
  assert.equal(lookup.candidates[0].doi, published.DOI);
});

test("arXiv retrieves latest metadata and ignores affiliation text in author names", async () => {
  const atom = "http://www.w3.org/2005/Atom";
  const element = (text) => ({ textContent: text });
  const values = {
    id: "http://arxiv.org/abs/2501.01234v3",
    title: "Learning useful\n representations",
    summary: "A useful abstract",
    published: "2025-01-02T00:00:00Z",
  };
  const author = {
    textContent: "Zhi Lu Institute",
    getElementsByTagNameNS: (namespace, field) =>
      namespace === atom && field === "name" ? [element("Zhi Lu")] : [],
  };
  const entry = {
    getElementsByTagNameNS: (namespace, field) =>
      field === "author"
        ? [author]
        : field === "doi"
          ? [element(published.DOI)]
          : values[field]
            ? [element(values[field])]
            : [],
  };
  const document = { getElementsByTagNameNS: () => [entry] };
  const finder = new PublicationFinder({
    text: async () => "<feed/>",
    xml: () => document,
  });
  const found = await finder.arxiv("2501.01234v1");
  assert.equal(found.metadata.archiveID, "arXiv:2501.01234v3");
  assert.equal(found.metadata.creators[0].lastName, "Lu");
  assert.equal(found.metadata.DOI, "10.48550/arXiv.2501.01234");
  assert.equal(found.candidate.doi, published.DOI);
});

test("OpenReview supports DOI-free BibTeX and excludes submissions, DBLP mirrors and anonymous records", async () => {
  const note = {
    id: "accepted",
    content: {
      title: { value: published.title },
      authors: { value: ["Zhi Lu"] },
      venue: { value: "ICLR 2026" },
      venueid: { value: "ICLR.cc/2026/Conference" },
      _bibtex: { value: "@inproceedings{accepted,title={Learning}}" },
    },
  };
  const notes = [
    note,
    {
      ...note,
      id: "submitted",
      content: { ...note.content, venue: { value: "Submitted to ICLR 2026" } },
    },
    { ...note, id: "mirror", invitations: ["DBLP.org/-/Record"] },
    {
      ...note,
      id: "anonymous",
      content: { ...note.content, authors: { value: [] } },
    },
  ];
  const finder = new PublicationFinder({ json: async () => ({ notes }) });
  const found = await finder.openreview(new FakeItem());
  assert.equal(found.length, 1);
  assert.match(found[0].bibtex, /inproceedings/);
  assert.match(found[0].url, /accepted/);
});

test("DBLP retries alternate hosts and uses BibTeX for OpenReview records", async () => {
  const requested = [];
  const finder = new PublicationFinder({
    json: async (url) => {
      requested.push(url);
      if (url.startsWith("https://dblp.org/")) throw new Error("offline");
      return {
        result: {
          hits: {
            hit: [
              {
                info: {
                  title: published.title,
                  venue: "ICLR",
                  year: "2026",
                  ee: ["https://openreview.net/forum?id=paper"],
                  key: "conf/iclr/paper2026",
                  authors: { author: [{ text: "Zhi Lu" }] },
                },
              },
            ],
          },
        },
      };
    },
  });
  const candidates = await finder.dblp(new FakeItem());
  assert.equal(requested.length, 2);
  assert.equal(
    candidates[0].url,
    "https://dblp.dagstuhl.de/rec/conf/iclr/paper2026.bib",
  );
});

test("DOI, PMID, URL and BibTeX translation never save or download attachments", async () => {
  const calls = [];
  class Translator {
    setIdentifier(value) {
      calls.push(value);
    }
    setString(value) {
      calls.push(value);
    }
    setDocument(value) {
      calls.push(value);
    }
    async getTranslators() {
      return ["translator"];
    }
    setTranslator() {}
    setHandler() {}
    async translate(options) {
      calls.push(options);
      return [published];
    }
  }
  const zotero = {
    Translate: { Search: Translator, Import: Translator, Web: Translator },
    HTTP: { processDocuments: async () => [{ title: "document" }] },
  };
  const retriever = new MetadataRetriever(zotero, {}, {});
  await retriever.identifier({ DOI: published.DOI });
  await retriever.identifier({ PMID: "123" });
  await retriever.url(published.url);
  await retriever.bibtex("@article{test}");
  const options = calls.filter((call) => call?.libraryID === false);
  assert.equal(options.length, 4);
  assert.ok(options.every((option) => option.saveAttachments === false));
});

test("ambiguous translator results cannot overwrite an item", async () => {
  class Translator {
    setIdentifier() {}
    async getTranslators() {
      return ["translator"];
    }
    setTranslator() {}
    setHandler() {}
    async translate() {
      return [published, published];
    }
  }
  const retriever = new MetadataRetriever(
    { Translate: { Search: Translator } },
    {},
    {},
  );
  await assert.rejects(
    retriever.identifier({ DOI: published.DOI }),
    /one complete/,
  );
});

test("automatic retrieval prefers the latest arXiv metadata for a preprint", async () => {
  const retriever = new MetadataRetriever({}, {}, {});
  const calls = [];
  retriever.retrieve = async (_, source) => {
    calls.push(source);
    return { ...published, itemType: "preprint" };
  };
  const result = await retriever.retrieveCurrent(new FakeItem());
  assert.deepEqual(calls, ["arXiv"]);
  assert.equal(result.source, "arXiv");
});

test("automatic retrieval prefers DOI over retained arXiv provenance for a published item", async () => {
  const retriever = new MetadataRetriever({}, {}, {});
  const calls = [];
  const item = new FakeItem();
  Object.assign(item.data, published);
  retriever.retrieve = async (_, source) => {
    calls.push(source);
    return published;
  };
  const result = await retriever.retrieveCurrent(item);
  assert.deepEqual(calls, ["DOI"]);
  assert.equal(result.metadata.itemType, "journalArticle");
});

test("automatic retrieval falls back from DOI to PMID and reports the first failure", async () => {
  const retriever = new MetadataRetriever({}, {}, {});
  const calls = [];
  const item = new FakeItem();
  Object.assign(item.data, published);
  item.data.extra += "\nPMID: 123";
  retriever.retrieve = async (_, source) => {
    calls.push(source);
    if (source === "DOI") throw new Error("offline");
    return published;
  };
  const result = await retriever.retrieveCurrent(item);
  assert.deepEqual(calls, ["DOI", "PMID"]);
  assert.equal(result.source, "PMID");
  assert.match(result.warnings[0], /DOI:.*offline/);
});

test("cancelled automatic retrieval does not try another source", async () => {
  const retriever = new MetadataRetriever({}, {}, {});
  const calls = [];
  let active = true;
  retriever.retrieve = async (_, source) => {
    calls.push(source);
    active = false;
    throw new Error("cancelled");
  };
  await assert.rejects(
    retriever.retrieveCurrent(new FakeItem(), () => active),
    /cancelled/,
  );
  assert.deepEqual(calls, ["arXiv"]);
});

test("arXiv article page preserves linked publication discovery when the Atom API fails", async () => {
  const item = new FakeItem();
  const finder = new PublicationFinder({
    text: async (url) => {
      if (url.includes("export.arxiv.org")) throw new Error("503");
      return '<a data-doi="10.1000/linked">Journal reference</a>';
    },
    json: async () => {},
    xml() {},
  });
  const result = await finder.related(item);
  assert.equal(result[0].doi, "10.1000/linked");
  assert.equal(result[0].linked, true);
});
test("Semantic Scholar falls back from missing arXiv record or a preprint-only DOI to title search", async () => {
  for (const error of [true, false]) {
    const calls = [];
    const finder = new PublicationFinder({
      json: async (url) => {
        calls.push(url);
        if (url.includes("/ARXIV:")) {
          if (error) throw new Error("404 not found");
          return { externalIds: { DOI: "10.48550/arXiv.2501.01234" } };
        }
        return {
          data: [
            {
              title: "Learning useful representations",
              externalIds: { DOI: "10.1000/formal" },
              venue: "ICLR 2026",
              authors: [{ name: "Zhi Lu" }],
            },
          ],
        };
      },
      text: async () => "",
      xml() {},
    });
    const result = await finder.semanticScholar(new FakeItem());
    assert.equal(result[0].doi, "10.1000/formal");
    assert.equal(result[0].linked, false);
    assert.equal(calls.length, 2);
  }
});
test("Crossref searches more results and excludes preprints in the API query", async () => {
  let query;
  const finder = new PublicationFinder({
    json: async (url) => {
      query = new URL(url);
      return { message: { items: [] } };
    },
    text: async () => "",
    xml() {},
  });
  await finder.crossref(new FakeItem());
  assert.equal(query.searchParams.get("rows"), "20");
  assert.equal(query.searchParams.get("query.author"), "Lu");
  assert.equal(
    query.searchParams.get("filter"),
    "type:journal-article,type:proceedings-article,type:book-chapter",
  );
});

test("cancelling translator detection prevents the actual translation from starting", async () => {
  let active = true,
    translated = false;
  class Translator {
    setIdentifier() {}
    async getTranslators() {
      active = false;
      return ["translator"];
    }
    async translate() {
      translated = true;
      return [published];
    }
  }
  const retriever = new MetadataRetriever(
    { Translate: { Search: Translator } },
    {},
    {},
    () => active,
  );
  await assert.rejects(
    retriever.identifier({ DOI: published.DOI }),
    /cancelled/,
  );
  assert.equal(translated, false);
});
