import type { Candidate, Item, Metadata } from "./model";
import {
  canonicalDOI,
  cleanDOI,
  officialPublicationURL,
  preprintDOI,
  isPreprint,
  conferencePoster,
} from "./identifiers";
import { titleScore, matchesAuthors, publishedVenue } from "./matching";
import { publicationVenueKey } from "./selection";

import { containerField, containerTitle } from "./venues";

export function hasPublicationEvidence(
  candidate: Candidate,
  metadata: Metadata,
): boolean {
  if (candidate.publicationEvidence || metadata.publicationEvidence)
    return true;
  const url = candidate.url || "";
  // Forums and conference posters require their explicit acceptance/list checks.
  return (
    officialPublicationURL(url) &&
    !conferencePoster(url) &&
    new URL(url).hostname.replace(/^www\./, "") !== "openreview.net"
  );
}

// Identifiers locate records; publication fields and identity authorize updates.
export function matchesPublication(
  item: Pick<Item, "getField" | "getCreators">,
  candidate: Candidate,
  metadata: Metadata,
): boolean {
  const venue =
    containerTitle(metadata) ||
    (metadata.itemType === "conferencePaper"
      ? String(metadata.conferenceName || "")
      : "");
  const authors = metadata.creators
    ?.filter((author) => author.creatorType !== "editor")
    .map((author) =>
      `${author.firstName || ""} ${author.lastName || ""}`.trim(),
    )
    .filter(Boolean);
  return Boolean(
    ["journalArticle", "conferencePaper", "bookSection"].includes(
      metadata.itemType,
    ) &&
      (!metadata.DOI ||
        (cleanDOI(String(metadata.DOI)) &&
          !preprintDOI(String(metadata.DOI)))) &&
      authors?.length &&
      titleScore(item.getField("title"), metadata.title) >=
        (candidate.linked ? 0.75 : 0.9) &&
      matchesAuthors(item.getCreators(), authors) &&
      publishedVenue(venue) &&
      (!candidate.conferenceVenue ||
        !metadata.conferenceVenue ||
        candidate.conferenceVenue.id === metadata.conferenceVenue.id) &&
      (candidate.doi ||
        !candidate.venue ||
        [venue, String(metadata.journalAbbreviation || "")].some(
          (value) =>
            publicationVenueKey(value) ===
            publicationVenueKey(candidate.venue!),
        )),
  );
}

export function needsContainerTitle(metadata: Metadata): boolean {
  const field = containerField(metadata.itemType);
  return Boolean(field && !metadata[field]);
}

export function normalizeMetadata(record: Metadata): Metadata {
  const metadata = { ...record };
  const doi = cleanDOI(String(metadata.DOI || ""));
  if (
    (!doi || preprintDOI(doi)) &&
    isPreprint({
      itemType: metadata.itemType,
      isRegularItem: () => true,
      getField: (field) =>
        typeof metadata[field] === "string" ? (metadata[field] as string) : "",
    })
  )
    metadata.itemType = "preprint";
  // Unsaved translator records can use Zotero's base field for the container title.
  const container = containerField(metadata.itemType);
  if (
    container &&
    !metadata[container] &&
    typeof metadata.publicationTitle === "string"
  )
    metadata[container] = metadata.publicationTitle;
  return metadata;
}

