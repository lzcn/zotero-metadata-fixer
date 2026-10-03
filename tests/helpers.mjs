export class FakeItem {
  constructor() {
    this.id = 42;
    this.key = "OLDKEY42";
    this.libraryID = 1;
    this.itemTypeID = 1;
    this.deleted = false;
    this.editable = true;
    this.data = {
      itemType: "preprint",
      title: "Learning useful representations",
      date: "2025-01-02",
      url: "https://arxiv.org/abs/2501.01234v1",
      archiveID: "arXiv:2501.01234v1",
      extra: "Citation Key: lu2025\nMy custom text",
      creators: [{ firstName: "Zhi", lastName: "Lu", creatorType: "author" }],
      collections: ["COLLKEY"],
      tags: [{ tag: "read" }],
      relations: { "dc:relation": ["related"] },
      dateAdded: "2025-01-02",
      attachments: [7],
      notes: [8],
    };
    this.persisted = structuredClone(this.data);
    this.saved = 0;
    this.reloaded = 0;
  }
  get itemType() {
    return this.data.itemType;
  }
  getField(field) {
    return this.data[field] || "";
  }
  getCreators() {
    return structuredClone(this.data.creators);
  }
  isRegularItem() {
    return true;
  }
  isEditable() {
    return this.editable;
  }
  toJSON() {
    return structuredClone(this.data);
  }
  setType(type) {
    this.itemTypeID = type;
    this.data.itemType = {
      1: "preprint",
      2: "journalArticle",
      3: "conferencePaper",
      4: "bookSection",
      5: "book",
    }[type];
    if (type !== 1) delete this.data.archiveID;
    if (type === 3) {
      if (this.data.bookTitle && !this.data.proceedingsTitle)
        this.data.proceedingsTitle = this.data.bookTitle;
      delete this.data.bookTitle;
    }
  }
  setField(field, value) {
    this.data[field] = value;
  }
  setCreators(value) {
    this.data.creators = structuredClone(value);
  }
  async save() {
    if (this.failSave) throw new Error("database failed");
    this.saved++;
    this.persisted = structuredClone(this.data);
  }
  async reload() {
    this.reloaded++;
    this.data = structuredClone(this.persisted);
    this.itemTypeID = {
      preprint: 1,
      journalArticle: 2,
      conferencePaper: 3,
      bookSection: 4,
      book: 5,
    }[this.data.itemType];
  }
}
export function hostFor(item) {
  return {
    active: () => true,
    typeID: (type) =>
      ({
        preprint: 1,
        journalArticle: 2,
        conferencePaper: 3,
        bookSection: 4,
        book: 5,
      })[type] || 0,
    validField: (field, type) =>
      !["itemType", "dateAdded", "key", "version"].includes(field) &&
      (field !== "archiveID" || type === 1) &&
      (field !== "bookTitle" || type === 4 || type === 5) &&
      (!["proceedingsTitle", "conferenceName"].includes(field) || type === 3) &&
      (field !== "publicationTitle" || type === 2),
    validCreator: () => true,
    creatorTypeName: (id) => (id === 99 ? "editor" : "author"),
    transaction: async (run) => {
      const old = structuredClone(item.persisted);
      try {
        return await run();
      } catch (error) {
        item.persisted = old;
        throw error;
      }
    },
  };
}
export const published = {
  itemType: "journalArticle",
  title: "Learning useful representations for language",
  date: "2026",
  DOI: "10.1000/published",
  publicationTitle: "Journal of Useful Research",
  url: "https://doi.org/10.1000/published",
  creators: [{ firstName: "Zhi", lastName: "Lu", creatorType: "author" }],
};
