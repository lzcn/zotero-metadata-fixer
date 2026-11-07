import type { Candidate, Item, Metadata, RetrievalSource } from "./model";
import {
  identifiers,
  isPreprint,
  preprintDOI,
  cleanDOI,
  canonicalDOI,
  officialPublicationURL,
  doiURL,
  conferencePoster,
} from "./identifiers";
import {
  articleEvidence,
  bibliographyEvidence,
  normalizeMetadata,
  needsContainerTitle,
  supplementMetadata,
  matchesPublication,
  hasPublicationEvidence,
} from "./metadata";
import { checkAccess } from "./responses";
import { titleScore, matchesAuthors } from "./matching";
import { containerField } from "./venues";
import { conferenceSiteMetadata } from "./conference-site";
import type { PublicationFinder, Network } from "./providers";

const DOI_ITEM_TYPES = new Set([
  "journalArticle",
  "conferencePaper",
  "bookSection",
  "preprint",
]);

function needsDOIEnrichment(metadata: Metadata): boolean {
  const container = containerField(metadata.itemType);
  return Boolean(
    (container && !metadata[container]) ||
      !metadata.creators?.length ||
      !DOI_ITEM_TYPES.has(metadata.itemType),
  );
}

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

  private applyConferenceVenue(
    metadata: Metadata,
    candidate?: Candidate,
  ): Metadata {
    if (!candidate?.conferenceVenue) return metadata;
    if (
      titleScore(metadata.title, candidate.title) < 0.9 ||
      !matchesAuthors(metadata.creators || [], candidate.authors) ||
      (metadata.conferenceVenue &&
        metadata.conferenceVenue.id !== candidate.conferenceVenue.id)
    )
      throw new Error("Conflicting OpenReview metadata");
    return {
      ...metadata,
      itemType: "conferencePaper",
      proceedingsTitle: candidate.conferenceVenue.title,
      conferenceVenue: candidate.conferenceVenue,
    };
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

  private async translated(identifier: {
    DOI?: string;
    PMID?: string;
  }): Promise<Metadata> {
    const translate = new this.zotero.Translate.Search();
    translate.setIdentifier(identifier);
    return this.run(translate);
  }

  private checkDOI(doi: string, metadata: Metadata): void {
    if (
      metadata.DOI &&
      canonicalDOI(doi) !== canonicalDOI(String(metadata.DOI))
    )
      throw new Error("Conflicting DOI metadata");
  }

  private async doi(doi: string): Promise<Metadata> {
    try {
      const metadata = await this.translated({ DOI: doi });
      this.checkDOI(doi, metadata);
      return metadata.DOI ? metadata : { ...metadata, DOI: doi };
    } catch (error) {
      this.checkActive();
      // Some DOI translators land on a blocked publisher page. Content
      // negotiation is host-independent and returns one BibTeX record.
      let bibtex: string;
      try {
        bibtex = await this.net.text(doiURL(doi), {
          Accept: "application/x-bibtex",
        });
        this.checkActive();
      } catch (fallback) {
        this.checkActive();
        throw new Error(`${String(error)}. DOI BibTeX: ${String(fallback)}`);
      }
      try {
        const metadata = await this.bibtex(bibtex);
        this.checkDOI(doi, metadata);
        return metadata.DOI ? metadata : { ...metadata, DOI: doi };
      } catch (fallback) {
        this.checkActive();
        throw new Error(`${String(error)}. DOI BibTeX: ${String(fallback)}`);
      }
    }
  }

  private async enrichDOI(
    doi: string,
    metadata: Metadata,
    warnings: string[],
  ): Promise<Metadata> {
    if (!needsDOIEnrichment(metadata)) return metadata;
    const sources: [
      string,
      (value: string) => Promise<Metadata | undefined>,
    ][] = [
      ["Crossref", (value) => this.finder.crossrefDOI(value)],
      // DataCite covers DOIs that Crossref does not register; OpenAlex remains
      // the broad fallback for the remaining agencies.
      ["DataCite", (value) => this.finder.dataCiteDOI(value)],
      ["OpenAlex", (value) => this.finder.openAlexDOI(value)],
    ];
    let found = false;
    for (const [source, retrieve] of sources) {
      this.checkActive();
      try {
        const record = await retrieve(doi);
        if (!record) continue;
        this.checkDOI(doi, record);
        found = true;
        metadata = supplementMetadata(metadata, record);
        // Prefer a supported record type only when the translation has none.
        if (
          !DOI_ITEM_TYPES.has(metadata.itemType) &&
          DOI_ITEM_TYPES.has(record.itemType)
        )
          metadata = { ...metadata, itemType: record.itemType };
      } catch (error) {
        if (!this.active()) throw error;
        warnings.push(`${source}: ${String(error)}`);
      }
      if (found && !needsDOIEnrichment(metadata)) break;
    }
    return metadata;
  }

  async identifier(
    identifier: {
      DOI?: string;
      PMID?: string;
    },
    warnings?: string[],
  ): Promise<Metadata> {
    let metadata = identifier.DOI
      ? await this.doi(identifier.DOI)
      : await this.translated(identifier);
    if (identifier.DOI && warnings) {
      this.checkActive();
      metadata = await this.enrichDOI(identifier.DOI, metadata, warnings);
    }
    if (identifier.DOI) this.checkDOI(identifier.DOI, metadata);
    if (identifier.PMID || (identifier.DOI && !preprintDOI(identifier.DOI)))
      metadata = {
        ...metadata,
        publicationEvidence: identifier.DOI ? "identifier" : "index",
      };
    return metadata;
  }

  async bibtex(text: string): Promise<Metadata> {
    const translate = new this.zotero.Translate.Import();
    translate.setString(text);
    return this.run(translate);
  }

  async url(url: string): Promise<Metadata> {
    if (!/^https?:\/\//i.test(url))
      throw new Error("Only HTTP(S) item URLs are supported");
    this.checkActive();
    const page = new URL(url);
    if (/\.bib$/i.test(page.pathname)) {
      const text = await this.net.text(url);
      this.checkActive();
      checkAccess(text);
      const metadata = await this.bibtex(text);
      return /^(?:dblp\.org|dblp\.dagstuhl\.de|dblp\.uni-trier\.de)$/.test(
        page.hostname,
      ) && /^\/rec\/(?:conf|journals|books|reference)\//.test(page.pathname)
        ? { ...metadata, publicationEvidence: "index" }
        : metadata;
    }
    let accepted: Candidate | undefined;
    if (
      page.hostname.replace(/^www\./, "") === "openreview.net" &&
      page.pathname === "/forum"
    ) {
      const forum = page.searchParams.get("id");
      accepted = forum
        ? (await this.finder.openreview({ getField: () => "" }, forum)).find(
            (record) => new URL(record.url!).searchParams.get("id") === forum,
          )
        : undefined;
      this.checkActive();
      if (!accepted) throw new Error("No published OpenReview record found");
      if (accepted.bibtex)
        return {
          ...this.applyConferenceVenue(
            await this.bibtex(accepted.bibtex),
            accepted,
          ),
          publicationEvidence: "index",
        };
    }
    const docs = this.document
      ? [await this.document(url)]
      : await this.zotero.HTTP.processDocuments(url, (doc: Document) => doc);
    this.checkActive();
    if (!docs[0]) throw new Error("Unable to load item URL");
    const doc: Document = docs[0];
    const conference = conferencePoster(url);
    if (conference) {
      const metadata = conferenceSiteMetadata(doc, url);
      const listed = await this.finder.conferenceSite(
        {
          getField: () => metadata.title,
          getCreators: () => metadata.creators || [],
        },
        `${conference.conference} ${conference.year}`,
      );
      this.checkActive();
      // Workshop posters can share the main site's URL shape and JSON-LD credit.
      if (
        !listed.some(
          (record) => new URL(record.url!).pathname === page.pathname,
        )
      )
        throw new Error("Conference record is not in the official paper list");
      return { ...metadata, publicationEvidence: "proceedings" };
    }
    const { doi, bibtex, bibliographyURL, title } = articleEvidence(doc, url);
    const verifyTitle = (record: Metadata) => {
      if (title && titleScore(title, record.title) < 0.9)
        throw new Error("Conflicting article metadata");
      return record;
    };
    let identified: Metadata | undefined;
    if (doi && !preprintDOI(doi)) {
      try {
        const resolved = verifyTitle(await this.identifier({ DOI: doi }));
        if (!needsContainerTitle(resolved)) return resolved;
        identified = resolved;
      } catch (error) {
        this.checkActive();
        // The official web translator can work when the DOI service cannot.
      }
    }
    // Embedded BibTeX often contains proceedings/publisher fields omitted by web translators.
    let bibliography: Metadata | undefined;
    if (bibtex || bibliographyURL) {
      try {
        let text = bibtex;
        if (!text) {
          const response = await this.net.text(bibliographyURL!);
          this.checkActive();
          checkAccess(response);
          text = /^\s*@(?:inproceedings|article|incollection)\s*[{(]/i.test(
            response,
          )
            ? response
            : bibliographyEvidence(this.net.html(response));
        }
        if (!text) throw new Error("No article bibliography found");
        bibliography = verifyTitle(await this.bibtex(text));
      } catch (error) {
        this.checkActive();
        // A web translator can still retrieve the article when BibTeX is malformed.
      }
    }
    let metadata: Metadata;
    try {
      const translate = new this.zotero.Translate.Web();
      translate.setDocument(doc);
      metadata = verifyTitle(await this.run(translate));
    } catch (error) {
      this.checkActive();
      if (!bibliography && !identified) throw error;
      metadata = bibliography || identified!;
    }
    // Explicit bibliography entry types outrank generic web citation meta tags.
    if (bibliography) metadata = supplementMetadata(bibliography, metadata);
    if (identified)
      metadata = bibliography
        ? supplementMetadata(metadata, identified)
        : supplementMetadata(identified, metadata);
    if (!metadata.url) metadata.url = url;
    metadata = this.applyConferenceVenue(metadata, accepted);
    if (accepted) metadata = { ...metadata, publicationEvidence: "index" };
    return doi && !preprintDOI(doi) && !metadata.DOI
      ? { ...metadata, DOI: doi }
      : metadata;
  }

  async retrieve(
    item: Item,
    source: RetrievalSource,
    warnings?: string[],
  ): Promise<Metadata> {
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
        return this.identifier({ DOI: id }, warnings);
      case "PMID":
        return this.identifier({ PMID: id }, warnings);
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
        let metadata = await this.retrieve(item, source, warnings);
        if (!active()) throw new Error("Operation cancelled");
        if (source !== "URL" && needsContainerTitle(metadata) && ids.URL) {
          try {
            metadata = supplementMetadata(metadata, await this.url(ids.URL));
            if (!active()) throw new Error("Operation cancelled");
          } catch (error) {
            if (!active()) throw error;
            warnings.push(`Article metadata: ${String(error)}`);
          }
        }
        if (
          source === "URL" &&
          (!ids.DOI || preprintDOI(ids.DOI)) &&
          metadata.itemType !== "preprint" &&
          (!matchesPublication(
            item,
            { source, title: item.getField("title"), url: ids.URL },
            metadata,
          ) ||
            ((isPreprint(item) || item.itemType !== metadata.itemType) &&
              !hasPublicationEvidence(
                { source, title: item.getField("title"), url: ids.URL },
                metadata,
              )))
        )
          throw new Error("Unverified publication metadata");
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
    const complete = (metadata: Metadata): Metadata => {
      metadata = this.applyConferenceVenue(metadata, candidate);
      if (candidate.publicationEvidence)
        metadata = {
          ...metadata,
          publicationEvidence: candidate.publicationEvidence,
        };
      if (
        candidate.doi &&
        metadata.DOI &&
        canonicalDOI(candidate.doi) !== canonicalDOI(String(metadata.DOI))
      )
        throw new Error("Conflicting DOI metadata");
      return candidate.doi && !metadata.DOI
        ? { ...metadata, DOI: candidate.doi }
        : metadata;
    };
    const errors: string[] = [];
    const sources: [string, () => Promise<Metadata>][] = [];
    if (candidate.doi)
      sources.push([
        "DOI",
        () => this.identifier({ DOI: candidate.doi }, errors),
      ]);
    const official = candidate.url && officialPublicationURL(candidate.url);
    if (official) sources.push(["Article", () => this.url(candidate.url!)]);
    if (candidate.bibtex)
      sources.push(["BibTeX", () => this.bibtex(candidate.bibtex!)]);
    if (candidate.url && !official)
      sources.push(["URL", () => this.url(candidate.url!)]);
    let partial: Metadata | undefined;
    for (const [source, retrieve] of sources) {
      if (!active()) throw new Error("Operation cancelled");
      this.checkActive();
      try {
        const retrieved = complete(await retrieve());
        if (!active()) throw new Error("Operation cancelled");
        this.checkActive();
        const metadata = partial
          ? supplementMetadata(partial, retrieved)
          : retrieved;
        if (!needsContainerTitle(metadata)) return metadata;
        // Retain successful fields while later sources supply the missing container.
        partial = metadata;
      } catch (error) {
        if (!active()) throw error;
        this.checkActive();
        errors.push(`${source}: ${String(error)}`);
      }
    }
    if (partial) return partial;
    throw new Error(
      errors.join("\n") || "Candidate has no retrievable identifier",
    );
  }
}
