import test from "node:test";
import assert from "node:assert/strict";
import {
  publicationShort,
  addJournalTitleAbbreviations,
} from "../.tests-build/publication-short.js";

const journal = (publicationTitle) => ({
  itemType: "journalArticle",
  publicationTitle,
});
const conference = (proceedingsTitle) => ({
  itemType: "conferencePaper",
  proceedingsTitle,
});

test("publication column recognizes conferences without changing the record", () => {
  for (const [name, short] of [
    [
      "2025 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)",
      "CVPR",
    ],
    ["European Conference on Computer Vision", "ECCV"],
    ["ECCV2024", "ECCV"],
    ["CVPRW", "CVPRW"],
    ["CVPR Workshop on Unlisted Topic", "CVPRW"],
  ]) {
    const metadata = conference(name);
    const before = structuredClone(metadata);
    assert.equal(publicationShort(metadata), short);
    assert.deepEqual(metadata, before);
  }
  assert.equal(
    publicationShort({
      itemType: "bookSection",
      bookTitle: "European Conference on Computer Vision",
    }),
    "ECCV",
  );
});

test("publication column recognizes known journal names and aliases", () => {
  for (const [name, short] of [
    ["IEEE Transactions on Multimedia", "TMM"],
    ["IEEE Transactions on Pattern Analysis and Machine Intelligence", "TPAMI"],
    ["IEEE Trans. Pattern Anal. Mach. Intell.", "TPAMI"],
    ["IEEE Trans. Multimedia", "TMM"],
    ["International Journal of Computer Vision", "IJCV"],
    ["ACM Transactions on Graphics", "TOG"],
    ["tmm", "TMM"],
  ])
    assert.equal(publicationShort(journal(name)), short);
});

test("unknown, ambiguous, missing and secondary publications are preserved", () => {
  for (const name of [
    "Uncommon Journal",
    "IEEE Transactions on Multimedia Supplement",
    "Journal of Multimedia",
    "",
  ]) {
    assert.equal(publicationShort(journal(name)), name);
  }
  for (const name of [
    "Uncommon Conference",
    "Uncommon Conference Workshop",
    "",
  ]) {
    assert.equal(publicationShort(conference(name)), name);
  }
  assert.equal(
    publicationShort({ ...conference("CVPR"), conferenceName: "ECCV" }),
    "CVPR",
  );
  assert.equal(
    publicationShort(
      journal(
        "Proceedings of the ACM on Computer Graphics and Interactive Techniques",
      ),
    ),
    "Proceedings of the ACM on Computer Graphics and Interactive Techniques",
  );
});

test("publication column reads explicit journal abbreviations and repositories", () => {
  assert.equal(
    publicationShort({
      ...journal("Unlisted Journal"),
      journalAbbreviation: "UJ",
    }),
    "UJ",
  );
  assert.equal(
    publicationShort({
      ...journal("IEEE Transactions on Mobile Computing"),
      journalAbbreviation: "IEEE Trans. Mobile Comput.",
    }),
    "TMC",
  );
  for (const metadata of [
    { itemType: "preprint", repository: "arXiv" },
    { itemType: "preprint", archive: "arXiv" },
    { itemType: "journalArticle", url: "https://arxiv.org/abs/2601.01234" },
    { itemType: "preprint", DOI: "10.48550/arXiv.2601.01234" },
    { itemType: "preprint", archiveID: "arXiv:2601.01234" },
    { itemType: "preprint", extra: "arXiv: 2601.01234" },
  ])
    assert.equal(publicationShort(metadata), "arXiv");
  assert.equal(
    publicationShort({
      itemType: "preprint",
      url: "https://www.biorxiv.org/content/10.1101/12345",
    }),
    "bioRxiv",
  );
  assert.equal(
    publicationShort({
      ...journal("Nature"),
      url: "https://arxiv.org/abs/2601.01234",
    }),
    "Nature",
  );
  assert.equal(
    publicationShort({ itemType: "preprint", repository: "Local Archive" }),
    "Local Archive",
  );
  assert.equal(
    publicationShort({
      itemType: "preprint",
      url: "https://arxiv.org.example.com/abs/2601.01234",
    }),
    "",
  );
});

test("source-backed catalog covers the library's frequent IEEE and ACM journals", () => {
  for (const [name, expected] of [
    ["IEEE Transactions on Mobile Computing", "TMC"],
    ["IEEE Transactions on Geoscience and Remote Sensing", "TGRS"],
    ["IEEE Geoscience and Remote Sensing Letters", "GRSL"],
    [
      "IEEE Journal of Selected Topics in Applied Earth Observations and Remote Sensing",
      "JSTARS",
    ],
    ["IEEE Transactions on Biomedical Engineering", "TBME"],
    ["IEEE Journal of Biomedical and Health Informatics", "JBHI"],
    ["ACM Computing Surveys", "CSUR"],
    ["ACM Transactions on Information Systems", "TOIS"],
    ["Remote Sensing of Environment", "RSE"],
    ["Remote Sensing", "Remote Sensing"],
    ["Remote Sens (Basel)", "Remote Sensing"],
  ])
    assert.equal(publicationShort(journal(name)), expected);
});

test("only full-title native abbreviation records are used for unknown journals", () => {
  addJournalTitleAbbreviations({
    "the exact journal of testing": "Exact J. Test.",
  });
  assert.equal(
    publicationShort(journal("The Exact Journal of Testing")),
    "Exact J. Test.",
  );
  assert.equal(
    publicationShort(journal("Another Journal of Testing")),
    "Another Journal of Testing",
  );
});

test("preprints reports and books display their own source fields verbatim", () => {
  assert.equal(
    publicationShort({
      itemType: "preprint",
      repository: "arxiv.org",
      publicationTitle: "Ignored journal",
    }),
    "arxiv.org",
  );
  assert.equal(
    publicationShort({
      itemType: "report",
      institution: "Massachusetts Institute of Technology",
      publicationTitle: "Ignored title",
    }),
    "Massachusetts Institute of Technology",
  );
  assert.equal(
    publicationShort({
      itemType: "book",
      publisher: "Cambridge University Press",
      publicationTitle: "Ignored title",
    }),
    "Cambridge University Press",
  );
  assert.equal(
    publicationShort({
      itemType: "thesis",
      university: "Stanford University",
      thesisType: "PhD thesis",
    }),
    "Stanford University",
  );
  assert.equal(
    publicationShort({
      itemType: "thesis",
      university: "清华大学",
      thesisType: "Master thesis",
    }),
    "清华大学",
  );
  assert.equal(publicationShort({ itemType: "thesis" }), "");
  assert.equal(publicationShort({ itemType: "report" }), "");
  assert.equal(publicationShort({ itemType: "book" }), "");
});

test("every catalog full name resolves to its recorded abbreviation and source", async () => {
  const { readFile } = await import("node:fs/promises");
  const rows = JSON.parse(
    await readFile(
      new URL("../data/journal-abbreviations.json", import.meta.url),
      "utf8",
    ),
  );
  const names = new Set();
  for (const row of rows) {
    assert.ok(/^https:\/\//.test(row.source), row.name);
    assert.ok(!names.has(row.name.toLowerCase()), row.name);
    names.add(row.name.toLowerCase());
    assert.equal(publicationShort(journal(row.name)), row.acronym, row.name);
  }
});
