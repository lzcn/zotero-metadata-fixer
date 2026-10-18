import test from "node:test";
import assert from "node:assert/strict";
import { PDFUpdater } from "../.tests-build/pdf.js";
import { Operation } from "../.tests-build/operation.js";
import {
  PDF_CACHE_PREF,
  PDF_RECHECK_INTERVAL,
} from "../.tests-build/pdf-cache.js";
import { FakeItem, published } from "./helpers.mjs";

function fixture() {
  const item = new FakeItem();
  Object.assign(item.data, published);
  item.itemTypeID = 2;
  item.getAttachments = () => [7];
  const state = {
    imported: [],
    removed: [],
    downloads: 0,
    mime: "application/pdf",
    hash: "new",
    existing: "old",
    annotations: ["highlight"],
    headers: {},
    heads: 0,
    trashed: [],
  };
  const operation = new Operation();
  const file = (path) => ({
    path,
    clone() {
      return file(this.path);
    },
    append(name) {
      this.path += "/" + name;
    },
    exists: () => true,
    remove() {
      state.removed.push(this.path);
    },
    copyTo() {},
  });
  const doc = {
    location: { href: "https://publisher.example/article" },
    querySelectorAll(selector) {
      if (selector === 'meta[name="citation_title"]')
        return [{ getAttribute: () => state.title || item.getField("title") }];
      if (selector.includes('meta[name="citation_doi"]'))
        return [{ getAttribute: () => state.doi || published.DOI }];
      if (selector === 'meta[name="citation_pdf_url"]')
        return [
          { getAttribute: () => "https://publisher.example/current.pdf" },
        ];
      if (selector === 'meta[name="citation_author"]')
        return [{ getAttribute: () => state.author || "Zhi Lu" }];
      return [];
    },
  };
  const preferences = new Map();
  const old = {
    id: 7,
    key: "OLDPDF77",
    parentID: item.id,
    deleted: false,
    attachmentContentType: "application/pdf",
    get attachmentHash() {
      return Promise.resolve(state.existing);
    },
    toJSON() {
      return { key: this.key, deleted: this.deleted };
    },
    isEditable: () => true,
    getAnnotations: () => state.annotations,
    getNotes: () => [],
    getNote: () => "",
    getField: () => "Full Text",
    async save() {
      await state.trashing?.();
    },
    async reload() {
      this.deleted = state.trashed.includes(this.id);
    },
  };
  const allAttachments = [old];
  item.getAttachments = () =>
    allAttachments.filter((entry) => !entry.deleted).map((entry) => entry.id);
  item.getBestAttachment = async () =>
    allAttachments.find((entry) => !entry.deleted);
  const response = () => ({
    status: 200,
    headers: { get: (name) => state.headers[name] || null },
  });
  const zotero = {
    Prefs: {
      get: (key) => preferences.get(key),
      set: (key, value) => preferences.set(key, value),
    },
    Libraries: { get: () => ({ filesEditable: state.writable !== false }) },
    Items: {
      get: (ids) => allAttachments.filter((entry) => ids.includes(entry.id)),
    },
    Attachments: {
      LINK_MODE_IMPORTED_URL: 1,
      getFileResolvers: () => [{ pageURL: "https://doi.org/" + published.DOI }],
      createTemporaryStorageDirectory: async () => file("/tmp/pdf-test"),
      createDirectoryForItem: async () => "/storage/new",
      getFileBaseNameFromItem: () => "paper",
    },
    Utilities: { Internal: { md5Async: async () => state.hash } },
    File: {
      pathToFile: file,
      getValidFileName: (name) => name,
      copyToUnique: (_, target) => target,
      setNormalFilePermissions: async () => {},
    },
    MIME: { getMIMETypeFromFile: async () => state.mime },
    HTTP: {
      request: async (_, __, options) => {
        state.heads++;
        return state.heading
          ? state.heading(options)
          : {
              status: 200,
              getResponseHeader: (name) => state.headers[name] || null,
            };
      },
      download: async (_, __, options) => {
        state.downloads++;
        assert.equal(options.noCache, true);
        const result = await state.downloading?.(options);
        return result || response();
      },
    },
    Item: class {
      constructor() {
        this.id = 8 + state.imported.length;
        this.key = "NEWPDF" + this.id;
        this.hash = state.hash;
        state.pending = this;
      }
      get attachmentHash() {
        return Promise.resolve(this.hash);
      }
      toJSON() {
        return { key: this.key, deleted: this.deleted };
      }
      isEditable() {
        return true;
      }
      getAnnotations() {
        return [];
      }
      getNotes() {
        return [];
      }
      getNote() {
        return "";
      }
      getField() {
        return "Full Text";
      }
      async reload() {
        this.deleted = state.trashed.includes(this.id);
      }
      setField() {}
      setAutoAttachmentTitle() {}
      async save() {
        await state.saving?.();
      }
    },
    DB: {
      executeTransaction: async (run) => {
        const before = allAttachments.map((entry) => entry.deleted);
        try {
          await run();
          if (state.pending) {
            allAttachments.push(state.pending);
            state.pending = undefined;
            state.imported.push(true);
          }
          for (const entry of allAttachments)
            if (entry.deleted && !state.trashed.includes(entry.id))
              state.trashed.push(entry.id);
        } catch (error) {
          state.pending = undefined;
          allAttachments.forEach(
            (entry, index) => (entry.deleted = before[index]),
          );
          throw error;
        }
      },
    },
    FullText: { queueItem: async () => {} },
    logError() {},
    debug() {},
  };
  const updater = new PDFUpdater(zotero, async () => doc);
  return {
    item,
    state,
    operation,
    updater,
    zotero,
    doc,
    old,
    allAttachments,
    preferences,
  };
}

