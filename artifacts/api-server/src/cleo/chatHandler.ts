import { logger } from "../lib/logger";
import { generateReply } from "./aiHandler";
import { buildGreeting } from "./persona";
import { getHistory, recordExchange } from "./sessionStore";
import { isGreetingOnly, safeDisplayName, stripBotReferences } from "./triggers";
import type { IncomingChat } from "./types";

export const BOT_NAMES = (process.env.CLEO_BOT_NAMES ?? "cleo")
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

const TECHNICAL_FALLBACK =
  "I'm sorry, I'm having a brief technical hiccup and can't answer that right now. Please try again in a moment, or call the candidate directly on 08053983988 or 09138402592.";

// One message at a time per voter, so a fast follow-up never reads half-saved history.
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

/**
 * Turn one incoming message (already confirmed to be addressed to Cleo) into her reply.
 * Greetings get the fixed welcome card; everything else goes to the AI with the
 * voter's last 20 messages as context.
 */
export function handleCleoMessage(input: IncomingChat): Promise<string> {
  return withLock(input.sessionKey, async () => {
    const question = stripBotReferences(input.text, BOT_NAMES);

    if (isGreetingOnly(question)) {
      return buildGreeting(input.senderName);
    }

    try {
      const history = await getHistory(input.sessionKey);
      const reply = await generateReply({
        voterName: safeDisplayName(input.senderName),
        question,
        history,
      });
      await recordExchange(
        input.sessionKey,
        { name: input.senderName, isGroup: input.isGroup },
        question,
        reply,
      );
      return reply;
    } catch (error) {
      logger.error({ err: error, sessionKey: input.sessionKey }, "Cleo could not produce an answer");
      return TECHNICAL_FALLBACK;
    }
  });
}
