import type { Metadata } from "./model";
import type { ConferenceRule } from "./conferences";
import { normalize } from "./matching";

type ContainerField = "proceedingsTitle" | "bookTitle" | "publicationTitle";
const CONTAINERS: Record<
  string,
  { field: ContainerField; sources: ContainerField[] }
> = {
  conferencePaper: {
    field: "proceedingsTitle",
    sources: ["proceedingsTitle", "bookTitle", "publicationTitle"],
  },
  bookSection: {
    field: "bookTitle",
    sources: ["bookTitle", "proceedingsTitle", "publicationTitle"],
  },
  journalArticle: {
    field: "publicationTitle",
    sources: ["publicationTitle", "proceedingsTitle", "bookTitle"],
  },
};

export function containerField(itemType: string): ContainerField | undefined {
  return CONTAINERS[itemType]?.field;
}

export function isProceedingsTitle(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^(?:(?:19|20)\d{2} )?(?:proceedings|proc)\b/.test(normalize(value))
  );
}

export function containerTitle(
  metadata: Metadata,
  itemType = metadata.itemType,
): string | undefined {
  // Some translators put the volume title in the event field. Read it without rewriting that field.
  if (
    itemType === "conferencePaper" &&
    isProceedingsTitle(metadata.conferenceName)
  )
    return String(metadata.conferenceName);
  return CONTAINERS[itemType]?.sources
    .map((field) => metadata[field])
    .find(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    );
}

