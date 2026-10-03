import type { Candidate, Item, Metadata, RetrievalSource } from "./model";
import { identifiers, isPreprint, preprintDOI } from "./identifiers";
import type { PublicationFinder, Network } from "./providers";

// Zotero translators are the host boundary. libraryID:false returns plain records.
export class MetadataRetriever {
  constructor(
    private zotero: any,
    private finder: PublicationFinder,
    private net: Network,
    private active: () => boolean = () => true,
    private document?: (url: string) => Promise<Document>,
  ) {}

  private checkActive(): void {
    if (!this.active()) throw new Error("Operation cancelled");
  }

  private async run(translate: any): Promise<Metadata> {
    this.checkActive();
    const translators = await translate.getTranslators();
    this.checkActive();
    if (!translators.length)
      throw new Error("No suitable Zotero translator found");
    translate.setTranslator(translators);
    translate.setHandler(
      "selectItems",
      (_: unknown, __: unknown, callback: (selection: false) => void) =>
        callback(false),
    );
    const records = await translate.translate({
      libraryID: false,
      saveAttachments: false,
    });
    this.checkActive();
    if (records.length !== 1 || !records[0].title)
      throw new Error("Expected one complete metadata record");
    return records[0] as Metadata;
  }

  async identifier(identifier: {
    DOI?: string;
    PMID?: string;
  }): Promise<Metadata> {
    const translate = new this.zotero.Translate.Search();
    translate.setIdentifier(identifier);
    return this.run(translate);
  }

  async bibtex(text: string): Promise<Metadata> {
    const translate = new this.zotero.Translate.Import();
    translate.setString(text);
    return this.run(translate);
  }

  async url(url: string): Promise<Metadata> {
    if (!/^https?:\/\//i.test(url))
      throw new Error("Only HTTP(S) item URLs are supported");
    if (/^https?:\/\/dblp\.[^/]+\/rec\/.+\.bib(?:\?|$)/i.test(url))
      return this.bibtex(await this.net.text(url));
    this.checkActive();
    const docs = this.document
      ? [await this.document(url)]
      : await this.zotero.HTTP.processDocuments(url, (doc: Document) => doc);
    this.checkActive();
    if (!docs[0]) throw new Error("Unable to load item URL");
    const translate = new this.zotero.Translate.Web();
    translate.setDocument(docs[0]);
    return this.run(translate);
  }

  async retrieve(item: Item, source: RetrievalSource): Promise<Metadata> {
    const id = identifiers(item)[source];
    if (!id) throw new Error(`Item has no valid ${source} identifier`);
    switch (source) {
      case "arXiv": {
        const { metadata } = await this.finder.arxiv(id);
        if (!metadata) throw new Error("arXiv record not found");
        return metadata;
      }
      case "URL":
        return this.url(id);
      case "DOI":
        return this.identifier({ DOI: id });
      case "PMID":
        return this.identifier({ PMID: id });
    }
  }

  async retrieveCurrent(
    item: Item,
    active: () => boolean = () => true,
  ): Promise<{
    metadata: Metadata;
    source: RetrievalSource;
    warnings: string[];
  }> {
    const ids = identifiers(item);
    const sources: RetrievalSource[] =
      isPreprint(item) && ids.arXiv && (!ids.DOI || preprintDOI(ids.DOI))
        ? ["arXiv", "DOI", "PMID", "URL"]
        : ["DOI", "PMID", "URL"];
    const warnings: string[] = [];
    for (const source of sources) {
      if (!active()) throw new Error("Operation cancelled");
      if (!ids[source]) continue;
      try {
        const metadata = await this.retrieve(item, source);
        if (!active()) throw new Error("Operation cancelled");
        return { metadata, source, warnings };
      } catch (error) {
        if (!active()) throw error;
        warnings.push(`${source}: ${String(error)}`);
      }
    }
    throw new Error(
      warnings.join("\n") || "Item has no valid metadata identifier",
    );
  }

  async candidate(
    candidate: Candidate,
    active: () => boolean = () => true,
  ): Promise<Metadata> {
    if (!active()) throw new Error("Operation cancelled");
    const complete = (metadata: Metadata): Metadata =>
      candidate.doi && !metadata.DOI
        ? { ...metadata, DOI: candidate.doi }
        : metadata;
    if (candidate.doi) {
      try {
        return complete(await this.identifier({ DOI: candidate.doi }));
      } catch (error) {
        if (!active() || (!candidate.url && !candidate.bibtex)) throw error;
      }
    }
    // An official article page can recover metadata when DOI resolution fails.
    if (
      candidate.url &&
      /^https:\/\/ieeexplore\.ieee\.org\/(?:document|abstract\/document)\/\d+/i.test(
        candidate.url,
      )
    ) {
      try {
        return complete(await this.url(candidate.url));
      } catch (error) {
        if (!active() || !candidate.bibtex) throw error;
      }
    }
    if (!active()) throw new Error("Operation cancelled");
    if (candidate.bibtex) return complete(await this.bibtex(candidate.bibtex));
    if (candidate.url) return complete(await this.url(candidate.url));
    throw new Error("Candidate has no retrievable identifier");
  }
}
