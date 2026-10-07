import test from "node:test";
import assert from "node:assert/strict";
import { PublicationFinder } from "../.tests-build/providers.js";
import { MetadataRetriever } from "../.tests-build/translate.js";
import { FakeItem, published } from "./helpers.mjs";

test("DOI metadata is preferred over IEEE, with official URL fallback", async () => {
  const retriever = new MetadataRetriever({}, {}, {});
  const candidate = {
    source: "DBLP",
    title: published.title,
    doi: published.DOI,
    url: "https://ieeexplore.ieee.org/document/12345678",
  };
  const calls = [];
  retriever.identifier = async () => {
    calls.push("DOI");
    return published;
  };
  retriever.url = async (url) => {
    calls.push(url);
    return { ...published, DOI: undefined };
  };
  assert.deepEqual(await retriever.candidate(candidate), published);
  assert.deepEqual(calls, ["DOI"]);
  retriever.identifier = async () => {
    calls.push("DOI");
    throw new Error("DOI unavailable");
  };
  assert.equal((await retriever.candidate(candidate)).DOI, candidate.doi);
  assert.deepEqual(calls.slice(1), ["DOI", candidate.url]);
  calls.length = 0;
  await assert.rejects(
    retriever.candidate(candidate, () => false),
    /cancelled/,
  );
  assert.equal(calls.length, 0);
});

