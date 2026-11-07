import type { Candidate, Creator, Item } from "./model";
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
function tokenScore(normalizedA: string, normalizedB: string): number {
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

export function titleScore(a: string, b: string): number {
  return tokenScore(normalize(a), normalize(b));
}
export function publishedVenue(venue: string): boolean {
  return (
    Boolean(venue.trim()) &&
    !preprintVenue(venue) &&
    !/\b(?:submissions?|submitted|under[\s_]+review|rejected|withdrawn|desk[\s_]+rejected)\b/i.test(
      venue.replace(/_/g, " "),
    )
  );
}
function authorGivenName(creator: Creator, author: string): string | undefined {
  const family = normalize(creator.lastName || "");
  const name = normalize(author);
  if (name === family) return "";
  const separator = /^\p{Script=Han}+$/u.test(family) ? "" : " ";
  if (name.endsWith(separator + family))
    return name.slice(0, -family.length).trim();
  if (name.startsWith(family + separator))
    return name.slice(family.length).trim();
  return undefined;
}

function compatibleGivenNames(left: string, right: string): boolean {
  if (!left || !right) return true;
  let a = normalize(left).split(" ");
  let b = normalize(right).split(" ");
  // Some indexes compact initials (ZL) instead of writing Z. L.
  if (
    a.length > 1 &&
    b.length === 1 &&
    b[0] !== a[0] &&
    b[0] === a.map((part) => part[0]).join("")
  )
    b = b[0].split("");
  if (
    b.length > 1 &&
    a.length === 1 &&
    a[0] !== b[0] &&
    a[0] === b.map((part) => part[0]).join("")
  )
    a = a[0].split("");
  return a
    .slice(0, Math.min(a.length, b.length))
    .every(
      (part, index) =>
        part === b[index] ||
        (part.length === 1 && b[index].startsWith(part)) ||
        (b[index].length === 1 && part.startsWith(b[index])),
    );
}

export function matchesAuthors(
  creators: Creator[],
  authors?: string[],
): boolean {
  const known = creators.filter(
    (creator) => creator.lastName?.trim() && creator.creatorType !== "editor",
  );
  const names = authors
    ?.map((name) =>
      name
        .replace(/\bet\s+al\.?[\s\S]*$/i, "")
        .replace(/[.…]+$/, "")
        .trim(),
    )
    .filter((name) => normalize(name));
  if (!known.length || !names?.length) return true;
  const givenNames = known.map((creator) =>
    names.map((author) => authorGivenName(creator, author)),
  );
  const compatible = known.map((creator, i) =>
    givenNames[i].flatMap((given, j) =>
      given !== undefined &&
      compatibleGivenNames(creator.firstName || "", given)
        ? [j]
        : [],
    ),
  );
  if (!compatible[0].length) return false;
  for (let i = 1; i < known.length; i++) {
    if (compatible[i].length) continue;
    // A truncated list can contain a same-family coauthor. Only an unexplained
    // given-name conflict is evidence that this is a different publication.
    if (
      givenNames[i].some(
        (given, j) =>
          given !== undefined &&
          !compatible.some((indices) => indices.includes(j)),
      )
    )
      return false;
  }
  const assigned = new Map<number, number>();
  const assign = (i: number, visited: Set<number>): boolean => {
    for (const j of compatible[i]) {
      if (visited.has(j)) continue;
      visited.add(j);
      const previous = assigned.get(j);
      if (previous === undefined || assign(previous, visited)) {
        assigned.set(j, i);
        return true;
      }
    }
    return false;
  };
  let matched = 0;
  for (let i = 0; i < known.length; i++) if (assign(i, new Set())) matched++;

  return matched >= Math.min(2, known.length, names.length);
}

export function rankCandidates(
  item: Pick<Item, "getField" | "getCreators">,
  candidates: Candidate[],
): Candidate[] {
  const normalizedTitle = normalize(item.getField("title"));
  const creators = item.getCreators();
  const ranked = candidates
    .flatMap((candidate) => {
      if (candidate.doi && preprintDOI(candidate.doi)) return [];
      if (candidate.venue && !publishedVenue(candidate.venue)) return [];
      if (candidate.linked) return [{ ...candidate, score: 1.1 }];
      if (!candidate.title) return [];
      // Score once: the same value both filters weak matches and ranks results.
      const score = tokenScore(normalizedTitle, normalize(candidate.title));
      if (score < 0.75) return [];
      // Item dates can describe revisions or be incorrect; they do not establish identity.
      // Publication years only break ranking ties after title and author validation.
      if (!matchesAuthors(creators, candidate.authors)) return [];
      return [{ ...candidate, score }];
    })
    .sort((a, b) => b.score - a.score || (b.year || 0) - (a.year || 0));
  const seen = new Map<string, Candidate>();
  return ranked.filter((candidate) => {
    // Canonical keys fold DOI prefixes/URLs and title typography so that
    // the same record from different sources is not processed twice.
    const doi = candidate.doi ? cleanDOI(candidate.doi) : undefined;
    const recordKey = doi
      ? `doi:${doi.toLowerCase()}`
      : candidate.url
        ? `url:${candidate.url.trim()}`
        : candidate.bibtex
          ? `bibtex:${normalize(candidate.bibtex)}`
          : `title:${normalize(candidate.title)}`;
    // Keep contradictory structured venues visible to publication selection.
    const key = candidate.conferenceVenue
      ? `${recordKey}|event:${candidate.conferenceVenue.id}`
      : recordKey;
    const previous = seen.get(key);
    if (previous) {
      // A later index can confirm a URL first found without publication evidence.
      if (normalize(previous.title) === normalize(candidate.title))
        previous.publicationEvidence ||= candidate.publicationEvidence;
      return false;
    }
    seen.set(key, candidate);
    return true;
  });
}