test("changed published PDF is added and existing attachments and annotations are retained", async () => {
  const { item, state, operation, updater } = fixture();
  const before = item.toJSON();
  assert.equal(await updater.update(item, operation), "added");
  assert.equal(state.imported.length, 1);
  assert.deepEqual(item.toJSON(), before);
  assert.deepEqual(state.removed, ["/tmp/pdf-test"]);
});

test("identical file is skipped even when downloaded from a different URL", async () => {
  const { item, state, operation, updater } = fixture();
  state.existing = state.hash;
  assert.equal(await updater.update(item, operation), "unchanged");
  assert.equal(state.imported.length, 0);
});

test("HTML challenge responses and conflicting article identities cannot become PDFs", async () => {
  for (const change of [
    { mime: "text/html" },
    { doi: "10.1000/other" },
    { title: "An entirely different article" },
  ]) {
    const { item, state, operation, updater } = fixture();
    Object.assign(state, change);
    await assert.rejects(
      updater.update(item, operation),
      /not a PDF|article identity/,
    );
    assert.equal(state.imported.length, 0);
    if (!change.mime) assert.equal(state.downloads, 0);
  }
});

test("cancellation aborts a pending download and prevents import", async () => {
  const { item, state, operation, updater } = fixture();
  let aborted = false;
  state.downloading = async (options) => {
    options.cancellerReceiver(() => {
      aborted = true;
    });
    operation.cancel();
  };
  await assert.rejects(updater.update(item, operation), /cancelled/);
  assert.equal(aborted, true);
  assert.equal(state.imported.length, 0);
  assert.deepEqual(state.removed, ["/tmp/pdf-test"]);
});

test("cancellation during import rolls back the transaction and removes new storage", async () => {
  const { item, state, operation, updater } = fixture();
  let saves = 0;
  state.saving = async () => {
    if (++saves === 2) operation.cancel();
  };
  await assert.rejects(updater.update(item, operation), /cancelled/);
  assert.equal(state.imported.length, 0);
  assert.deepEqual(state.removed, ["/storage/new", "/tmp/pdf-test"]);
});

test("concurrent parent edits prevent attachment writes", async () => {
  const { item, state, operation, updater } = fixture();
  state.downloading = async () => item.setField("title", "User edit");
  await assert.rejects(updater.update(item, operation), /changed during/);
  assert.equal(state.imported.length, 0);
});

test("preprints and libraries without file permissions are skipped", async () => {
  for (const preprint of [true, false]) {
    const { item, state, operation, updater } = fixture();
    if (preprint)
      Object.assign(item.data, {
        itemType: "preprint",
        DOI: "10.48550/arXiv.2501.01234",
      });
    else state.writable = false;
    assert.equal(await updater.update(item, operation), "skipped");
    assert.equal(state.downloads, 0);
  }
});

