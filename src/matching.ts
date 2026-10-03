import type { Candidate, Item } from "./model";
import { preprintDOI } from "./identifiers";

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
  const left = new Set(normalize(a).split(/\s+/).filter(Boolean));
  const right = new Set(normalize(b).split(/\s+/).filter(Boolean));
  if (!left.size || !right.size) return 0;
  return (
    (2 * [...left].filter((word) => right.has(word)).length) /
    (left.size + right.size)
  );
}
export function publishedVenue(venue: string): boolean {
  return (
    Boolean(venue.trim()) &&
    !/\b(?:arxiv|corr|biorxiv|medrxiv|ssrn|preprint|submitted|under review|rejected|withdrawn|desk_rejected|research square)\b/i.test(
      venue,
    )
  );
}
export function rankCandidates(
  item: Pick<Item, "getField" | "getCreators">,
  candidates: Candidate[],
): Candidate[] {
  const title = item.getField("title");
  const surname = normalize(item.getCreators()[0]?.lastName || "");
  const year =
    Number(item.getField("date").match(/\b(\d{4})\b/)?.[1]) || undefined;
  const ranked = candidates
    .filter((candidate) => {
      if (candidate.doi && preprintDOI(candidate.doi)) return false;
      if (candidate.venue && !publishedVenue(candidate.venue)) return false;
      if (candidate.linked) return true;
      if (!candidate.title || titleScore(title, candidate.title) < 0.75)
        return false;
      if (year && candidate.year && candidate.year < year) return false;
      if (
        surname &&
        candidate.authors?.length &&
        !candidate.authors.some((name) =>
          ` ${normalize(name)} `.includes(` ${surname} `),
        )
      )
        return false;
      return true;
    })
    .map((candidate) => ({
      ...candidate,
      score: candidate.linked ? 1.1 : titleScore(title, candidate.title),
    }))
    .sort((a, b) => b.score - a.score || (b.year || 0) - (a.year || 0));
  const seen = new Set<string>();
  return ranked.filter((candidate) => {
    const key = (
      candidate.doi ||
      candidate.url ||
      candidate.bibtex ||
      candidate.title
    ).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
