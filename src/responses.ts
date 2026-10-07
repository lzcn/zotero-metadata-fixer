import type { Strings } from "./strings";

export function summarizeProblem(detail: string, s: Strings): string {
  if (!detail.trim()) return "";
  if (/timed?\s*out|timeout|超时/i.test(detail)) return s.requestTimeout;
  if (/\b429\b|too many requests|rate.?limit|限流/i.test(detail))
    return s.rateLimited;
  if (/\b403\b|access blocked|captcha|not a bot|访问受限/i.test(detail))
    return s.sourceBlocked;
  if (/No suitable Zotero translator/i.test(detail)) return s.noTranslator;
  if (/invalid (?:JSON|XML)|Non-JSON|非 JSON/i.test(detail))
    return s.invalidResponse;
  for (const message of [s.ambiguous, s.unsupported, s.noPublished, s.noDOI])
    if (detail.includes(message)) return message;
  if (/Conflicting|mismatch|concurrent|changed during/i.test(detail))
    return s.ambiguous;
  if (
    /\bHTTP\b|\b5\d\d\b|offline|network|some sources failed|部分来源/i.test(
      detail,
    )
  )
    return s.sourceFailed;
  return s.updateFailed;
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