test("Zotero translators can supply the PDF when citation_pdf_url is absent", async () => {
  const { item, state, operation, updater, zotero, doc } = fixture();
  const query = doc.querySelectorAll;
  doc.querySelectorAll = (selector) =>
    selector.includes("citation_pdf_url") ? [] : query(selector);
  zotero.Utilities.Internal.getFileFromDocument = async (page) => {
    assert.equal(page, doc);
    return { url: "/translator.pdf" };
  };
  assert.equal(await updater.update(item, operation), "added");
  assert.equal(state.imported.length, 1);
});

test("a DOI-less article page requires author agreement as well as title agreement", async () => {
  for (const author of ["Zhi Lu", "Alice Smith"]) {
    const { item, state, operation, updater } = fixture();
    state.doi = "No DOI";
    state.author = author;
    if (author === "Zhi Lu")
      assert.equal(await updater.update(item, operation), "added");
    else {
      await assert.rejects(updater.update(item, operation), /article identity/);
      assert.equal(state.downloads, 0);
    }
  }
});

test("published DOI downloads never fall back to a retained manuscript URL", async () => {
  const { item, state, operation, updater, zotero } = fixture();
  item.data.url = "https://author.example/accepted-manuscript";
  zotero.Attachments.getFileResolvers = (_, methods) => {
    assert.deepEqual(methods, ["doi"]);
    return [{ pageURL: "https://doi.org/" + published.DOI }];
  };
  state.mime = "text/html";
  await assert.rejects(updater.update(item, operation), /not a PDF/);
  assert.equal(state.downloads, 1);
  assert.equal(state.imported.length, 0);
});

test("published records without a DOI use their verified article URL", async () => {
  const { item, operation, updater, zotero } = fixture();
  delete item.data.DOI;
  item.data.url = "https://publisher.example/article";
  zotero.Attachments.getFileResolvers = (_, methods) => {
    assert.deepEqual(methods, ["url"]);
    return [{ pageURL: item.data.url }];
  };
  assert.equal(await updater.update(item, operation), "added");
});

test("a replaced main PDF without Zotero annotations is moved to Trash", async () => {
  const { item, state, operation, updater, old, allAttachments } = fixture();
  state.annotations = [];
  const supplement = {
    id: 90,
    key: "SUPPLEMENT",
    deleted: false,
    attachmentContentType: "application/pdf",
    attachmentHash: Promise.resolve("supplement"),
  };
  allAttachments.push(supplement);
  assert.equal(await updater.update(item, operation), "added");
  assert.equal(old.deleted, true);
  assert.deepEqual(state.trashed, [7]);
  assert.equal(supplement.deleted, false);
});

test("annotations added while downloading protect the old PDF", async () => {
  const { item, state, operation, updater, old } = fixture();
  state.annotations = [];
  state.downloading = async () => {
    state.annotations.push("new highlight");
  };
  await updater.update(item, operation);
  assert.equal(old.deleted, false);
});

test("local edits to the old file during download protect it", async () => {
  const { item, state, operation, updater, old } = fixture();
  state.annotations = [];
  state.downloading = async () => {
    state.existing = "edited";
  };
  await updater.update(item, operation);
  assert.equal(old.deleted, false);
});

test("failed import and cancellation during trashing restore the old PDF", async () => {
  for (const cancel of [true, false]) {
    const { item, state, operation, updater, old, preferences } = fixture();
    state.annotations = [];
    if (cancel) state.trashing = async () => operation.cancel();
    else
      state.saving = async () => {
        throw new Error("Save failed");
      };
    await assert.rejects(
      updater.update(item, operation),
      /cancelled|Save failed/,
    );
    assert.equal(old.deleted, false);
    assert.equal(state.imported.length, 0);
    assert.equal(preferences.has(PDF_CACHE_PREF), false);
  }
});

test("ETag reuse survives new updater instances and transfers no PDF body", async () => {
  const { item, state, operation, updater, zotero, doc } = fixture();
  state.headers = { ETag: '"v1"' };
  await updater.update(item, operation);
  state.heading = async (options) => {
    assert.equal(options.headers["If-None-Match"], '"v1"');
    return { status: 304, getResponseHeader: () => null };
  };
  assert.equal(
    await new PDFUpdater(zotero, async () => doc).update(item, operation),
    "unchanged",
  );
  assert.equal(state.downloads, 1);
  assert.equal(state.heads, 1);
});

