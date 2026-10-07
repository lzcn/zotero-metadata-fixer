import type { Metadata } from "./model";
import {
  canonicalDOI,
  cleanDOI,
  officialPublicationURL,
  preprintDOI,
} from "./identifiers";
import { titleScore, matchesAuthor } from "./matching";

import { containerField } from "./venues";

export function needsContainerTitle(metadata: Metadata): boolean {
  const field = containerField(metadata.itemType);
  return Boolean(field && !metadata[field]);
}

export function normalizeMetadata(record: Metadata): Metadata {
  const metadata = { ...record };
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
  if (
    titleScore(primary.title, extra.title) < 0.9 ||
    (leftDOI && rightDOI && leftDOI !== rightDOI) ||
    !matchesAuthor(
      primary.creators?.[0]?.lastName || "",
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
): { doi?: string; bibtex?: string; bibliographyURL?: string } {
  // Read only the article's identifier, not arbitrary DOI links in references.
  let doi = Array.from(
    doc.querySelectorAll?.(
      'meta[name="citation_doi"], meta[name="dc.identifier"], meta[name="DC.Identifier"]',
    ) || [],
  )
    .map((meta) => cleanDOI(meta.getAttribute("content") || ""))
    .find((value) => value && !preprintDOI(value));
  if (!doi && officialPublicationURL(url)) {
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
  const bibliographyLinks = officialPublicationURL(url)
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
    bibtex: officialPublicationURL(url) ? bibliographyEvidence(doc) : undefined,
    bibliographyURL: uniqueLinks.length === 1 ? uniqueLinks[0] : undefined,
  };
}