test("publication search keeps successful matches and reports failed sources separately", async () => {
  const finder = new PublicationFinder({});
  const item = new FakeItem();
  finder.related = async () => [];
  finder.googleScholar = async () => [];
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
  assert.equal(lookup.answered, 6);
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
  let linkFallback = false;
  const entry = {
    getElementsByTagNameNS: (namespace, field) =>
      field === "link" && linkFallback
        ? [
            {
              getAttribute: (name) =>
                name === "title" ? "doi" : "https://doi.org/" + published.DOI,
            },
          ]
        : field === "author"
          ? [author]
          : field === "doi" && !linkFallback
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
  linkFallback = true;
  assert.equal((await finder.arxiv("2501.01234")).candidate.doi, published.DOI);
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

test("a DBLP bot-check stops mirror retries and later requests in the same batch", async () => {
  const { parseJSONResponse } = await import("../.tests-build/responses.js");
  let requests = 0;
  const finder = new PublicationFinder({
    json: async () => {
      requests++;
      return parseJSONResponse(
        "<html><title>Making sure you are not a bot!</title></html>",
      );
    },
  });
  await assert.rejects(finder.dblp(new FakeItem()), /Access blocked/);
  await assert.rejects(finder.dblp(new FakeItem()), /Access blocked/);
  assert.equal(requests, 1);
});

test("a DBLP blocked response does not discard verified results from other sources", async () => {
  const { parseJSONResponse } = await import("../.tests-build/responses.js");
  const finder = new PublicationFinder({
    json: async () =>
      parseJSONResponse(
        "<html><title>Making sure you are not a bot!</title></html>",
      ),
  });
  finder.related = async () => [];
  finder.googleScholar = async () => [];
  finder.semanticScholar = async () => [];
  finder.crossref = async () => [
    {
      source: "Crossref",
      title: published.title,
      authors: ["Zhi Lu"],
      doi: published.DOI,
      venue: published.publicationTitle,
      year: 2026,
    },
  ];
  finder.pubmed = async () => [];
  finder.openreview = async () => [];
  const item = new FakeItem();
  item.data.title = published.title;
  const lookup = await finder.find(item);
  assert.equal(lookup.candidates.length, 1);
  assert.match(lookup.warnings[0], /DBLP: Error: Access blocked/);
});

test("an unrelated JSON object from DBLP is not treated as an empty search result", async () => {
  let requests = 0;
  const finder = new PublicationFinder({
    json: async () => {
      requests++;
      return { message: "service unavailable" };
    },
  });
  await assert.rejects(finder.dblp(new FakeItem()), /Unexpected DBLP response/);
  assert.equal(requests, 3);
});

test("DBLP rate limiting suppresses further requests in the batch", async () => {
  let requests = 0;
  const finder = new PublicationFinder({
    json: async () => {
      requests++;
      throw Object.assign(new Error("HTTP 429"), { status: 429 });
    },
  });
  await assert.rejects(finder.dblp(new FakeItem()), /429/);
  await assert.rejects(finder.dblp(new FakeItem()), /429/);
  assert.equal(requests, 1);
});

test("Google Scholar resolves a verified DOI before title-based fallback sources", async () => {
  const calls = [];
  const finder = new PublicationFinder({});
  finder.related = async () => [];
  finder.googleScholar = async () => {
    calls.push("Scholar");
    return [
      {
        source: "Google Scholar",
        title: new FakeItem().getField("title"),
        authors: ["Zhi Lu"],
        doi: published.DOI,
        venue: "ICLR 2026",
        year: 2026,
      },
    ];
  };
  finder.crossref = async () => {
    throw new Error("must not query Crossref");
  };
  const found = await finder.find(new FakeItem(), false);
  assert.deepEqual(calls, ["Scholar"]);
  assert.equal(found.candidates[0].doi, published.DOI);
  assert.equal(found.warnings.length, 0);
});

test("DOI discovery runs before using a DOI-free Scholar match", async () => {
  const finder = new PublicationFinder({});
  const noDOI = {
    source: "Google Scholar",
    title: new FakeItem().getField("title"),
    authors: ["Zhi Lu"],
    venue: "ICLR 2026",
    url: "https://openreview.net/forum?id=paper",
  };
  const calls = [];
  finder.googleScholar = async () => {
    calls.push("Scholar");
    return [noDOI];
  };
  finder.crossref = async () => {
    calls.push("Crossref");
    return [{ ...noDOI, source: "Crossref", doi: published.DOI }];
  };
  finder.semanticScholar =
    finder.dblp =
    finder.pubmed =
    finder.openreview =
      async () => [];
  const lookup = await finder.find(new FakeItem(), false);
  const { selectPublication } = await import("../.tests-build/selection.js");
  assert.deepEqual(calls, ["Scholar", "Crossref"]);
  assert.equal(
    selectPublication(new FakeItem(), lookup.candidates).doi,
    published.DOI,
  );
  finder.crossref = async () => [];
  const withoutDOI = await finder.find(new FakeItem(), false);
  assert.equal(
    selectPublication(new FakeItem(), withoutDOI.candidates).url,
    noDOI.url,
  );
});

test("Scholar bot checks and HTTP rate limits stop further Scholar queries in a batch", async () => {
  for (const blocked of [
    "<!doctype html><html>Our systems have detected unusual traffic</html>",
    429,
  ]) {
    let calls = 0;
    const finder = new PublicationFinder({
      text: async () => {
        calls++;
        if (typeof blocked === "number")
          throw Object.assign(new Error("HTTP 429"), { status: 429 });
        return blocked;
      },
    });
    await assert.rejects(
      finder.googleScholar(new FakeItem()),
      /Access blocked|429/,
    );
    await assert.rejects(
      finder.googleScholar(new FakeItem()),
      /Access blocked|429/,
    );
    assert.equal(calls, 1);
  }
});

test("preprints with a published DOI resolve that identifier before arXiv metadata", async () => {
  const item = new FakeItem();
  item.data.DOI = published.DOI;
  const retriever = new MetadataRetriever({}, {}, {});
  const calls = [];
  retriever.retrieve = async (_, source) => {
    calls.push(source);
    return published;
  };
  const result = await retriever.retrieveCurrent(item);
  assert.equal(result.source, "DOI");
  assert.deepEqual(calls, ["DOI"]);
});

test("DOI lookup fills an omitted DOI without creating a saved item", async () => {
  const retriever = new MetadataRetriever({}, {}, {});
  retriever.identifier = async () => ({ ...published, DOI: undefined });
  assert.equal(
    (
      await retriever.candidate({
        source: "Crossref",
        title: new FakeItem().getField("title"),
        doi: published.DOI,
      })
    ).DOI,
    published.DOI,
  );
});

test("verified official records stop DOI hunting, while failed or unverified pages fall back", async () => {
  const item = new FakeItem();
  item.data.url =
    "https://proceedings.neurips.cc/paper_files/paper/2023/hash/paper-Abstract-Conference.html";
  const finder = new PublicationFinder({});
  const calls = [];
  finder.related = async () => [];
  finder.googleScholar = async () => {
    calls.push("Scholar");
    return [
      { source: "Scholar", title: item.getField("title"), doi: published.DOI },
    ];
  };
  const complete = await finder.find(item, false, async (candidate) => {
    calls.push(candidate.url);
    return true;
  });
  assert.deepEqual(calls, [item.data.url]);
  assert.equal(complete.candidates[0].source, "URL");
  calls.length = 0;
  const failed = await finder.find(item, false, async () => {
    throw new Error("Rejected author match");
  });
  assert.deepEqual(calls, ["Scholar"]);
  assert.equal(failed.candidates[0].doi, published.DOI);
  assert.match(failed.warnings[0], /Rejected author/);
});

test("a DOI-free Scholar official page is verified before querying extra sources", async () => {
  const item = new FakeItem();
  const finder = new PublicationFinder({});
  finder.related = async () => [];
  const candidate = {
    source: "Scholar",
    title: item.getField("title"),
    authors: ["Zhi Lu"],
    venue: "ICLR 2026",
    url: "https://openreview.net/forum?id=accepted",
  };
  finder.googleScholar = async () => [candidate];
  finder.openreview = async () => [candidate];
  finder.crossref = async () => {
    throw new Error("Must not run");
  };
  let verified = 0;
  const lookup = await finder.find(item, true, async (found) => {
    assert.equal(found.url, candidate.url);
    verified++;
    return true;
  });
  assert.equal(verified, 1);
  assert.equal(lookup.candidates[0].url, candidate.url);
  assert.deepEqual(lookup.warnings, []);
});

test("retained arXiv identifiers supply published DOIs even outside preprint upgrades", async () => {
  const item = new FakeItem();
  item.data.itemType = "conferencePaper";
  item.data.proceedingsTitle = "CVPR";
  const finder = new PublicationFinder({});
  finder.related = async () => [
    {
      source: "arXiv",
      title: item.getField("title"),
      linked: true,
      doi: published.DOI,
    },
  ];
  finder.googleScholar = async () => {
    throw new Error("Must not run");
  };
  const lookup = await finder.find(item, false);
  assert.equal(lookup.candidates[0].doi, published.DOI);
  assert.deepEqual(lookup.warnings, []);
});

test("official URL shortcuts reject venue indexes, PDF files and lookalike hosts", async () => {
  const { officialPublicationURL } = await import(
    "../.tests-build/identifiers.js"
  );
  for (const url of [
    "https://ieeexplore.ieee.org/document/123",
    "https://proceedings.neurips.cc/paper/2023/hash/abc-Abstract-Conference.html",
    "https://proceedings.mlr.press/v202/test23a.html",
    "https://openaccess.thecvf.com/content/CVPR2025/html/test.html",
    "https://dl.acm.org/doi/10.1145/123",
    "https://link.springer.com/chapter/10.1007/test",
    "https://openreview.net/forum?id=accepted",
  ])
    assert.equal(officialPublicationURL(url), true, url);
  for (const url of [
    "https://proceedings.neurips.cc/paper/2023",
    "https://proceedings.neurips.cc/paper/2023/hash/abc-Paper.pdf",
    "https://openreview.net/group?id=ICLR",
    "https://ieeexplore.ieee.org.evil.example/document/123",
    "https://arxiv.org/abs/2501.01234",
    "javascript:alert(1)",
  ])
    assert.equal(officialPublicationURL(url), false, url);
});

test("article DOI metadata is used first, with official web fallback and no reference DOI guessing", async () => {
  const url =
    "https://proceedings.neurips.cc/paper/2023/hash/abc-Abstract-Conference.html";
  const calls = [];
  let metas = [{ getAttribute: () => published.DOI }];
  let linkLabel = "References";
  const doc = {
    querySelectorAll: (selector) =>
      selector.includes("citation_doi")
        ? metas
        : selector.startsWith("meta")
          ? []
          : [
              {
                parentElement: { textContent: linkLabel },
                getAttribute: () => "https://doi.org/" + published.DOI,
              },
            ],
  };
  class Web {
    setDocument() {}
    getTranslators() {
      return ["web"];
    }
    setTranslator() {}
    setHandler() {}
    async translate(options) {
      assert.deepEqual(options, { libraryID: false, saveAttachments: false });
      calls.push("Web");
      return [{ ...published, DOI: undefined }];
    }
  }
  const retriever = new MetadataRetriever(
    { Translate: { Web } },
    {},
    {},
    () => true,
    async () => doc,
  );
  retriever.identifier = async (ids) => {
    calls.push(ids.DOI);
    return published;
  };
  assert.equal((await retriever.url(url)).DOI, published.DOI);
  assert.deepEqual(calls, [published.DOI]);
  calls.length = 0;
  retriever.identifier = async (ids) => {
    calls.push(ids.DOI);
    throw new Error("Unavailable");
  };
  assert.equal((await retriever.url(url)).DOI, published.DOI);
  assert.deepEqual(calls, [published.DOI, "Web"]);
  calls.length = 0;
  metas = [];
  assert.equal((await retriever.url(url)).DOI, undefined);
  assert.deepEqual(calls, ["Web"]);
  calls.length = 0;
  linkLabel = "DOI: 10.1000/published";
  assert.equal((await retriever.url(url)).DOI, published.DOI);
  assert.deepEqual(calls, [published.DOI, "Web"]);
});

test("exact OpenReview lookup rejects submissions even when a web translator could import them", async () => {
  const item = new FakeItem();
  item.data.url = "https://openreview.net/forum?id=submitted";
  const urls = [];
  let accepted = false;
  const finder = new PublicationFinder({
    json: async (url) => {
      urls.push(url);
      return {
        notes: [
          {
            id: "submitted",
            content: {
              title: { value: item.getField("title") },
              authors: { value: ["Zhi Lu"] },
              venue: {
                value: accepted ? "ICLR 2026" : "Submitted to ICLR 2026",
              },
              venueid: {
                value: accepted
                  ? "ICLR.cc/2026/Conference"
                  : "ICLR.cc/2026/Conference/Submission",
              },
              _bibtex: { value: "@inproceedings{accepted}" },
            },
          },
        ],
      };
    },
  });
  const retriever = new MetadataRetriever({}, finder, {});
  retriever.bibtex = async () => published;
  await assert.rejects(retriever.url(item.data.url), /No published OpenReview/);
  assert.deepEqual(urls, ["https://api2.openreview.net/notes?id=submitted"]);
  accepted = true;
  assert.deepEqual(await retriever.url(item.data.url), published);
});

test("OpenReview main-conference presentation labels keep the ICLR venue", async () => {
  for (const category of [
    "poster",
    "oral",
    "spotlight",
    "new presentation category",
  ]) {
    const finder = new PublicationFinder({
      json: async () => ({
        notes: [
          {
            id: "accepted",
            content: {
              title: {
                value: "RouteLLM: Learning to Route LLMs from Preference Data",
              },
              authors: { value: ["Isaac Ong"] },
              venue: { value: `ICLR 2025 ${category}` },
              venueid: { value: "ICLR.cc/2025/Conference" },
            },
          },
        ],
      }),
    });
    const [candidate] = await finder.openreview(new FakeItem());
    assert.equal(candidate.venue, "ICLR 2025");
    assert.equal(candidate.year, 2025);
  }
});

test("candidate DOI metadata missing a journal uses its official article", async () => {
  const retriever = new MetadataRetriever({}, {}, {});
  retriever.identifier = async () => ({
    ...published,
    publicationTitle: undefined,
  });
  retriever.url = async () => ({
    ...published,
    publicationTitle: "Journal of Machine Learning Research",
  });
  const result = await retriever.candidate({
    source: "Crossref",
    title: published.title,
    doi: published.DOI,
    url: "https://www.nature.com/articles/example",
  });
  assert.equal(result.publicationTitle, "Journal of Machine Learning Research");
});

test("OpenReview unknown events and workshop identifiers retain their source venues", async () => {
  for (const [venueid, venue] of [
    ["Unknown.org/2025/Conference", "Unknown 2025 presentation"],
    ["ICLR.cc/2025/Workshop", "ICLR 2025 Workshop poster"],
    ["ICLR.cc/2025/Conference/Workshop", "ICLR 2025 Workshop"],
  ]) {
    const finder = new PublicationFinder({
      json: async () => ({
        notes: [
          {
            id: "accepted",
            content: {
              title: published.title,
              authors: ["Zhi Lu"],
              venue,
              venueid,
            },
          },
        ],
      }),
    });
    assert.equal((await finder.openreview(new FakeItem()))[0].venue, venue);
  }
});

test("incomplete candidate metadata is supplemented across source types without erasing successful fields", async () => {
  for (const [itemType, field] of [
    ["journalArticle", "publicationTitle"],
    ["conferencePaper", "proceedingsTitle"],
    ["bookSection", "bookTitle"],
  ]) {
    const retriever = new MetadataRetriever({}, {}, {});
    const partial = {
      ...published,
      itemType,
      publicationTitle: undefined,
      abstractNote: "Keep this abstract",
    };
    retriever.url = async () => partial;
    retriever.bibtex = async () => ({
      ...partial,
      [field]: "Published container",
      abstractNote: "Other abstract",
    });
    const result = await retriever.candidate({
      source: "Index",
      title: published.title,
      url: "https://www.nature.com/articles/example",
      bibtex: "bibliography",
    });
    assert.equal(result[field], "Published container");
    assert.equal(result.abstractNote, "Keep this abstract");
  }
});

test("failed or conflicting supplementary sources retain successful partial metadata", async () => {
  for (const conflict of [false, true]) {
    const retriever = new MetadataRetriever({}, {}, {});
    const partial = { ...published, publicationTitle: undefined };
    retriever.identifier = async () => partial;
    retriever.url = async () => {
      if (!conflict) throw new Error("Offline");
      return { ...published, DOI: "10.1000/different" };
    };
    assert.deepEqual(
      await retriever.candidate({
        source: "Index",
        title: published.title,
        doi: published.DOI,
        url: "https://www.nature.com/articles/example",
      }),
      partial,
    );
  }
});

test("linked article bibliography corrects a generic web journal type through the import translator", async () => {
  const official =
    "https://proceedings.iclr.cc/paper_files/paper/2025/hash/paper-Abstract-Conference.html";
  const link = {
    textContent: "Bibtex",
    getAttribute: (key) => (key === "href" ? "/bibliography" : null),
  };
  const document = {
    querySelectorAll: (selector) => (selector === "a[href]" ? [link] : []),
  };
  const calls = [];
  const retriever = new MetadataRetriever(
    {},
    {},
    {
      text: async (url) => {
        calls.push(url);
        return "@inproceedings{paper,title={Learning}}";
      },
    },
    () => true,
    async () => document,
  );
  retriever.bibtex = async () => ({
    ...published,
    itemType: "conferencePaper",
    publicationTitle: undefined,
    proceedingsTitle: "International Conference on Learning Representations",
  });
  class Web {
    setDocument() {}
    async getTranslators() {
      return ["web"];
    }
    setTranslator() {}
    setHandler() {}
    async translate() {
      return [
        {
          ...published,
          publicationTitle:
            "International Conference on Learning Representations",
        },
      ];
    }
  }
  retriever.zotero = { Translate: { Web } };
  const metadata = await retriever.url(official);
  assert.equal(metadata.itemType, "conferencePaper");
  assert.equal(
    metadata.proceedingsTitle,
    "International Conference on Learning Representations",
  );
  assert.deepEqual(calls, ["https://proceedings.iclr.cc/bibliography"]);
});

test("article bibliography links must be unique and belong to the official origin", async () => {
  const { articleEvidence } = await import("../.tests-build/metadata.js");
  const official =
    "https://proceedings.iclr.cc/paper_files/paper/2025/hash/paper-Abstract-Conference.html";
  const link = (href) => ({
    textContent: "Bibtex",
    getAttribute: (key) => (key === "href" ? href : null),
  });
  for (const links of [
    [link("https://other.test/paper.bib")],
    [link("/one"), link("/two")],
  ]) {
    const doc = {
      querySelectorAll: (selector) => (selector === "a[href]" ? links : []),
    };
    assert.equal(articleEvidence(doc, official).bibliographyURL, undefined);
  }
  const doc = {
    querySelectorAll: (selector) =>
      selector === "a[href]" ? [link("/bib")] : [],
  };
  assert.equal(
    articleEvidence(doc, "https://unknown.test/paper").bibliographyURL,
    undefined,
  );
});

function citationDocument(values, links = ["/paper.bib"]) {
  return {
    querySelectorAll(selector) {
      const name = selector.includes("citation_doi")
        ? "citation_doi"
        : selector.match(/^meta\[name="([^"]+)"\]$/)?.[1];
      if (name)
        return [values[name]]
          .flat()
          .filter(Boolean)
          .map((content) => ({
            getAttribute: (key) => (key === "content" ? content : null),
          }));
      if (selector === "a[href]")
        return links.map((href) => ({
          textContent: "BibTeX",
          getAttribute: (key) => (key === "href" ? href : null),
        }));
      return [];
    },
  };
}
const articleCitation = {
  citation_title: published.title,
  citation_author: "Zhi Lu",
  citation_conference_title: "New Research Symposium",
};

test("article-level citation metadata permits same-origin bibliography on uncatalogued publishers", async () => {
  const { articleEvidence } = await import("../.tests-build/metadata.js");
  const url = "https://new-publisher.test/articles/paper";
  assert.equal(
    articleEvidence(citationDocument(articleCitation), url).bibliographyURL,
    "https://new-publisher.test/paper.bib",
  );
  for (const values of [
    { ...articleCitation, citation_title: undefined },
    { ...articleCitation, citation_author: undefined },
    { ...articleCitation, citation_conference_title: undefined },
    {
      ...articleCitation,
      citation_title: [published.title, "Another article"],
    },
  ])
    assert.equal(
      articleEvidence(citationDocument(values), url).bibliographyURL,
      undefined,
    );
  for (const links of [
    ["https://other.test/paper.bib"],
    ["/one.bib", "/two.bib"],
  ])
    assert.equal(
      articleEvidence(citationDocument(articleCitation, links), url)
        .bibliographyURL,
      undefined,
    );
});

test("generic bibliography recovery retains identity checks and explicit entry types", async () => {
  const values = { ...articleCitation };
  const doc = citationDocument(values);
  class Web {
    setDocument() {}
    getTranslators() {
      return ["web"];
    }
    setTranslator() {}
    setHandler() {}
    async translate() {
      return [{ ...published, publicationTitle: "New Research Symposium" }];
    }
  }
  const calls = [];
  const retriever = new MetadataRetriever(
    { Translate: { Web } },
    {},
    {
      text: async (url) => {
        calls.push(url);
        return "@inproceedings{paper,title={Research}}";
      },
    },
    () => true,
    async () => doc,
  );
  const bibliography = {
    ...published,
    itemType: "conferencePaper",
    publicationTitle: undefined,
    proceedingsTitle: "New Research Symposium",
  };
  retriever.bibtex = async () => bibliography;
  const url = "https://new-publisher.test/articles/paper";
  assert.equal((await retriever.url(url)).itemType, "conferencePaper");
  assert.deepEqual(calls, ["https://new-publisher.test/paper.bib"]);
  // Partial DOI records must not undo the explicit BibTeX conference type.
  values.citation_doi = published.DOI;
  retriever.identifier = async () => ({
    ...published,
    publicationTitle: undefined,
  });
  assert.equal((await retriever.url(url)).itemType, "conferencePaper");
  delete values.citation_doi;
  retriever.bibtex = async () => ({
    ...bibliography,
    title: "Different reference",
  });
  assert.equal((await retriever.url(url)).itemType, "journalArticle");
  for (const change of [
    { DOI: "10.1000/different" },
    {
      creators: [
        { firstName: "Other", lastName: "Author", creatorType: "author" },
      ],
    },
  ]) {
    retriever.bibtex = async () => ({ ...bibliography, ...change });
    await assert.rejects(retriever.url(url), /Conflicting article metadata/);
  }
});

test("current identifier metadata can use an uncatalogued article to fill its container", async () => {
  const item = new FakeItem();
  Object.assign(item.data, {
    itemType: "journalArticle",
    publicationTitle: published.publicationTitle,
    DOI: published.DOI,
    url: "https://new-publisher.test/articles/paper",
  });
  const retriever = new MetadataRetriever({}, {}, {});
  const calls = [];
  retriever.retrieve = async (item, source) => {
    calls.push(source);
    return { ...published, publicationTitle: undefined };
  };
  retriever.url = async (url) => {
    calls.push(url);
    return published;
  };
  const result = await retriever.retrieveCurrent(item);
  assert.equal(result.metadata.publicationTitle, published.publicationTitle);
  assert.deepEqual(calls, ["DOI", item.data.url]);
});

test("DOI identity is checked in direct translations and every candidate fallback", async () => {
  let returnedDOI = "https://doi.org/10.1000/PUBLISHED";
  class Search {
    setIdentifier() {}
    getTranslators() {
      return ["DOI"];
    }
    setTranslator() {}
    setHandler() {}
    async translate() {
      return [{ ...published, DOI: returnedDOI }];
    }
  }
  const retriever = new MetadataRetriever({ Translate: { Search } }, {}, {});
  assert.equal(
    (await retriever.identifier({ DOI: published.DOI })).DOI,
    returnedDOI,
  );
  returnedDOI = "10.1000/different";
  await assert.rejects(
    retriever.identifier({ DOI: published.DOI }),
    /Conflicting DOI/,
  );
  retriever.url = async () => ({ ...published, DOI: returnedDOI });
  await assert.rejects(
    retriever.candidate({
      source: "Index",
      title: published.title,
      doi: published.DOI,
      url: "https://new-publisher.test/paper",
    }),
    /Conflicting DOI/,
  );
});