test("changed remote ETag downloads a revision and trashes the last unannotated version", async () => {
  const { item, state, operation, updater, allAttachments } = fixture();
  state.headers = { ETag: '"v1"' };
  await updater.update(item, operation);
  const first = allAttachments.at(-1);
  state.headers = { ETag: '"v2"' };
  state.hash = "revision2";
  await updater.update(item, operation);
  assert.equal(state.downloads, 2);
  assert.equal(first.deleted, true);
  assert.equal(allAttachments[0].deleted, false);
});

test("stable Last-Modified and size avoid another PDF transfer", async () => {
  const { item, state, operation, updater } = fixture();
  state.headers = {
    "Last-Modified": "Fri, 16 Oct 2026 00:00:00 GMT",
    "Content-Length": "123",
  };
  await updater.update(item, operation);
  await updater.update(item, operation);
  assert.equal(state.downloads, 1);
  state.headers["Content-Length"] = "124";
  state.hash = "changed";
  await updater.update(item, operation);
  assert.equal(state.downloads, 2);
});

test("HEAD rejection falls back to conditional GET and handles 304 without importing", async () => {
  const { item, state, operation, updater } = fixture();
  state.headers = { ETag: '"v1"' };
  await updater.update(item, operation);
  state.heading = async () => {
    throw new Error("HTTP 405");
  };
  state.downloading = async (options) => {
    assert.equal(options.headers["If-None-Match"], '"v1"');
    return { status: 304 };
  };
  assert.equal(await updater.update(item, operation), "unchanged");
  assert.equal(state.imported.length, 1);
});

test("sources without validators reuse for 24 hours without sliding the expiry", async () => {
  const { item, state, operation, updater } = fixture();
  const now = Date.now;
  let time = now();
  Date.now = () => time;
  try {
    await updater.update(item, operation);
    time += PDF_RECHECK_INTERVAL / 2;
    await updater.update(item, operation);
    assert.equal(state.downloads, 1);
    time += PDF_RECHECK_INTERVAL / 2 + 1;
    await updater.update(item, operation);
    assert.equal(state.downloads, 2);
  } finally {
    Date.now = now;
  }
});

test("missing or edited local PDFs invalidate version reuse", async () => {
  for (const missing of [true, false]) {
    const { item, state, operation, updater, allAttachments } = fixture();
    state.headers = { ETag: '"v1"' };
    await updater.update(item, operation);
    allAttachments.at(-1).hash = missing ? null : "edited";
    state.downloading = async (options) => {
      assert.equal(options.headers["If-None-Match"], undefined);
    };
    await updater.update(item, operation);
    assert.equal(state.downloads, 2);
  }
});

test("a changed PDF URL invalidates reuse even if it advertises the same ETag", async () => {
  const { item, state, operation, updater, doc } = fixture();
  state.headers = { ETag: '"v1"' };
  await updater.update(item, operation);
  const original = doc.querySelectorAll;
  doc.querySelectorAll = (selector) =>
    selector.includes("citation_pdf_url")
      ? [{ getAttribute: () => "https://publisher.example/revision2.pdf" }]
      : original(selector);
  await updater.update(item, operation);
  assert.equal(state.downloads, 2);
});

test("invalid cache data is discarded so PDF checks can recover", async () => {
  for (const raw of [
    '{"version":99,"entries":[]}',
    "not json",
    '{"version":1,"entries":[["bad"]]}',
  ]) {
    const { item, state, operation, updater, preferences } = fixture();
    preferences.set(PDF_CACHE_PREF, raw);
    assert.equal(await updater.update(item, operation), "added");
    assert.equal(state.downloads, 1);
    assert.equal(state.imported.length, 1);
    assert.equal(JSON.parse(preferences.get(PDF_CACHE_PREF)).version, 1);
  }
});

test("a supplementary PDF is preserved even if Zotero treats it as the default attachment", async () => {
  const { item, state, operation, updater, old } = fixture();
  state.annotations = [];
  old.getField = () => "Supplementary material";
  await updater.update(item, operation);
  assert.equal(old.deleted, false);
});
