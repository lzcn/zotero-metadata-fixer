import type { Candidate, Item } from "./model";
import { cleanDOI, preprintDOI, preprintVenue } from "./identifiers";

export function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/<[^>]*>/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function titleScore(a: string, b: string): number {
  const normalizedA = normalize(a);
  const normalizedB = normalize(b);
  // Publishers can join compound words (Multi-Domain -> Multidomain).
  // Accept this only when the entire title has the same letters and numbers.
  const compactA = normalizedA.replace(/\s+/g, "");
  if (compactA && compactA === normalizedB.replace(/\s+/g, "")) return 1;
  const left = new Set(normalizedA.split(/\s+/).filter(Boolean));
  const right = new Set(normalizedB.split(/\s+/).filter(Boolean));
  if (!left.size || !right.size) return 0;
  return (
    (2 * [...left].filter((word) => right.has(word)).length) /
    (left.size + right.size)
  );
}
export function publishedVenue(venue: string): boolean {
  return (
    Boolean(venue.trim()) &&
    !preprintVenue(venue) &&
    !/\b(?:submitted|under\s+review|rejected|withdrawn|desk_rejected)\b/i.test(
      venue,
    )
  );
}
export function matchesAuthor(surname: string, authors?: string[]): boolean {
  const name = normalize(surname);
  return (
    !name ||
    !authors?.length ||
    authors.some((author) => ` ${normalize(author)} `.includes(` ${name} `))
  );
}

export function rankCandidates(
  item: Pick<Item, "getField" | "getCreators">,
  candidates: Candidate[],
): Candidate[] {
  const title = item.getField("title");
  const surname = normalize(item.getCreators()[0]?.lastName || "");
  const ranked = candidates
    .filter((candidate) => {
      if (candidate.doi && preprintDOI(candidate.doi)) return false;
      if (candidate.venue && !publishedVenue(candidate.venue)) return false;
      if (candidate.linked) return true;
      if (!candidate.title || titleScore(title, candidate.title) < 0.75)
        return false;
      // Item dates can describe revisions or be incorrect; they do not establish identity.
      // Publication years only break ranking ties after title and author validation.
      if (!matchesAuthor(surname, candidate.authors)) return false;
      return true;
    })
    .map((candidate) => ({
      ...candidate,
      score: candidate.linked ? 1.1 : titleScore(title, candidate.title),
    }))
    .sort((a, b) => b.score - a.score || (b.year || 0) - (a.year || 0));
  const seen = new Set<string>();
  return ranked.filter((candidate) => {
    // Canonical keys fold case, DOI prefixes/URLs and title typography so that
    // the same record from different sources is not processed twice.
    const doi = candidate.doi ? cleanDOI(candidate.doi) : undefined;
    const key = doi
      ? `doi:${doi.toLowerCase()}`
      : candidate.url
        ? `url:${candidate.url.trim().toLowerCase()}`
        : candidate.bibtex
          ? `bibtex:${normalize(candidate.bibtex)}`
          : `title:${normalize(candidate.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
