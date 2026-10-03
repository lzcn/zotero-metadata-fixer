import type { Candidate, Item, Lookup, Metadata } from "./model";
import { identifiers, cleanDOI, preprintDOI } from "./identifiers";
import { publishedVenue, rankCandidates } from "./matching";
import { JSONResponseError } from "./responses";

export interface Network {
  json(url: string): Promise<any>;
  text(url: string): Promise<string>;
  xml(text: string): Document;
}

const encode = encodeURIComponent;
const list = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
export function openReviewValue(note: any, key: string): any {
  const raw = note.content?.[key];
  return raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
}

export class PublicationFinder {
  private dblpUnavailable?: Error;
  constructor(private net: Network) {}

  async arxiv(
    id: string,
  ): Promise<{ candidate?: Candidate; metadata?: Metadata }> {
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
        ?.textContent || "",
    );
    const version = atom("id").split("/abs/")[1] || id;
    const url = `https://arxiv.org/abs/${version}`;
    return {
      candidate:
        doi && !preprintDOI(doi)
          ? { source: "arXiv", title, authors, doi, linked: true }
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

  async related(item: Item): Promise<Candidate[]> {
    const ids = identifiers(item);
    if (ids.arXiv) {
      try {
        const { candidate } = await this.arxiv(ids.arXiv);
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
    if (!data?.externalIds?.DOI || preprintDOI(data.externalIds.DOI)) {
      data = await this.net.json(
        `${base}/search/match?query=${encode(item.getField("title"))}&fields=${fields}`,
      );
    }
    return list<any>(data.data ?? data)
      .map((paper) => ({
        source: "Semantic Scholar",
        title: paper.title || "",
        doi: cleanDOI(paper.externalIds?.DOI || ""),
        authors: list<any>(paper.authors).map((author) => author.name),
        year: paper.year,
        venue: paper.publicationVenue?.name || paper.venue || "",
        linked: Boolean(ids.arXiv && !data.data),
      }))
      .filter(
        (candidate) =>
          candidate.doi &&
          (candidate.linked || publishedVenue(candidate.venue)),
      );
  }

  async crossref(item: Item): Promise<Candidate[]> {
    const author = item.getCreators()[0]?.lastName;
    const data = await this.net.json(
      `https://api.crossref.org/works?query.title=${encode(item.getField("title"))}&rows=20&filter=type:journal-article,type:proceedings-article,type:book-chapter${author ? `&query.author=${encode(author)}` : ""}`,
    );
    return list<any>(data.message?.items)
      .filter((work) =>
        ["journal-article", "proceedings-article", "book-chapter"].includes(
          work.type,
        ),
      )
      .map((work) => ({
        source: "Crossref",
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

  async dblp(item: Item): Promise<Candidate[]> {
    if (this.dblpUnavailable) throw this.dblpUnavailable;
    const query = `${item.getField("title")} ${item.getCreators()[0]?.lastName || ""}`;
    let data: any;
    let resolvedHost = "dblp.org";
    const failures: string[] = [];
    for (const host of ["dblp.org", "dblp.dagstuhl.de", "dblp.uni-trier.de"]) {
      try {
        data = await this.net.json(
          `https://${host}/search/publ/api?q=${encode(query)}&format=json&h=25`,
        );
        if (!data?.result?.hits || typeof data.result.hits !== "object")
          throw new JSONResponseError("Unexpected DBLP response");
        resolvedHost = host;
        break;
      } catch (error) {
        if (
          (error as JSONResponseError)?.blocked === true ||
          (error as any)?.status === 429
        ) {
          this.dblpUnavailable = error as Error;
          throw error;
        }
        failures.push(`${host}: ${String(error)}`);
      }
    }
    if (failures.length === 3) throw new Error(failures.join("; "));
    return list<any>(data.result?.hits?.hit).flatMap((hit) => {
      const info = hit.info;
      if (!info || !publishedVenue(info.venue || "")) return [];
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
    return ids
      .map((id: string) => result?.[id])
      .filter(Boolean)
      .map((paper: any) => ({
        source: "PubMed",
        title: paper.title || "",
        venue: paper.fulljournalname || "",
        year: Number(paper.pubdate?.match(/\d{4}/)?.[0]) || undefined,
        doi: cleanDOI(
          list<any>(paper.articleids).find((id) => id.idtype === "doi")
            ?.value || "",
        ),
        authors: list<any>(paper.authors).map((author) => author.name),
      }))
      .filter((candidate: Candidate) => candidate.doi);
  }

  async openreview(item: Item): Promise<Candidate[]> {
    const data = await this.net.json(
      `https://api2.openreview.net/notes/search?term=${encode(item.getField("title"))}&content=title&type=exact&source=forum&limit=25`,
    );
    return list<any>(data.notes).flatMap((note) => {
      const get = (key: string) => openReviewValue(note, key);
      const venue = String(get("venue") || "");
      const venueID = String(get("venueid") || "");
      const authors = list<string>(get("authors")).filter(
        (author) => typeof author === "string" && author.trim(),
      );
      if (
        !publishedVenue(venue) ||
        !publishedVenue(`${venue} ${venueID}`) ||
        /^dblp\.org\//i.test(venueID) ||
        list<string>(note.invitations).some((invitation) =>
          /^dblp\.org\//i.test(invitation),
        ) ||
        !authors.length
      )
        return [];
      const forum = note.forum || note.id;
      if (!forum) return [];
      return [
        {
          source: "OpenReview",
          title: String(get("title") || ""),
          authors,
          venue,
          year:
            Number(`${venue} ${venueID}`.match(/\b\d{4}\b/)?.[0]) || undefined,
          url: `https://openreview.net/forum?id=${encode(forum)}`,
          bibtex:
            typeof get("_bibtex") === "string" ? get("_bibtex") : undefined,
        },
      ];
    });
  }

  async find(item: Item, usePreprintLinks = true): Promise<Lookup> {
    const warnings: string[] = [];
    let answered = 0;
    let linked: Candidate[] = [];
    try {
      linked = usePreprintLinks ? await this.related(item) : [];
      answered++;
    } catch (error) {
      warnings.push(`Preprint server: ${String(error)}`);
    }
    const rankedLinked = rankCandidates(item, linked);
    if (rankedLinked.length)
      return { candidates: rankedLinked, warnings, answered };
    const sources = [
      ["Semantic Scholar", () => this.semanticScholar(item)],
      ["Crossref", () => this.crossref(item)],
      ["DBLP", () => this.dblp(item)],
      ["PubMed", () => this.pubmed(item)],
      ["OpenReview", () => this.openreview(item)],
    ] as const;
    const results = await Promise.allSettled(sources.map(([, run]) => run()));
    const candidates: Candidate[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        answered++;
        candidates.push(...result.value);
      } else warnings.push(`${sources[index][0]}: ${String(result.reason)}`);
    });
    return { candidates: rankCandidates(item, candidates), warnings, answered };
  }
}