const VENUE_CLEANUPS: [RegExp, string][] = [
  [/\b([A-Z][A-Z0-9/-]+)[’']\d{2}\b/g, "$1"],
  [/([a-z])((?:19|20)\d{2})(?!\d)/gi, "$1 $2"],
  [/((?:19|20)\d{2})([a-z])/gi, "$1 $2"],
];
const EDITION_CLEANUPS: [RegExp, string][] = [
  [/\b(?:19|20)\d{2}\b/g, " "],
  [/\b\d+(?:st|nd|rd|th)\b/g, " "],
  [
    /\b(?:\d+|x{1,3}(?:ix|iv|v?i{0,3})|ix|iv|vi{0,3}|i{1,3})(?=\s+(?:annual|international|conference|symposium|workshops?|congress|meeting|ieee|acm)\b)/g,
    " ",
  ],
  [/\b(?:edition|volume|vol|part)\s+\d+\b/g, " "],
  [/\bworkshops\b/g, "workshop"],
];

export function normalizeVenue(value: string): string {
  const separated = VENUE_CLEANUPS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
  return EDITION_CLEANUPS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    normalize(separated),
  )
    .replace(/\s+/g, " ")
    .trim();
}

// Only grammatical wrappers and sponsors are optional. Topic words and track names remain significant.
const OPTIONAL_WORDS = new Set(
  "a an the of on in for and to proceedings proc annual international ieee acm cvf ifip iet usenix".split(
    " ",
  ),
);
function topicPhrase(value: string): string {
  return value
    .split(" ")
    .filter((word) => !OPTIONAL_WORDS.has(word))
    .join(" ");
}
// A container equal to a catalog conference is type evidence; an event mention is not.
export function isConferenceContainer(
  metadata: Metadata,
  rule: ConferenceRule,
): boolean {
  if (typeof metadata.publicationTitle !== "string") return false;
  const venue = normalizeVenue(metadata.publicationTitle);
  return rule.aliases.some((alias) => {
    const name = normalizeVenue(alias);
    return (
      venue === name ||
      (name.split(" ").length > 1 && topicPhrase(venue) === topicPhrase(name))
    );
  });
}

const SECONDARY_TRACK =
  /\b(workshops?|tracks?|companion|findings|demonstrations?|posters?|short papers?)\b/;
const isSecondary = (value: string) =>
  SECONDARY_TRACK.test(value.replace(/\bmain (?:conference )?track\b/g, ""));
type Alias = { phrase: string; topic: string; words: number };
type Signature = {
  aliases: Alias[];
  excluded: string[];
  secondary: boolean;
  umbrellaParents: string[];
  acronyms: Set<string>;
};
const signatures = new WeakMap<ConferenceRule, Signature>();
function signature(rule: ConferenceRule): Signature {
  let result = signatures.get(rule);
  if (!result) {
    const aliases = rule.aliases.map((value) => {
      const phrase = normalizeVenue(value);
      return {
        phrase,
        topic: topicPhrase(phrase),
        words: phrase.split(" ").length,
      };
    });
    result = {
      aliases: [
        ...new Map(aliases.map((alias) => [alias.phrase, alias])).values(),
      ],
      excluded: rule.excludeAliases.map(normalizeVenue),
      secondary: aliases.some((alias) => isSecondary(alias.phrase)),
      umbrellaParents: aliases
        .filter((alias) => /\b(?:workshop|track)$/.test(alias.topic))
        .map((alias) => alias.topic.replace(/\s+(?:workshop|track)$/, "")),
      acronyms: new Set(
        aliases
          .filter((alias) => alias.words === 1)
          .map((alias) => alias.phrase),
      ),
    };
    signatures.set(rule, result);
  }
  return result;
}
const contains = (text: string, phrase: string) =>
  Boolean(phrase) && ` ${text} `.includes(` ${phrase} `);
const secondaryTopic = (topic: string, sig: Signature) =>
  topic
    .split(" ")
    .filter((word) => !sig.acronyms.has(word))
    .join(" ");

// Stronger strategies run first. Acronyms remain the last resort and ties never pick a catalog row arbitrarily.
const MATCHERS = [
  {
    kind: "phrase",
    matches: (alias: Alias, venue: Alias) =>
      alias.words > 1 && contains(venue.phrase, alias.phrase),
  },
  {
    kind: "topic",
    matches: (alias: Alias, venue: Alias) =>
      alias.topic.split(" ").length >= 3 && contains(venue.topic, alias.topic),
  },
  {
    kind: "acronym",
    matches: (alias: Alias, venue: Alias) =>
      alias.words === 1 && contains(venue.phrase, alias.phrase),
  },
];

export function matchConference(
  metadata: Metadata,
  rules: ConferenceRule[],
): ConferenceRule | undefined {
  const container = CONTAINERS[metadata.itemType]?.sources
    .map((field) => metadata[field])
    .find((value) => typeof value === "string" && Boolean(value.trim()));
  const venues = [container, metadata.conferenceName]
    .filter(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    )
    .map((value) => {
      const phrase = normalizeVenue(value);
      return {
        phrase,
        topic: topicPhrase(phrase),
        words: phrase.split(" ").length,
      };
    });
  const secondary = venues.some((venue) => isSecondary(venue.phrase));
  const mainTopics = secondary
    ? new Set(
        rules
          .filter((rule) => rule.enabled && !signature(rule).secondary)
          .flatMap((rule) =>
            signature(rule).aliases.map((alias) => alias.topic),
          ),
      )
    : undefined;
  type Match = { rule: ConferenceRule; tier: number; length: number };
  const compare = (a: Match, b: Match) =>
    a.tier - b.tier || b.length - a.length;
  const uniqueBest = (matches: Match[]) => {
    matches.sort(compare);
    return matches[0] &&
      (matches.length < 2 || compare(matches[0], matches[1]) !== 0)
      ? matches[0]
      : undefined;
  };
  const eligible = rules.filter((rule) => {
    if (!rule.enabled) return false;
    const sig = signature(rule);
    return (
      (!secondary || sig.secondary) &&
      !sig.excluded.some((alias) =>
        venues.some((venue) => contains(venue.phrase, alias)),
      )
    );
  });
  const venueMatches = venues.map((venue) =>
    eligible.flatMap((rule) => {
      const sig = signature(rule);
      // An umbrella workshop/track alias must not erase an unlisted subevent.
      if (
        sig.umbrellaParents.some((parent) => mainTopics?.has(parent)) &&
        isSecondary(venue.phrase) &&
        !sig.aliases.some(
          (alias) =>
            isSecondary(alias.phrase) &&
            secondaryTopic(alias.topic, sig) ===
              secondaryTopic(venue.topic, sig),
        )
      )
        return [];
      const matches = sig.aliases
        .flatMap((alias) => {
          const tier = MATCHERS.findIndex((strategy) =>
            strategy.matches(alias, venue),
          );
          return tier < 0
            ? []
            : [
                {
                  rule,
                  tier,
                  length:
                    MATCHERS[tier].kind === "topic"
                      ? alias.topic.length
                      : alias.phrase.length,
                },
              ];
        })
        .sort(compare);
      return matches.length ? [matches[0]] : [];
    }),
  );
  // Conflicting event/container fields are evidence to review, not a reason to guess the longer name.
  const winners = venueMatches
    .map((matches) => uniqueBest([...matches]))
    .filter((match): match is Match => Boolean(match));
  if (new Set(winners.map((match) => match.rule.id)).size > 1) return undefined;
  const byRule = new Map<string, Match>();
  for (const match of venueMatches.flat()) {
    const previous = byRule.get(match.rule.id);
    if (!previous || compare(match, previous) < 0)
      byRule.set(match.rule.id, match);
  }
  return uniqueBest([...byRule.values()])?.rule;
}
