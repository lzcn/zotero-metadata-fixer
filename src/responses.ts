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
  if (
    /^</.test(body) &&
    /making sure you|not a bot|anubis|\.within\.website|captcha|access denied/i.test(
      body,
    )
  )
    throw new JSONResponseError(messages.blocked, true);
  try {
    return JSON.parse(body);
  } catch {
    throw new JSONResponseError(messages.invalid);
  }
}
