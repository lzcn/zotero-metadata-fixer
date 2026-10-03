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
