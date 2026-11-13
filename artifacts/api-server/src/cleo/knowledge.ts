import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

const FILE_NAME = "candidate-knowledge-base.md";

/**
 * Cleo answers only from this document. It lives in
 * artifacts/api-server/knowledge/candidate-knowledge-base.md so campaign details
 * can be updated by editing that file and restarting; no code change is needed.
 * Set CLEO_KNOWLEDGE_FILE to point somewhere else.
 */
export function loadKnowledgeBase(): string {
  if (cached) return cached;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.CLEO_KNOWLEDGE_FILE ? path.resolve(process.env.CLEO_KNOWLEDGE_FILE) : undefined,
    path.resolve(here, "../knowledge", FILE_NAME), // built: dist/index.mjs
    path.resolve(here, "../../knowledge", FILE_NAME), // source: src/cleo/knowledge.ts
    path.resolve(process.cwd(), "knowledge", FILE_NAME), // run from artifacts/api-server
    path.resolve(process.cwd(), "artifacts/api-server/knowledge", FILE_NAME), // run from repo root
  ].filter((file): file is string => Boolean(file));

  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) {
    throw new Error(`Cleo knowledge base not found. Looked in:\n${candidates.join("\n")}`);
  }

  const contents = readFileSync(file, "utf8").trim();
  if (!contents) throw new Error(`Cleo knowledge base is empty: ${file}`);
  cached = contents;
  return contents;
}
