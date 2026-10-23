import type { Strings } from "./strings";

export type ProblemSummary = { message: string; incomplete: boolean };

export function classifyProblem(detail: string, s: Strings): ProblemSummary {
  if (!detail.trim()) return { message: "", incomplete: false };
  const incomplete =
    /\b429\b|rate.?limit|timed?\s*out|timeout|access blocked|\bHTTP\b|Offline/i.test(
      detail,
    );
  if (/timed?\s*out|timeout|超时/i.test(detail))
    return { message: s.requestTimeout, incomplete };
  if (/\b429\b|too many requests|rate.?limit|限流/i.test(detail)) {
    const sources = detail
      .split(/\r?\n/)
      .filter((line) =>
        /\b429\b|too many requests|rate.?limit|限流/i.test(line),
      )
      .map((line) => line.match(/^([\w .-]+):/)?.[1])
      .filter(
        (source): source is string => Boolean(source) && source !== "Error",
      );
    return {
      message: sources.length
        ? `${s.rateLimited}: ${[...new Set(sources)].join(", ")}`
        : s.rateLimited,
      incomplete,
    };
  }
  if (/\b403\b|access blocked|captcha|not a bot|访问受限/i.test(detail))
    return { message: s.sourceBlocked, incomplete };
  if (/No suitable Zotero translator/i.test(detail))
    return { message: s.noTranslator, incomplete };
  if (/invalid (?:JSON|XML)|Non-JSON|非 JSON/i.test(detail))
    return { message: s.invalidResponse, incomplete };
  for (const message of [
    s.itemChanged,
    s.ambiguous,
    s.unsupported,
    s.noPublished,
    s.noDOI,
  ])
    if (detail.includes(message)) return { message, incomplete };
  if (/Conflicting|mismatch|concurrent|changed during/i.test(detail))
    return { message: s.ambiguous, incomplete };
  if (
    /\bHTTP\b|\b5\d\d\b|offline|network|some sources failed|部分来源/i.test(
      detail,
    )
  )
    return { message: s.sourceFailed, incomplete };
  return { message: s.updateFailed, incomplete };
}

export function summarizeProblem(detail: string, s: Strings): string {
  return classifyProblem(detail, s).message;
}

export class JSONResponseError extends Error {
  constructor(
    message: string,
    readonly blocked = false,
  ) {
    super(message);
  }
}

export function parseJSONResponse(
  text: string,
  messages = { blocked: "Access blocked", invalid: "Invalid JSON response" },
): any {
  const body = text.replace(/^\uFEFF/, "").trim();
  checkAccess(body, messages.blocked);
  try {
    return JSON.parse(body);
  } catch {
    throw new JSONResponseError(messages.invalid);
  }
}

export function checkAccess(text: string, message = "Access blocked"): void {
  if (
    /^\s*</.test(text) &&
    /making sure you|not a bot|not a robot|anubis|\.within\.website|captcha|access denied|unusual traffic|automated queries|systems have detected/i.test(
      text,
    )
  )
    throw new JSONResponseError(message, true);
}
