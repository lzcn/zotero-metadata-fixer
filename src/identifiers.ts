import type { Item } from "./model";

export function cleanDOI(value: string): string | undefined {
  let text = value.trim().replace(/^doi:\s*/i, "");
  try {
    text = decodeURIComponent(text);
  } catch {
    /* Keep malformed escapes literal. */
  }
  text = text.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  return /^10\.\d{4,9}\/\S+$/i.test(text) ? text : undefined;
}

// DOIs are case-insensitive; compare their canonical form so that prefixes and
// URL wrappers from different sources do not look like conflicting records.
export function canonicalDOI(value: string): string | undefined {
  const doi = cleanDOI(value);
  return doi?.toLowerCase();
}

// Keep suffix slashes and existing escapes; only escape characters that would
// change the request path.
export function doiPath(doi: string): string {
  return encodeURI(doi).replace(/\?/g, "%3F").replace(/#/g, "%23");
}

export function doiURL(doi: string): string {
  return `https://doi.org/${doiPath(doi)}`;
}

export function preprintDOI(doi: string): boolean {
  return /^(10\.48550\/arxiv\.|10\.1101\/|10\.26434\/chemrxiv|10\.2139\/ssrn|10\.31234\/osf|10\.21203\/rs\.)/i.test(
    cleanDOI(doi) || "",
  );
}

// Use the same repository evidence for stored items and discovered venues.
export function preprintVenue(venue: string): boolean {
  return /\b(?:arxiv|corr|biorxiv|medrxiv|chemrxiv|ssrn|osf(?:\s+preprints)?|pre-?prints?|research\s*square)\b/i.test(
    venue,
  );
}

const CONFERENCE_SITES = new Map([
  ["neurips.cc", "NeurIPS"],
  ["icml.cc", "ICML"],
  ["iclr.cc", "ICLR"],
]);

export function conferencePoster(value: string) {
  try {
    const url = new URL(value);
    const conference = CONFERENCE_SITES.get(url.hostname);
    const year = url.pathname.match(
      /^\/virtual\/(20\d{2})\/poster\/\d+\/?$/,
    )?.[1];
    if (/^https?:$/.test(url.protocol) && conference && year)
      return { host: url.hostname, conference, year };
  } catch {
    return;
  }
}

export function conferenceSiteHint(value: string) {
  const match = value.match(
    /\b(NeurIPS|NIPS|ICML|ICLR|(?:Advances in )?Neural Information Processing Systems|International Conference on Machine Learning|International Conference on Learning Representations)\s*[-:]?\s*(20\d{2})\b/i,
  );
  if (!match) return;
  const name = match[1].toLowerCase();
  const conference = /neurips|nips|neural information/.test(name)
    ? "NeurIPS"
    : /icml|machine learning/.test(name)
      ? "ICML"
      : "ICLR";
  const host = [...CONFERENCE_SITES].find(
    ([, name]) => name === conference,
  )![0];
  return { host, conference, year: match[2] };
}

// Restrict shortcuts to individual publication pages, never venue homepages.
export function officialPublicationURL(value: string): boolean {
  if (conferencePoster(value)) return true;
  try {
    const { hostname, pathname, searchParams, protocol } = new URL(value);
    if (!/^https?:$/.test(protocol)) return false;
    const host = hostname.toLowerCase().replace(/^www\./, "");
    if (host === "openreview.net")
      return pathname === "/forum" && Boolean(searchParams.get("id"));
    if (host === "usenix.org")
      return /^\/conference\/[^/]+\/presentation\/[^/]+\/?$/.test(pathname);
    if (host === "roboticsproceedings.org")
      return /^\/rss\d+\/p\d+\.html$/.test(pathname);
    if (host === "proceedings.iclr.cc")
      return /^\/paper_files\/paper\/\d{4}\/hash\/[^/]+-Abstract-Conference\.html$/.test(
        pathname,
      );
    if (host === "ieeexplore.ieee.org")
      return /^\/(?:abstract\/)?document\/\d+\/?$/.test(pathname);
    if (/^(papers|proceedings)\.n(eur)?ips\.cc$/.test(host))
      return /^\/(?:paper_files\/)?paper\/\d{4}\/hash\/[^/]+-Abstract(?:-Conference)?\.html$/.test(
        pathname,
      );
    if (host === "proceedings.mlr.press")
      return /^\/v\d+\/[^/]+\.html$/.test(pathname);
    if (host === "aclanthology.org") return /^\/[\w.-]+\/?$/.test(pathname);
    if (host === "openaccess.thecvf.com")
      return /\/html\/[^/]+\.html$/.test(pathname);
    if (host === "dl.acm.org") return /^\/doi\/10\./.test(pathname);
    if (host === "link.springer.com")
      return /^\/(?:article|chapter)\/10\./.test(pathname);
    if (host === "nature.com") return /^\/articles\/[^/]+$/.test(pathname);
    if (host === "sciencedirect.com")
      return /^\/science\/article\/pii\/[^/]+$/.test(pathname);
    if (host === "onlinelibrary.wiley.com" || host === "tandfonline.com")
      return /^\/doi\/(?:[^/]+\/)?10\./.test(pathname);
    if (host === "ojs.aaai.org")
      return /^\/index.php\/[^/]+\/article\/view\/\d+\/?$/.test(pathname);
    return false;
  } catch {
    return false;
  }
}

export function arxivID(value: string): string | undefined {
  const match = value
    .trim()
    .match(
      /^(?:(?:https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\/)|(?:https?:\/\/doi\.org\/)?10\.48550\/arxiv\.|arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z][a-z.-]*(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?(?:[?#].*)?$/i,
    );
  return match?.[1];
}

export function extraValue(extra: string, key: string): string {
  return (
    extra
      .split(/\r?\n/)
      .map((line) => line.match(/^([^:]+):\s*(.+)$/))
      .find(
        (match) => match?.[1].trim().toLowerCase() === key.toLowerCase(),
      )?.[2]
      .trim() ?? ""
  );
}

export function identifiers(item: Pick<Item, "getField">) {
  const get = (field: string) => {
    try {
      return String(item.getField(field) || "");
    } catch {
      return "";
    }
  };
  const extra = get("extra");
  const url = get("url");
  const doi =
    cleanDOI(get("DOI")) || cleanDOI(extraValue(extra, "DOI")) || cleanDOI(url);
  const arxiv =
    arxivID(url) ||
    arxivID(get("archiveID")) ||
    arxivID(doi || "") ||
    arxivID(extraValue(extra, "arXiv"));
  const pmid =
    extraValue(extra, "PMID") ||
    url.match(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)?.[1];
  return {
    DOI: doi,
    arXiv: arxiv,
    PMID: pmid && /^\d+$/.test(pmid) ? pmid : undefined,
    URL: /^https?:\/\//i.test(url) ? url : undefined,
  };
}

export function isPreprint(
  item: Pick<Item, "getField" | "itemType" | "isRegularItem">,
): boolean {
  if (!item.isRegularItem()) return false;
  if (item.itemType === "preprint") return true;
  const ids = identifiers(item);
  const venue =
    item.getField("publicationTitle") ||
    item.getField("proceedingsTitle") ||
    "";
  // A published item may retain an arXiv identifier in Extra for provenance.
  if (venue && !preprintVenue(venue)) return false;
  return Boolean(
    preprintVenue(venue) ||
      ids.arXiv ||
      (ids.DOI && preprintDOI(ids.DOI)) ||
      /https?:\/\/(?:www\.)?(?:biorxiv\.org|medrxiv\.org|chemrxiv\.org|osf\.io)\//i.test(
        ids.URL || "",
      ),
  );
}
