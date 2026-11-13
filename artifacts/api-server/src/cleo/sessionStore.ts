import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../lib/logger";
import type { ChatEntry, ChatSession } from "./types";

/** Cleo remembers the most recent 20 messages (voter + Cleo combined) per conversation. */
export const HISTORY_LIMIT = 20;

const MAX_STORED_CHARS = 1500;

const storePath = path.resolve(process.env.CLEO_SESSION_FILE ?? "data/cleo-sessions.json");

const sessions = new Map<string, ChatSession>();
let loaded = false;
let writeQueue: Promise<void> = Promise.resolve();

async function loadStore() {
  if (loaded) return;
  loaded = true;

  try {
    const contents = await readFile(storePath, "utf8");
    const saved = JSON.parse(contents) as Record<string, ChatSession>;
    for (const [key, session] of Object.entries(saved)) {
      session.history = (session.history ?? []).slice(-HISTORY_LIMIT);
      sessions.set(key, session);
    }
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : "";
    if (code === "ENOENT") return;
    // A corrupt file must not stop the bot from answering; start fresh instead.
    logger.error({ err: error, storePath }, "Could not read the Cleo session file; starting empty");
  }
}

function persist() {
  writeQueue = writeQueue
    .then(async () => {
      await mkdir(path.dirname(storePath), { recursive: true });
      const tmp = `${storePath}.tmp`;
      await writeFile(tmp, JSON.stringify(Object.fromEntries(sessions), null, 2), "utf8");
      await rename(tmp, storePath);
    })
    .catch((error: unknown) => {
      // Swallow here so one failed write never blocks every later write.
      logger.error({ err: error }, "Could not save Cleo sessions");
    });
  return writeQueue;
}

export async function getHistory(key: string): Promise<ChatEntry[]> {
  await loadStore();
  return [...(sessions.get(key)?.history ?? [])];
}

export async function recordExchange(
  key: string,
  meta: { name?: string; isGroup: boolean },
  userText: string,
  assistantText: string,
) {
  await loadStore();
  const now = new Date().toISOString();
  const session: ChatSession = sessions.get(key) ?? {
    key,
    isGroup: meta.isGroup,
    history: [],
    createdAt: now,
    updatedAt: now,
  };

  if (meta.name) session.name = meta.name;
  session.history.push(
    { role: "user", text: userText.slice(0, MAX_STORED_CHARS), createdAt: now },
    { role: "assistant", text: assistantText.slice(0, MAX_STORED_CHARS), createdAt: now },
  );
  session.history = session.history.slice(-HISTORY_LIMIT);
  session.updatedAt = now;
  sessions.set(key, session);
  await persist();
}

export async function countSessions() {
  await loadStore();
  return sessions.size;
}