export function supplementMetadata(
  primary: Metadata,
  extra: Metadata,
): Metadata {
  const leftDOI = canonicalDOI(String(primary.DOI || ""));
  const rightDOI = canonicalDOI(String(extra.DOI || ""));
  if (extra.publicationEvidence) {
    const venues = (record: Metadata) =>
      [containerTitle(record), record.journalAbbreviation]
        .filter(
          (value): value is string =>
            typeof value === "string" && Boolean(value.trim()),
        )
        .map(publicationVenueKey);
    const left = venues(primary),
      right = venues(extra);
    if (
      left.length &&
      right.length &&
      !left.some((value) => right.includes(value))
    )
      throw new Error("Conflicting publication venues");
  }
  if (
    titleScore(primary.title, extra.title) < 0.9 ||
    (primary.conferenceVenue &&
      extra.conferenceVenue &&
      primary.conferenceVenue.id !== extra.conferenceVenue.id) ||
    (leftDOI && rightDOI && leftDOI !== rightDOI) ||
    !matchesAuthors(
      primary.creators || [],
      extra.creators?.map(
        (author) => `${author.firstName || ""} ${author.lastName}`,
      ),
    )
  )
    throw new Error("Conflicting article metadata");
  const merged = { ...primary };
  for (const [field, value] of Object.entries(extra)) {
    if (
      !merged[field] ||
      (Array.isArray(merged[field]) && !merged[field].length)
    )
      merged[field] = value;
  }
  return merged;
}

export function bibliographyEvidence(doc: Document): string | undefined {
  const entries = Array.from(
    doc.querySelectorAll?.(
      'pre, .bibtex-text-entry, script[type="application/x-bibtex"]',
    ) || [],
  ).filter((node) =>
    /^\s*@(?:inproceedings|article|incollection)\s*[{(]/i.test(
      node.textContent || "",
    ),
  );
  return entries.length === 1 ? entries[0].textContent || undefined : undefined;
}

export function articleEvidence(
  doc: Document,
  url: string,
): { doi?: string; bibtex?: string; bibliographyURL?: string; title?: string } {
  const citation = (name: string) =>
    Array.from(doc.querySelectorAll?.(`meta[name="${name}"]`) || [])
      .map((meta) => meta.getAttribute("content")?.trim() || "")
      .filter(Boolean);
  const titles = [...new Set(citation("citation_title"))];
  const title = titles.length === 1 ? titles[0] : undefined;
  // Structured article metadata can establish the page role on new publishers.
  // A homepage or an unlabelled reference list cannot authorize bibliography extraction.
  const article =
    officialPublicationURL(url) ||
    Boolean(
      title &&
        citation("citation_author").length &&
        [
          "citation_journal_title",
          "citation_conference_title",
          "citation_book_title",
        ].some((name) => citation(name).length),
    );
  // Read only the article's identifier, not arbitrary DOI links in references.
  let doi = Array.from(
    doc.querySelectorAll?.(
      'meta[name="citation_doi"], meta[name="dc.identifier"], meta[name="DC.Identifier"]',
    ) || [],
  )
    .map((meta) => cleanDOI(meta.getAttribute("content") || ""))
    .find((value) => value && !preprintDOI(value));
  if (!doi && article) {
    const link = Array.from(doc.querySelectorAll?.("a[href]") || []).find(
      (anchor) =>
        (/^DOI\s*:/i.test(anchor.parentElement?.textContent?.trim() || "") ||
          /^DOI\s*:?$/i.test(
            anchor.parentElement?.previousElementSibling?.textContent?.trim() ||
              "",
          )) &&
        cleanDOI(anchor.getAttribute("href") || ""),
    );
    doi = cleanDOI(link?.getAttribute("href") || "");
  }
  const bibliographyLinks = article
    ? Array.from(doc.querySelectorAll?.("a[href]") || [])
        .filter(
          (anchor) =>
            /^bibtex$/i.test(anchor.textContent?.trim() || "") ||
            anchor.getAttribute("type") === "application/x-bibtex",
        )
        .flatMap((anchor) => {
          try {
            const link = new URL(anchor.getAttribute("href") || "", url);
            return link.origin === new URL(url).origin ? [link.href] : [];
          } catch {
            return [];
          }
        })
    : [];
  const uniqueLinks = [...new Set(bibliographyLinks)];
  return {
    doi,
    title,
    bibtex: article ? bibliographyEvidence(doc) : undefined,
    bibliographyURL: uniqueLinks.length === 1 ? uniqueLinks[0] : undefined,
  };
}
