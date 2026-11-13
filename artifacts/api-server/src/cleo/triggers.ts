// Pure text helpers (no I/O) so they are easy to test: who is calling Cleo,
// what is left of the message once her name is removed, and whether it is a greeting.

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when any bot name appears as a whole word ("Cleo", "cleo,", "@Cleo"). */
export function mentionsBotName(text: string, names: string[]) {
  return names.some((name) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "iu").test(text));
}

/**
 * Remove "@2348012345678" style tags and the bot's name so Cleo only sees the
 * real question. "@Cleo, who is Johnson?" -> "who is Johnson?"
 */
export function stripBotReferences(text: string, names: string[]) {
  let cleaned = text.replace(/@\d{6,}/g, " ");
  for (const name of names) {
    cleaned = cleaned.replace(
      new RegExp(`@?(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "giu"),
      " ",
    );
  }
  return cleaned
    .replace(/\s+/g, " ")
    .replace(/^[\s,.:;!?\-–—]+/, "")
    .trim();
}

const GREETING_START =
  /^(?:h+i+|he+y+a?|he+l+o+|hiya|howdy|yo+|sup|wa?ss?up|what'?s up|greetings|good (?:morning|afternoon|evening|day)|morning|afternoon|evening|e kaaro|e kaasan|e kaale|bawo|how far|salam|assalamu alaikum|asalamu alaikum|peace)(?![\p{L}\p{N}])/u;

const GREETING_FILLER =
  /(?<![\p{L}\p{N}])(?:there|everyone|everybody|all|team|guys|folks|patricians?|great|sir|ma|madam|boss|dear|please|again|how are you(?: doing| today)?|how do you do|how is it going|how far|hope you are well|o|oh)(?![\p{L}\p{N}])/gu;

/**
 * A message is a greeting when, after Cleo's name is removed, all that is left
 * is "hi", "hello", "hey", "good morning" and the like. "Hello Cleo, who is
 * Johnson?" is NOT a greeting; it is a question and goes to the AI.
 * Empty text (someone only tagged Cleo) also counts as a greeting.
 */
export function isGreetingOnly(cleanedText: string) {
  const normalized = cleanedText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return true;

  const start = normalized.match(GREETING_START);
  if (!start) return false;

  const rest = normalized.slice(start[0].length).replace(GREETING_FILLER, " ").replace(/\s+/g, " ").trim();
  return rest === "";
}

/** Keep the display name safe inside WhatsApp formatting (no stray * _ ~ `). */
export function safeDisplayName(raw?: string | null) {
  const cleaned = (raw ?? "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return cleaned || "Great Patrician";
}
