import type {
  Candidate,
  ConferenceVenue,
  Item,
  Lookup,
  Metadata,
} from "./model";
import {
  identifiers,
  cleanDOI,
  preprintDOI,
  officialPublicationURL,
  arxivID,
  isPreprint,
  doiPath,
  conferencePoster,
  conferenceSiteHint,
} from "./identifiers";
import { publishedVenue, rankCandidates, titleScore } from "./matching";
import { checkAccess, JSONResponseError } from "./responses";
import { selectPublication } from "./selection";
import { containerField } from "./venues";
import { DEFAULT_CONFERENCE_RULES, normalizeConference } from "./conferences";

export interface Network {
  json(url: string, headers?: Record<string, string>): Promise<any>;
  text(url: string, headers?: Record<string, string>): Promise<string>;
  xml(text: string): Document;
  html(text: string): Document;
}

const encode = encodeURIComponent;
const list = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const sparqlLiteral = (value: string): string =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")}"`;
const errorMessage = (error: unknown): string =>
  (error as any)?.message || String(error);

const dateValue = (value: any): string | undefined => {
  const parts = value?.["date-parts"]?.[0];
  if (!Array.isArray(parts) || !parts.length || !parts[0]) return undefined;
  return parts
    .slice(0, 3)
    .map((part, index) =>
      part === undefined || part === null || part === ""
        ? ""
        : index && String(part).length === 1
          ? `0${part}`
          : String(part),
    )
    .filter(Boolean)
    .join("-");
};

const crossrefType = (type: string): string | undefined => {
  switch (type) {
    case "journal-article":
      return "journalArticle";
    case "proceedings-article":
      return "conferencePaper";
    case "book-chapter":
      return "bookSection";
    default:
      return undefined;
  }
};

const openAlexType = (work: any): string | undefined => {
  switch (work?.type) {
    case "preprint":
      return "preprint";
    case "book-chapter":
      return "bookSection";
    case "proceedings-article":
    case "conference-paper":
      return "conferencePaper";
    case "article":
    case "review":
      return work?.primary_location?.source?.type === "conference"
        ? "conferencePaper"
        : "journalArticle";
    default:
      return undefined;
  }
};

const dataCiteType = (types: any): string | undefined => {
  switch (String(types?.resourceTypeGeneral || "").toLowerCase()) {
    case "journalarticle":
      return "journalArticle";
    case "conferencepaper":
    case "proceedingsarticle":
      return "conferencePaper";
    case "bookchapter":
      return "bookSection";
    case "preprint":
      return "preprint";
    default:
      return undefined;
  }
};

const creator = (author: any, creatorType: string) => {
  const lastName = String(author?.family || author?.name || "").trim();
  if (!lastName) return [];
  return [
    {
      firstName: String(author?.given || "").trim(),
      lastName,
      creatorType,
    },
  ];
};

const withContainer = (metadata: Metadata, container: string): void => {
  metadata.publicationTitle = container;
  const field = containerField(metadata.itemType);
  if (field && field !== "publicationTitle") metadata[field] = container;
};

export function openReviewValue(note: any, key: string): any {
  const raw = note.content?.[key];
  return raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
}

function openReviewVenue(
  id: string,
): (ConferenceVenue & { secondary: boolean }) | undefined {
  const parts = id.split("/");
  const yearIndex = parts.findIndex((part) => /^(?:19|20)\d{2}$/.test(part));
  if (yearIndex < 1) return undefined;
  const parent = normalizeConference(
    {
      itemType: "conferencePaper",
      title: "",
      proceedingsTitle: parts.slice(0, yearIndex).join(" ").replace(/\./g, " "),
    },
    DEFAULT_CONFERENCE_RULES,
    "short",
  );
  if (!parent.rule) return undefined;
  const event = parts.slice(yearIndex + 1);
  if (/^Conference$/i.test(event[0] || "")) event.shift();
  // Preserve the whole subevent path, including names absent from the catalog.
  if (
    event.length &&
    (!/^(?:Workshops?|Track|\w+_Track)$/i.test(event[0]) ||
      event.some((part) => !/^[\w -]+$/.test(part)))
  )
    return undefined;
  if (!event.length && !/\/Conference$/i.test(id)) return undefined;
  return {
    id,
    secondary: event.length > 0,
    title: [parent.metadata.proceedingsTitle, parts[yearIndex], ...event]
      .join(" ")
      .replace(/_/g, " "),
  };
}

export class PublicationFinder {
  private dblpUnavailable?: Error;
  private dblpSparqlUnavailable?: Error;
  private scholarUnavailable?: Error;
  private conferenceLists = new Map<string, Document>();
  constructor(private net: Network) {}

  async googleScholar(item: Item): Promise<Candidate[]> {
    if (this.scholarUnavailable) throw this.scholarUnavailable;
    try {
      const text = await this.net.text(
        `https://scholar.google.com/scholar?hl=en&num=10&q=${encode(`"${item.getField("title")}"`)}`,
      );
      checkAccess(text);
      const doc = this.net.html(text);
      const rows = Array.from(doc.querySelectorAll(".gs_r[data-cid]"));
      if (!rows.length && !doc.querySelector("#gs_res_ccl"))
        throw new Error("Unexpected Google Scholar response");
      return rows.flatMap((row) => {
        const heading = row.querySelector(".gs_rt");
        const link = heading?.querySelector("a");
        const title = (link?.textContent || heading?.textContent || "")
          .replace(/^\s*\[[^\]]+\]\s*/, "")
          .trim();
        const href = link?.getAttribute("href");
        if (!title || !href) return [];
        let url: URL;
        try {
          url = new URL(href, "https://scholar.google.com");
        } catch {
          return [];
        }
        if (
          !/^https?:$/.test(url.protocol) ||
          /(^|\.)(scholar\.google\.com|arxiv\.org)$/.test(url.hostname)
        )
          return [];
        const byline = row.querySelector(".gs_a")?.textContent || "";
        const parts = byline.split(/\s+[–-]\s+/);
        const venue = parts[1]?.trim() || "";
        if (!publishedVenue(venue)) return [];
        const doi =
          cleanDOI(url.href) ||
          cleanDOI(url.pathname.match(/\/(10\.\d{4,9}\/[^?#]+)/)?.[1] || "");
        return [
          {
            source: "Google Scholar",
            title,
            authors: (parts[0] || "")
              .split(/[,，]/)
              .map((name) => name.trim())
              .filter(Boolean),
            venue,
            year: Number(venue.match(/\b(\d{4})\b/)?.[1]) || undefined,
            doi,
            url: url.href,
          },
        ];
      });
    } catch (error) {
      if (
        (error as JSONResponseError)?.blocked ||
        [403, 429].includes((error as any)?.status)
      )
        this.scholarUnavailable = error as Error;
      throw error;
    }
  }

  async arxiv(id: string): Promise<{
    candidate?: Candidate;
    metadata?: Metadata;
    publicationHint?: string;
  }> {
    const text = await this.net.text(
      `https://export.arxiv.org/api/query?id_list=${encode(id.replace(/v\d+$/, ""))}`,
    );
    const doc = this.net.xml(text);
    const entry = doc.getElementsByTagNameNS(
      "http://www.w3.org/2005/Atom",
      "entry",
    )[0];
    if (!entry) return {};
    const atom = (name: string) =>
      entry
        .getElementsByTagNameNS("http://www.w3.org/2005/Atom", name)[0]
        ?.textContent?.trim() || "";
    const title = atom("title").replace(/\s+/g, " ");
    if (atom("id").includes("/errors") || !title)
      throw new Error("arXiv identifier not found");
    const authors = Array.from(
      entry.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "author"),
    )
      .map(
        (author) =>
          author
            .getElementsByTagNameNS("http://www.w3.org/2005/Atom", "name")[0]
            ?.textContent?.trim() || "",
      )
      .filter(Boolean);
    const doi = cleanDOI(
      entry.getElementsByTagNameNS("http://arxiv.org/schemas/atom", "doi")[0]
        ?.textContent ||
        Array.from(
          entry.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "link"),
        )
          .find((link) => link.getAttribute("title") === "doi")
          ?.getAttribute("href") ||
        "",
    );
    const publicationURL = Array.from(
      entry.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "link"),
    )
      .map((link) => link.getAttribute("href") || "")
      .find(officialPublicationURL);
    const journalRef =
      entry
        .getElementsByTagNameNS(
          "http://arxiv.org/schemas/atom",
          "journal_ref",
        )[0]
        ?.textContent?.trim() || "";
    const version = arxivID(atom("id"));
    if (
      !version ||
      version.replace(/v\d+$/, "").toLowerCase() !==
        id.replace(/v\d+$/, "").toLowerCase()
    )
      throw new Error("Conflicting arXiv identifier");
    const url = `https://arxiv.org/abs/${version}`;
    const comment =
      entry
        .getElementsByTagNameNS("http://arxiv.org/schemas/atom", "comment")[0]
        ?.textContent?.trim() || "";
    return {
      publicationHint: journalRef || comment || undefined,
      candidate:
        (doi && !preprintDOI(doi)) || publicationURL
          ? {
              source: "arXiv",
              title,
              authors,
              doi: doi && !preprintDOI(doi) ? doi : undefined,
              url: publicationURL,
              venue: journalRef || undefined,
              linked: true,
            }
          : undefined,
      metadata: {
        itemType: "preprint",
        title,
        abstractNote: atom("summary").replace(/\s+/g, " "),
        date: atom("published").slice(0, 10),
        DOI: `10.48550/arXiv.${id.replace(/v\d+$/, "")}`,
        url,
        archiveID: `arXiv:${version}`,
        repository: "arXiv",
        libraryCatalog: "arXiv",
        creators: authors.map((name) => {
          const words = name.split(/\s+/);
          return {
            lastName: words.pop() || name,
            firstName: words.join(" "),
            creatorType: "author",
          };
        }),
      },
    };
  }

  async related(
    item: Item,
    publicationHint?: (hint: string) => void,
  ): Promise<Candidate[]> {
    const ids = identifiers(item);
    if (ids.arXiv) {
      try {
        const { candidate, publicationHint: hint } = await this.arxiv(
          ids.arXiv,
        );
        // Comments and journal references guide discovery, never establish acceptance.
        publicationHint?.(hint || "");
        return candidate ? [candidate] : [];
      } catch (error) {
        const html = await this.net.text(
          `https://arxiv.org/abs/${encode(ids.arXiv.replace(/v\d+$/, ""))}`,
        );
        const doi = cleanDOI(
          html.match(/data-doi=["']([^"']+)["']/i)?.[1] ||
            html.match(
              /href=["']https?:\/\/(?:dx\.)?doi\.org\/([^"']+)["']/i,
            )?.[1] ||
            "",
        );
        if (!doi || preprintDOI(doi)) throw error;
        return [
          { source: "arXiv", title: item.getField("title"), doi, linked: true },
        ];
      }
    }
    const url = ids.URL || "";
    const bio = url.match(
      /^https?:\/\/(?:www\.)?(bio|med)rxiv\.org\/content\/(10\.1101\/[^?#]+?)(?:v\d+)?(?:\.full|\.abstract)?\/?$/i,
    );
    if (bio) {
      const server = bio[1].toLowerCase() + "rxiv";
      const data = await this.net.json(
        `https://api.biorxiv.org/details/${server}/${bio[2]}`,
      );
      return list<any>(data.collection)
        .map((record) => ({
          source: server,
          title: record.title || "",
          doi: cleanDOI(record.published || ""),
          linked: true,
        }))
        .filter((record) => record.doi && !preprintDOI(record.doi));
    }
    const chem = url.match(
      /^https?:\/\/chemrxiv\.org\/engage\/chemrxiv\/article-details\/([a-f\d]+)/i,
    );
    if (chem) {
      const data = await this.net.json(
        `https://chemrxiv.org/engage/chemrxiv/public-api/v1/items/${chem[1]}`,
      );
      const doi = cleanDOI(data.vor?.vorDoi || "");
      return doi
        ? [{ source: "ChemRxiv", title: data.title || "", doi, linked: true }]
        : [];
    }
    return [];
  }

  async semanticScholar(item: Item): Promise<Candidate[]> {
    const ids = identifiers(item);
    const fields = "title,externalIds,authors,year,venue,publicationVenue";
    const base = "https://api.semanticscholar.org/graph/v1/paper";
    let data;
    if (ids.arXiv) {
      try {
        data = await this.net.json(
          `${base}/ARXIV:${encode(ids.arXiv.replace(/v\d+$/, ""))}?fields=${fields}`,
        );
      } catch (error) {
        if (!/404|not found/i.test(String(error))) throw error;
      }
    }
    if (
      (!data?.externalIds?.DOI || preprintDOI(data.externalIds.DOI)) &&
      !(
        data?.externalIds?.DBLP &&
        publishedVenue(data.publicationVenue?.name || data.venue || "")
      )
    ) {
      data = await this.net.json(
        `${base}/search/match?query=${encode(item.getField("title"))}&fields=${fields}`,
      );
    }
    return list<any>(data.data ?? data)
      .map((paper) => ({
        source: "Semantic Scholar",
        title: paper.title || "",
        doi: preprintDOI(paper.externalIds?.DOI || "")
          ? undefined
          : cleanDOI(paper.externalIds?.DOI || ""),
        url:
          typeof paper.externalIds?.DBLP === "string" &&
          /^(?:conf|journals)\/[\w/-]+$/.test(paper.externalIds.DBLP)
            ? `https://dblp.org/rec/${paper.externalIds.DBLP}.bib`
            : undefined,
        authors: list<any>(paper.authors).map((author) => author.name),
        year: paper.year,
        venue: paper.publicationVenue?.name || paper.venue || "",
        linked: Boolean(ids.arXiv && !data.data),
      }))
      .filter(
        (candidate) =>
          (candidate.doi || candidate.url) &&
          (candidate.linked || publishedVenue(candidate.venue)),
      );
  }

  async crossref(item: Item, publicationHint = ""): Promise<Candidate[]> {
    const author = item.getCreators()[0]?.lastName;
    const data = await this.net.json(
      `https://api.crossref.org/works?query.title=${encode(item.getField("title"))}&rows=20&filter=type:journal-article,type:proceedings-article,type:book-chapter${author ? `&query.author=${encode(author)}` : ""}${publicationHint ? `&query.bibliographic=${encode(publicationHint)}` : ""}`,
    );
    return list<any>(data.message?.items)
      .filter((work) =>
        ["journal-article", "proceedings-article", "book-chapter"].includes(
          work.type,
        ),
      )
      .map((work) => ({
        source: "Crossref",
        publicationEvidence: "index" as const,
        title: work.title?.[0] || "",
        doi: cleanDOI(work.DOI || ""),
        authors: list<any>(work.author).map((author) =>
          [author.given, author.family].filter(Boolean).join(" "),
        ),
        year: work.issued?.["date-parts"]?.[0]?.[0],
        venue: work["container-title"]?.[0] || "",
      }))
      .filter((candidate) => candidate.doi);
  }

  async crossrefDOI(doi: string): Promise<Metadata | undefined> {
    const data = await this.net.json(
      `https://api.crossref.org/works/${doiPath(doi)}`,
    );
    const work = data?.message;
    if (!work) return undefined;
    const itemType = crossrefType(String(work.type || ""));
    const title = String(list<string>(work.title)[0] || "").trim();
    if (!itemType || !title) return undefined;
    const metadata: Metadata = { itemType, title };
    const recordDOI = cleanDOI(String(work.DOI || ""));
    if (recordDOI) metadata.DOI = recordDOI;
    const creators = [
      ...list<any>(work.author).flatMap((author) => creator(author, "author")),
      ...list<any>(work.editor).flatMap((author) => creator(author, "editor")),
    ];
    if (creators.length) metadata.creators = creators;
    const container = String(
      list<string>(work["container-title"])[0] || "",
    ).trim();
    if (container) withContainer(metadata, container);
    if (work.publisher) metadata.publisher = String(work.publisher);
    if (work.volume) metadata.volume = String(work.volume);
    if (work.issue) metadata.issue = String(work.issue);
    const pages = work.page || work["article-number"];
    if (pages) metadata.pages = String(pages);
    const issn = list<string>(work.ISSN)[0];
    if (issn) metadata.ISSN = String(issn);
    const isbn = list<string>(work.ISBN)[0];
    if (isbn) metadata.ISBN = String(isbn);
    if (work.language) metadata.language = String(work.language);
    const abbreviation = list<string>(work["short-container-title"])[0];
    if (abbreviation) metadata.journalAbbreviation = abbreviation;
    if (work.event?.name) metadata.conferenceName = String(work.event.name);
    if (work["edition-number"])
      metadata.edition = String(work["edition-number"]);
    const date =
      dateValue(work.issued) ||
      dateValue(work.published) ||
      dateValue(work["published-print"]) ||
      dateValue(work["published-online"]);
    if (date) metadata.date = date;
    return metadata;
  }

  async openAlexDOI(doi: string): Promise<Metadata | undefined> {
    const work = await this.net.json(
      `https://api.openalex.org/works/doi:${doiPath(doi)}`,
    );
    if (!work || work.error) return undefined;
    const itemType = openAlexType(work);
    const title = String(work.display_name || work.title || "").trim();
    if (!itemType || !title) return undefined;
    const metadata: Metadata = { itemType, title };
    const recordDOI = cleanDOI(String(work.ids?.doi || work.doi || ""));
    if (recordDOI) metadata.DOI = recordDOI;
    const creators = list<any>(work.authorships).flatMap((authorship) => {
      const name = String(
        authorship?.raw_author_name || authorship?.author?.display_name || "",
      ).trim();
      if (!name) return [];
      const words = name.split(/\s+/);
      return [
        {
          firstName: words.slice(0, -1).join(" "),
          lastName: words[words.length - 1],
          creatorType: "author",
        },
      ];
    });
    if (creators.length) metadata.creators = creators;
    const source = work.primary_location?.source;
    const container = String(source?.display_name || "").trim();
    if (container) withContainer(metadata, container);
    if (work.publication_date) metadata.date = String(work.publication_date);
    else if (work.publication_year)
      metadata.date = String(work.publication_year);
    if (work.language) metadata.language = String(work.language);
    const biblio = work.biblio || {};
    if (biblio.volume) metadata.volume = String(biblio.volume);
    if (biblio.issue) metadata.issue = String(biblio.issue);
    if (biblio.first_page)
      metadata.pages =
        biblio.last_page && biblio.last_page !== biblio.first_page
          ? `${biblio.first_page}-${biblio.last_page}`
          : String(biblio.first_page);
    const issn = source?.issn_l || list<string>(source?.issn)[0];
    if (issn) metadata.ISSN = String(issn);
    return metadata;
  }

  async dataCiteDOI(doi: string): Promise<Metadata | undefined> {
    const response = await this.net.json(
      `https://api.datacite.org/dois/${doiPath(doi)}`,
    );
    const data = response?.data?.attributes;
    if (!data) return undefined;
    const itemType = dataCiteType(data.types);
    const title = String(
      list<any>(data.titles).find(
        (entry) =>
          entry?.title &&
          !/^(?:alternative|subtitle|translated)title$/i.test(
            String(entry.titleType || ""),
          ),
      )?.title || "",
    ).trim();
    if (!itemType || !title) return undefined;
    const metadata: Metadata = { itemType, title };
    const recordDOI = cleanDOI(String(data.doi || ""));
    if (recordDOI) metadata.DOI = recordDOI;
    const creators = list<any>(data.creators).flatMap((author) => {
      const lastName = String(author?.familyName || author?.name || "").trim();
      if (!lastName) return [];
      return [
        {
          firstName: String(author?.givenName || "").trim(),
          lastName,
          creatorType: "author",
        },
      ];
    });
    if (creators.length) metadata.creators = creators;
    const container = String(data.container?.title || "").trim();
    if (container) withContainer(metadata, container);
    if (data.publisher) metadata.publisher = String(data.publisher);
    if (data.publicationYear) metadata.date = String(data.publicationYear);
    if (data.language) metadata.language = String(data.language);
    if (data.container?.volume) metadata.volume = String(data.container.volume);
    if (data.container?.issue) metadata.issue = String(data.container.issue);
    if (data.container?.firstPage)
      metadata.pages =
        data.container.lastPage &&
        data.container.lastPage !== data.container.firstPage
          ? `${data.container.firstPage}-${data.container.lastPage}`
          : String(data.container.firstPage);
    for (const identifier of list<any>(data.identifiers)) {
      const type = String(identifier?.identifierType || "").toUpperCase();
      const value = String(identifier?.identifier || "").trim();
      if (!value) continue;
      if (type === "ISSN" && !metadata.ISSN) metadata.ISSN = value;
      if (type === "ISBN" && !metadata.ISBN) metadata.ISBN = value;
    }
    return metadata;
  }

  async dblp(item: Item): Promise<Candidate[]> {
    if (this.dblpUnavailable) {
      try {
        const fallback = await this.dblpSparql(item);
        if (fallback) return fallback;
      } catch (fallbackError) {
        throw new Error(
          `${errorMessage(this.dblpUnavailable)}. DBLP SPARQL: ${errorMessage(fallbackError)}`,
        );
      }
      throw this.dblpUnavailable;
    }
    const query = `${item.getField("title")} ${item.getCreators()[0]?.lastName || ""}`;
    let data: any;
    let resolvedHost = "dblp.org";
    const failures: string[] = [];
    for (const host of ["dblp.org", "dblp.dagstuhl.de", "dblp.uni-trier.de"]) {
      try {
        const response = await this.net.json(
          `https://${host}/search/publ/api?q=${encode(query)}&format=json&h=25`,
        );
        if (!response?.result?.hits || typeof response.result.hits !== "object")
          throw new JSONResponseError("Unexpected DBLP response");
        data = response;
        resolvedHost = host;
        break;
      } catch (error) {
        if (
          (error as JSONResponseError)?.blocked === true ||
          (error as any)?.status === 429
        ) {
          this.dblpUnavailable = error as Error;
          try {
            const fallback = await this.dblpSparql(item);
            if (fallback) return fallback;
          } catch (fallbackError) {
            throw new Error(
              `${errorMessage(error)}. DBLP SPARQL: ${errorMessage(fallbackError)}`,
            );
          }
          throw error;
        }
        failures.push(`${host}: ${String(error)}`);
      }
    }
    if (!data) throw new Error(failures.join("\n"));
    return list<any>(data.result?.hits?.hit).flatMap((hit) => {
      const info = hit.info;
      if (!info || !publishedVenue(info.venue || "")) return [];
      if (/informal|editorship|preprint/i.test(String(info.type || "")))
        return [];
      const urls = list<string>(info.ee);
      const doi = cleanDOI(info.doi || "") || urls.map(cleanDOI).find(Boolean);
      let url =
        urls.find(
          (url) =>
            /^https?:\/\//i.test(url) && !/(?:^|\/)arxiv\.org\//i.test(url),
        ) || info.url;
      if (url?.includes("openreview.net") && info.key)
        url = `https://${resolvedHost}/rec/${info.key}.bib`;
      return [
        {
          source: "DBLP",
          publicationEvidence: "index" as const,
          title: info.title || "",
          doi,
          url,
          venue: info.venue,
          year: Number(info.year) || undefined,
          authors: list<any>(info.authors?.author).map((author) =>
            typeof author === "string" ? author : author.text,
          ),
        },
      ];
    });
  }

  private async dblpSparql(item: Item): Promise<Candidate[] | undefined> {
    if (this.dblpSparqlUnavailable) throw this.dblpSparqlUnavailable;
    const creator = item.getCreators()[0];
    const firstName = creator?.firstName?.trim() || "";
    const lastName = creator?.lastName?.trim() || "";
    const title = item.getField("title").trim();
    // The creator-name index needs a full first author; surname-only filters
    // scan the whole graph and time out.
    if (!firstName || !lastName || !title) return undefined;
    const authorName = `${firstName} ${lastName}`;
    const query = `PREFIX dblp: <https://dblp.org/rdf/schema#>
SELECT ?paper ?title ?venue ?year ?doi ?page WHERE {
  ?paper a dblp:Publication ;
         dblp:title ?title ;
         dblp:authoredBy ?author .
  ?author dblp:creatorName ${sparqlLiteral(authorName)} .
  OPTIONAL { ?paper dblp:publishedIn ?venue }
  OPTIONAL { ?paper dblp:yearOfPublication ?year }
  OPTIONAL { ?paper dblp:doi ?doi }
  OPTIONAL { ?paper dblp:primaryDocumentPage ?page }
  FILTER(CONTAINS(LCASE(STR(?title)), LCASE(${sparqlLiteral(title)})))
}
LIMIT 10`;
    try {
      const data = await this.net.json(
        `https://sparql.dblp.org/sparql?format=application/sparql-results+json&query=${encode(query)}`,
        { Accept: "application/sparql-results+json" },
      );
      return list<any>(data.results?.bindings).flatMap((binding) => {
        const value = (key: string) => String(binding[key]?.value || "");
        const venue = value("venue");
        if (!publishedVenue(venue)) return [];
        const doi = cleanDOI(value("doi"));
        const url = value("page");
        if (!doi && !/^https?:\/\//i.test(url)) return [];
        return [
          {
            source: "DBLP",
            publicationEvidence: "index" as const,
            title: value("title"),
            doi,
            url: url || undefined,
            venue,
            year: Number(value("year")) || undefined,
            authors: [authorName],
          },
        ];
      });
    } catch (error) {
      // A cancelled operation must not disable DBLP for later batches.
      if (!/cancelled/i.test(String(error)))
        this.dblpSparqlUnavailable = error as Error;
      throw error;
    }
  }

  async openAlex(item: Item): Promise<Candidate[]> {
    const data = await this.net.json(
      `https://api.openalex.org/works?filter=title.search:${encode(item.getField("title"))}&per-page=20`,
    );
    return list<any>(data.results)
      .filter((work) =>
        ["article", "conference-paper", "book-chapter"].includes(work.type),
      )
      .map((work) => {
        const location = [work.primary_location, ...list<any>(work.locations)]
          .filter(Boolean)
          .find(
            (location) =>
              location.source?.type !== "repository" &&
              location.version !== "submittedVersion" &&
              publishedVenue(location.source?.display_name || "") &&
              /^https?:\/\//i.test(location.landing_page_url || ""),
          );
        return {
          source: "OpenAlex",
          ...(location &&
          (location.is_published === true ||
            location.is_accepted === true ||
            ["publishedVersion", "acceptedVersion"].includes(location.version))
            ? { publicationEvidence: "index" as const }
            : {}),
          title: work.display_name || "",
          doi: cleanDOI(work.doi || ""),
          ...(location ? { url: location.landing_page_url } : {}),
          authors: list<any>(work.authorships)
            .map((authorship) => authorship.author?.display_name || "")
            .filter(Boolean),
          year: Number(work.publication_year) || undefined,
          venue:
            (location || work.primary_location)?.source?.display_name || "",
        };
      })
      .filter(
        (candidate) =>
          (candidate.doi || candidate.url) && publishedVenue(candidate.venue),
      );
  }

  async pubmed(item: Item): Promise<Candidate[]> {
    const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
    const data = await this.net.json(
      `${base}esearch.fcgi?db=pubmed&retmode=json&retmax=10&term=${encode(item.getField("title") + "[Title]")}`,
    );
    const ids = data.esearchresult?.idlist || [];
    if (!ids.length) return [];
    const result = (
      await this.net.json(
        `${base}esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`,
      )
    ).result;
    return ids.flatMap((id: string) => {
      const paper = result?.[id];
      if (!paper || !/^\d+$/.test(id)) return [];
      return [
        {
          source: "PubMed",
          ...(publishedVenue(paper.fulljournalname || "")
            ? { publicationEvidence: "index" as const }
            : {}),
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          title: paper.title || "",
          venue: paper.fulljournalname || "",
          year: Number(paper.pubdate?.match(/\d{4}/)?.[0]) || undefined,
          doi: cleanDOI(
            list<any>(paper.articleids).find((id) => id.idtype === "doi")
              ?.value || "",
          ),
          authors: list<any>(paper.authors).map((author) => author.name),
        },
      ];
    });
  }

  async openreview(
    item: Pick<Item, "getField">,
    forum?: string,
  ): Promise<Candidate[]> {
    const data = await this.net.json(
      forum
        ? `https://api2.openreview.net/notes?id=${encode(forum)}`
        : `https://api2.openreview.net/notes/search?term=${encode(item.getField("title"))}&content=title&source=forum&limit=25`,
    );
    return list<any>(data.notes).flatMap((note) => {
      const get = (key: string) => openReviewValue(note, key);
      const venue = String(get("venue") || "");
      const venueID = String(get("venueid") || "");
      const authors = list<string>(get("authors")).filter(
        (author) =>
          typeof author === "string" &&
          author.trim() &&
          !/^(?:anonymous(?: authors?)?|匿名)$/i.test(author.trim()),
      );
      if (
        !publishedVenue(venue) ||
        !publishedVenue(`${venue} ${venueID}`) ||
        !/\/(?:19|20)\d{2}\//.test(venueID) ||
        /\/(?:Authors|Reviewers|Area_Chairs|Program_Chairs)(?:\/|$)/i.test(
          venueID,
        ) ||
        /^dblp\.org\//i.test(venueID) ||
        list<string>(note.invitations).some((invitation) =>
          /^dblp\.org\//i.test(invitation),
        ) ||
        !authors.length
      )
        return [];
      const forum = note.forum || note.id;
      if (!forum) return [];
      const event = openReviewVenue(venueID);
      const year =
        Number(`${venueID} ${venue}`.match(/\b\d{4}\b/)?.[0]) || undefined;
      return [
        {
          source: "OpenReview",
          publicationEvidence: "index" as const,
          title: String(get("title") || ""),
          authors,
          venue: event?.title || venue,
          conferenceVenue: event?.secondary
            ? { id: event.id, title: event.title }
            : undefined,
          year,
          url: `https://openreview.net/forum?id=${encode(forum)}`,
          bibtex:
            typeof get("_bibtex") === "string" ? get("_bibtex") : undefined,
        },
      ];
    });
  }

  async conferenceSite(
    item: Pick<Item, "getField" | "getCreators">,
    publicationHint: string,
  ): Promise<Candidate[]> {
    const site = conferenceSiteHint(publicationHint);
    if (!site) return [];
    const base = `https://${site.host}/virtual/${site.year}/papers.html`;
    let doc = this.conferenceLists.get(base);
    if (!doc) {
      const text = await this.net.text(base);
      checkAccess(text);
      doc = this.net.html(text);
      this.conferenceLists.set(base, doc);
    }
    const candidates: Candidate[] = [];
    for (const link of Array.from(doc.querySelectorAll("a[href]"))) {
      const url = new URL(link.getAttribute("href") || "", base).href;
      const event = conferencePoster(url);
      const title = link.textContent?.trim() || "";
      if (
        event?.host === site.host &&
        event.year === site.year &&
        titleScore(item.getField("title"), title) >= 0.9
      )
        candidates.push({
          source: site.conference,
          publicationEvidence: "proceedings",
          title,
          url,
          venue: `${site.conference} ${site.year}`,
          year: Number(site.year),
        });
    }
    return rankCandidates(item, candidates);
  }

  // Publisher search is a last resort when general indexes have no publication.
  async usenix(item: Item): Promise<Candidate[]> {
    const base = `https://www.usenix.org/search/site/${encode(`"${item.getField("title")}"`)}`;
    const candidates: Candidate[] = [];
    for (let page = 0; page < 3; page++) {
      const text = await this.net.text(base + (page ? `?page=${page}` : ""));
      checkAccess(text);
      const doc = this.net.html(text);
      if (!doc.querySelector("#search-form"))
        throw new Error("Unexpected USENIX search response");
      for (const link of Array.from(
        doc.querySelectorAll(".search-results .title a"),
      )) {
        const url = new URL(link.getAttribute("href") || "", base);
        const title = link.textContent?.trim() || "";
        if (
          url.hostname === "www.usenix.org" &&
          officialPublicationURL(url.href) &&
          titleScore(item.getField("title"), title) >= 0.9
        )
          candidates.push({ source: "USENIX", title, url: url.href });
      }
      if (!doc.querySelector(".pager-next a")) break;
    }
    return rankCandidates(item, candidates);
  }

  async find(
    item: Item,
    usePreprintLinks = true,
    resolvePublication?: (candidate: Candidate) => Promise<boolean>,
  ): Promise<Lookup> {
    const warnings: string[] = [];
    let publicationHint = [
      item.getField("proceedingsTitle"),
      item.getField("publicationTitle"),
      item.getField("conferenceName"),
      item.getField("date"),
    ]
      .filter(Boolean)
      .join(" ");
    let answered = 0;
    const ids = identifiers(item);
    const checkedRecords = new Set<string>();
    const verify = async (candidate: Candidate): Promise<boolean> => {
      if (!resolvePublication || (!candidate.url && !candidate.bibtex))
        return false;
      const url = candidate.url;
      if (
        url &&
        (!/^https?:\/\//i.test(url) ||
          isPreprint({
            itemType: "document",
            isRegularItem: () => true,
            getField: (field) => (field === "url" ? url : ""),
          }))
      )
        return false;
      const key = `${url || ""}\n${candidate.bibtex || ""}\n${candidate.publicationEvidence || ""}`;
      if (checkedRecords.has(key)) return false;
      checkedRecords.add(key);
      try {
        // A forum URL alone says nothing about acceptance.
        const page = url ? new URL(url) : undefined;
        if (page?.hostname.replace(/^www\./, "") === "openreview.net") {
          const forum = page.searchParams.get("id");
          if (page.pathname !== "/forum" || !forum) return false;
          const accepted = selectPublication(
            item,
            (await this.openreview(item, forum)).filter(
              (record) => new URL(record.url!).searchParams.get("id") === forum,
            ),
          );
          if (!accepted) return false;
          candidate = accepted;
        }
        return await resolvePublication(candidate);
      } catch (error) {
        warnings.push(`Publication metadata: ${String(error)}`);
        return false;
      }
    };
    const current: Candidate = {
      source: "URL",
      title: item.getField("title"),
      url: ids.URL,
    };
    if (await verify(current))
      return { candidates: [current], warnings, answered: 1 };
    let linked: Candidate[] = [];
    try {
      // Retained arXiv provenance can also supply a missing published DOI.
      linked =
        usePreprintLinks || ids.arXiv
          ? await this.related(item, (hint) => {
              publicationHint = [hint, publicationHint]
                .filter(Boolean)
                .join("\n");
            })
          : [];
      answered++;
    } catch (error) {
      warnings.push(`Preprint server: ${String(error)}`);
    }
    const rankedLinked = rankCandidates(item, linked);
    if (rankedLinked.length) {
      const candidate = selectPublication(item, rankedLinked);
      if (
        !candidate ||
        !resolvePublication ||
        candidate.doi ||
        (await verify(candidate))
      )
        return { candidates: rankedLinked, warnings, answered };
    }
    // Broad indexes run first, then venue indexes, then secondary fallbacks.
    // Each stage runs in parallel and stops once a publication is verified, so
    // later sources only cost requests when earlier ones fail.
    const stages = [
      [
        ["Crossref", () => this.crossref(item, publicationHint)],
        ["OpenAlex", () => this.openAlex(item)],
      ],
      [
        ["DBLP", () => this.dblp(item)],
        ["OpenReview", () => this.openreview(item)],
        ...(conferenceSiteHint(publicationHint)
          ? ([
              [
                "Conference website",
                () => this.conferenceSite(item, publicationHint),
              ],
            ] as const)
          : []),
      ],
      [
        ["Semantic Scholar", () => this.semanticScholar(item)],
        ["PubMed", () => this.pubmed(item)],
      ],
    ] as const;
    const candidates: Candidate[] = [];
    let selected: Candidate | undefined;
    const accept = async (ranked: Candidate[]) => {
      selected = selectPublication(item, ranked);
      if (selected && (selected.doi || (await verify(selected))))
        return { candidates: ranked, warnings, answered };
      if (selected) {
        // Selection already established that these equally strong matches refer
        // to one publication. A private forum must not hide its public record.
        for (const alternative of ranked) {
          if (
            alternative === selected ||
            (alternative.score || 0) < (selected.score || 0) - 0.05 ||
            !selectPublication(item, [alternative])
          )
            continue;
          if (alternative.doi || (await verify(alternative)))
            return { candidates: [alternative], warnings, answered };
        }
      }
      // Later sources must not override a strong conflict from an earlier stage.
      if (
        !selected &&
        ranked.some((candidate) => (candidate.score || 0) >= 0.9)
      )
        return { candidates: ranked, warnings, answered };
    };
    for (const sources of stages) {
      const results = await Promise.allSettled(sources.map(([, run]) => run()));
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          answered++;
          candidates.push(...result.value);
        } else warnings.push(`${sources[index][0]}: ${String(result.reason)}`);
      });
      const accepted = await accept(rankCandidates(item, candidates));
      if (accepted) return accepted;
    }
    // Structured indexes avoid Scholar's mandatory pacing and bot checks on common matches.
    // Merge fallback results before selecting so a new source cannot hide an existing conflict.
    try {
      candidates.push(...(await this.googleScholar(item)));
      answered++;
    } catch (error) {
      warnings.push(`Google Scholar: ${String(error)}`);
    }
    const ranked = rankCandidates(item, candidates);
    const accepted = await accept(ranked);
    if (accepted) return accepted;
    // Search results locate records; only a verified article can authorize an update.
    if (!selected && resolvePublication) {
      try {
        const publisher = await this.usenix(item);
        answered++;
        const record = selectPublication(item, publisher);
        if (record && (await verify(record)))
          return { candidates: [record], warnings, answered };
      } catch (error) {
        warnings.push(`USENIX: ${String(error)}`);
      }
    }
    return { candidates: resolvePublication ? [] : ranked, warnings, answered };
  }
}
