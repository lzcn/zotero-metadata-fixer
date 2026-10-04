import type { Candidate, Item, Lookup, Metadata } from "./model";
import {
  identifiers,
  cleanDOI,
  preprintDOI,
  officialPublicationURL,
} from "./identifiers";
import { publishedVenue, rankCandidates, titleScore } from "./matching";
import { checkAccess, JSONResponseError } from "./responses";
import { selectPublication } from "./selection";

export interface Network {
  json(url: string): Promise<any>;
  text(url: string): Promise<string>;
  xml(text: string): Document;
  html(text: string): Document;
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
  private scholarUnavailable?: Error;
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
    const version = atom("id").split("/abs/")[1] || id;
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
    resolveOfficial?: (candidate: Candidate) => Promise<boolean>,
  ): Promise<Lookup> {
    const warnings: string[] = [];
    let publicationHint = "";
    let answered = 0;
    const ids = identifiers(item);
    const checkedURLs = new Set<string>();
    const official = async (candidate: Candidate): Promise<boolean> => {
      if (!resolveOfficial || !officialPublicationURL(candidate.url || ""))
        return false;
      if (checkedURLs.has(candidate.url!)) return false;
      checkedURLs.add(candidate.url!);
      try {
        const url = new URL(candidate.url!);
        // A forum URL alone says nothing about acceptance.
        if (url.hostname.replace(/^www\./, "") === "openreview.net") {
          const forum = url.searchParams.get("id")!;
          const accepted = selectPublication(
            item,
            (await this.openreview(item, forum)).filter(
              (record) => new URL(record.url!).searchParams.get("id") === forum,
            ),
          );
          if (!accepted) return false;
          candidate = accepted;
        }
        return await resolveOfficial(candidate);
      } catch (error) {
        warnings.push(`Official publication: ${String(error)}`);
        return false;
      }
    };
    const current: Candidate = {
      source: "URL",
      title: item.getField("title"),
      url: ids.URL,
    };
    if (await official(current))
      return { candidates: [current], warnings, answered: 1 };
    let linked: Candidate[] = [];
    try {
      // Retained arXiv provenance can also supply a missing published DOI.
      linked =
        usePreprintLinks || ids.arXiv
          ? await this.related(item, (hint) => {
              publicationHint = hint;
            })
          : [];
      answered++;
    } catch (error) {
      warnings.push(`Preprint server: ${String(error)}`);
    }
    const rankedLinked = rankCandidates(item, linked);
    if (rankedLinked.length)
      return { candidates: rankedLinked, warnings, answered };
    let scholar: Candidate[] = [];
    try {
      scholar = rankCandidates(item, await this.googleScholar(item));
      answered++;
      const selected = selectPublication(item, scholar);
      if (selected?.doi) return { candidates: scholar, warnings, answered };
      if (selected && (await official(selected)))
        return { candidates: scholar, warnings, answered };
    } catch (error) {
      warnings.push(`Google Scholar: ${String(error)}`);
    }
    const sources = [
      ["Semantic Scholar", () => this.semanticScholar(item)],
      ["Crossref", () => this.crossref(item, publicationHint)],
      ["DBLP", () => this.dblp(item)],
      ["PubMed", () => this.pubmed(item)],
      ["OpenReview", () => this.openreview(item)],
    ] as const;
    const results = await Promise.allSettled(sources.map(([, run]) => run()));
    // Unknown or unavailable pages still need independent publication evidence.
    const candidates: Candidate[] = [...scholar];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        answered++;
        candidates.push(...result.value);
      } else warnings.push(`${sources[index][0]}: ${String(result.reason)}`);
    });
    const ranked = rankCandidates(item, candidates);
    const selected = selectPublication(item, ranked);
    if (selected) {
      if (selected.doi || (await official(selected)))
        return { candidates: ranked, warnings, answered };
    }
    // An additional publisher must not override conflicting strong indexed matches.
    if (!selected && ranked.some((candidate) => (candidate.score || 0) >= 0.9))
      return { candidates: ranked, warnings, answered };
    // Search results locate records; only a verified article can authorize an update.
    if (!selected && resolveOfficial) {
      try {
        const publisher = await this.usenix(item);
        answered++;
        const record = selectPublication(item, publisher);
        if (record && (await official(record)))
          return { candidates: [record], warnings, answered };
      } catch (error) {
        warnings.push(`USENIX: ${String(error)}`);
      }
    }
    return { candidates: ranked, warnings, answered };
  }
}
