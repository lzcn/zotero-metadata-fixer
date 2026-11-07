import { canonicalDOI, officialPublicationURL } from "./identifiers";
import type { Candidate, Item } from "./model";
import { normalize, rankCandidates, matchesAuthors } from "./matching";
import { DEFAULT_CONFERENCE_RULES, normalizeConference } from "./conferences";
import { normalizeVenue } from "./venues";

export function publicationVenueKey(venue: string): string {
  return (
    normalizeConference(
      {
        itemType: "conferencePaper",
        title: "",
        proceedingsTitle: venue,
      },
      DEFAULT_CONFERENCE_RULES,
    ).rule?.id ||
    normalizeVenue(venue).replace(
      /^(?:proceedings|proc)(?:\s+of)?(?:\s+the)?\s+/,
      "",
    )
  );
}

// Choose automatically only when the sources identify one publication reliably.
export function selectPublication(
  item: Item,
  candidates: Candidate[],
): Candidate | undefined {
  // Discovery ranks and dedupes before selecting; ranking raw input again would
  // repeat title scoring for every source stage.
  const ranked = candidates.every(
    (candidate) => typeof candidate.score === "number",
  )
    ? candidates
    : rankCandidates(item, candidates);
  const creators = item.getCreators();
  const title = normalize(item.getField("title"));
  const eligible = ranked.filter((candidate) => {
    if (candidate.linked) return true;
    return (
      (candidate.score || 0) >= 0.9 &&
      (!creators.length ||
        (!candidate.authors?.length && normalize(candidate.title) === title) ||
        (Boolean(candidate.authors?.length) &&
          matchesAuthors(creators, candidate.authors)))
    );
  });
  const first = eligible[0];
  if (!first) return;
  const peers = eligible.filter(
    (candidate) => (candidate.score || 0) >= (first.score || 0) - 0.05,
  );
  const eventIDs = new Set(
    peers.map((candidate) => candidate.conferenceVenue?.id).filter(Boolean),
  );
  if (eventIDs.size > 1) return;
  const firstTitle = normalize(first.title);
  let firstVenue: string | undefined;
  const samePublication = peers.every((candidate) => {
    if (candidate === first) return true;
    if (first.doi && candidate.doi) {
      const left = canonicalDOI(first.doi);
      const right = canonicalDOI(candidate.doi);
      if (left && right) return left === right;
      return normalize(first.doi) === normalize(candidate.doi);
    }
    if (first.url && candidate.url && first.url === candidate.url) return true;
    firstVenue ??= publicationVenueKey(first.venue || "");
    return (
      firstTitle === normalize(candidate.title) &&
      Boolean(firstVenue) &&
      firstVenue === publicationVenueKey(candidate.venue || "")
    );
  });
  if (!samePublication) return;
  // Prefer an identifier record, retaining an official article URL from equivalent sources.
  const selected = peers.find((candidate) => candidate.doi) || first;
  const official = peers.find((candidate) =>
    officialPublicationURL(candidate.url || ""),
  );
  const conferenceVenue = peers.find(
    (candidate) => candidate.conferenceVenue,
  )?.conferenceVenue;
  return {
    ...selected,
    ...(official ? { url: official.url } : {}),
    ...(conferenceVenue ? { conferenceVenue } : {}),
  };
}
