import type { Candidate, Item, Metadata, RetrievalSource } from "./model";
import {
  identifiers,
  isPreprint,
  preprintDOI,
  cleanDOI,
  officialPublicationURL,
} from "./identifiers";
import {
  articleEvidence,
  normalizeMetadata,
  needsContainerTitle,
  supplementMetadata,
} from "./metadata";
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
    const metadata = records[0] as Metadata;
    return normalizeMetadata(metadata);
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
    const page = new URL(url);
    if (
      page.hostname.replace(/^www\./, "") === "openreview.net" &&
      page.pathname === "/forum"
    ) {
      const forum = page.searchParams.get("id");
      const accepted = forum
        ? (await this.finder.openreview({ getField: () => "" }, forum)).find(
            (record) => new URL(record.url!).searchParams.get("id") === forum,
          )
        : undefined;
      this.checkActive();
      if (!accepted) throw new Error("No published OpenReview record found");
      if (accepted.bibtex) return this.bibtex(accepted.bibtex);
    }
    const docs = this.document
      ? [await this.document(url)]
      : await this.zotero.HTTP.processDocuments(url, (doc: Document) => doc);
    this.checkActive();
    if (!docs[0]) throw new Error("Unable to load item URL");
    const doc: Document = docs[0];
    const { doi, bibtex } = articleEvidence(doc, url);
    let identified: Metadata | undefined;
    if (doi && !preprintDOI(doi)) {
      try {
        const resolved = await this.identifier({ DOI: doi });
        if (!needsContainerTitle(resolved)) return resolved;
        identified = resolved;
      } catch (error) {
        this.checkActive();
        // The official web translator can work when the DOI service cannot.
      }
    }
    // Embedded BibTeX often contains proceedings/publisher fields omitted by web translators.
    let bibliography: Metadata | undefined;
    if (bibtex) {
      try {
        bibliography = await this.bibtex(bibtex);
      } catch (error) {
        this.checkActive();
        // A web translator can still retrieve the article when BibTeX is malformed.
      }
    }
    let metadata: Metadata;
    try {
      const translate = new this.zotero.Translate.Web();
      translate.setDocument(doc);
      metadata = await this.run(translate);
    } catch (error) {
      this.checkActive();
      if (!bibliography && !identified) throw error;
      metadata = bibliography || identified!;
    }
    if (bibliography) metadata = supplementMetadata(metadata, bibliography);
    if (identified) metadata = supplementMetadata(identified, metadata);
    if (!metadata.url) metadata.url = url;
    return doi && !preprintDOI(doi) && !metadata.DOI
      ? { ...metadata, DOI: doi }
      : metadata;
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
        let metadata = await this.retrieve(item, source);
        if (!active()) throw new Error("Operation cancelled");
        if (
          source !== "URL" &&
          needsContainerTitle(metadata) &&
          ids.URL &&
          officialPublicationURL(ids.URL)
        ) {
          try {
            metadata = supplementMetadata(metadata, await this.url(ids.URL));
            if (!active()) throw new Error("Operation cancelled");
          } catch (error) {
            if (!active()) throw error;
            warnings.push(`Article metadata: ${String(error)}`);
          }
        }
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
    const sources: [string, () => Promise<Metadata>][] = [];
    if (candidate.doi)
      sources.push(["DOI", () => this.identifier({ DOI: candidate.doi })]);
    const official = candidate.url && officialPublicationURL(candidate.url);
    if (official) sources.push(["Article", () => this.url(candidate.url!)]);
    if (candidate.bibtex)
      sources.push(["BibTeX", () => this.bibtex(candidate.bibtex!)]);
    if (candidate.url && !official)
      sources.push(["URL", () => this.url(candidate.url!)]);
    const errors: string[] = [];
    for (const [source, retrieve] of sources) {
      if (!active()) throw new Error("Operation cancelled");
      this.checkActive();
      try {
        const metadata = complete(await retrieve());
        if (!active()) throw new Error("Operation cancelled");
        return metadata;
      } catch (error) {
        if (!active()) throw error;
        this.checkActive();
        errors.push(`${source}: ${String(error)}`);
      }
    }
    throw new Error(
      errors.join("\n") || "Candidate has no retrievable identifier",
    );
  }
}
