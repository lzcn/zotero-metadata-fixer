import type { Candidate, Item } from "./model";
import { normalize, rankCandidates } from "./matching";
import { DEFAULT_CONFERENCE_RULES, normalizeConference } from "./conferences";

function venueKey(candidate: Candidate): string {
  const venue = candidate.venue || "";
  return (
    normalizeConference(
      {
        itemType: "conferencePaper",
        title: candidate.title,
        proceedingsTitle: venue,
      },
      DEFAULT_CONFERENCE_RULES,
    ).rule?.id || normalize(venue)
  );
}

// Choose automatically only when the sources identify one publication reliably.
export function selectPublication(
  item: Item,
  candidates: Candidate[],
): Candidate | undefined {
  const ranked = rankCandidates(item, candidates).filter((candidate) => {
    if (candidate.linked) return true;
    const surname = normalize(item.getCreators()[0]?.lastName || "");
    return (
      (candidate.score || 0) >= 0.9 &&
      (!surname ||
        (!candidate.authors?.length &&
          normalize(candidate.title) === normalize(item.getField("title"))) ||
        candidate.authors?.some((name) =>
          ` ${normalize(name)} `.includes(` ${surname} `),
        ))
    );
  });
  const first = ranked[0];
  if (!first) return;
  const peers = ranked.filter(
    (candidate) => (candidate.score || 0) >= (first.score || 0) - 0.05,
  );
  const samePublication = peers.every((candidate) => {
    if (candidate === first) return true;
    if (first.doi && candidate.doi)
      return normalize(first.doi) === normalize(candidate.doi);
    if (first.url && candidate.url && first.url === candidate.url) return true;
    return (
      normalize(first.title) === normalize(candidate.title) &&
      Boolean(venueKey(first)) &&
      venueKey(first) === venueKey(candidate)
    );
  });
  if (!samePublication) return;
  // A DOI record is the most useful representative; retain its official IEEE URL if another source provides it.
  const selected = peers.find((candidate) => candidate.doi) || first;
  const ieee = peers.find((candidate) =>
    candidate.url?.startsWith("https://ieeexplore.ieee.org/"),
  );
  return ieee ? { ...selected, url: ieee.url } : selected;
}
