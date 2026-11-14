import { logger } from "../lib/logger";
import { buildSystemPrompt } from "./persona";
import type { ChatEntry } from "./types";

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

type Provider = {
  name: "groq" | "nvidia";
  url: string;
  model: string;
  apiKey: string;
  /** Provider-specific request fields. */
  body: Record<string, unknown>;
};

const REQUEST_TIMEOUT_MS = Number(process.env.CLEO_AI_TIMEOUT_MS ?? 30_000);

/**
 * Providers in the order they are tried: Groq first (primary), NVIDIA second (fallback).
 * A provider without an API key is skipped.
 */
function getProviders(): Provider[] {
  const providers: Provider[] = [];

  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    providers.push({
      name: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
      apiKey: groqKey,
      body: {
        temperature: 0.7,
        // gpt-oss is a reasoning model; reasoning tokens count against this limit.
        max_completion_tokens: 1500,
        reasoning_effort: "low",
      },
    });
  }

  const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();
  if (nvidiaKey) {
    providers.push({
      name: "nvidia",
      url: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: process.env.NVIDIA_MODEL?.trim() || "meta/muse-glimmer-30b",
      apiKey: nvidiaKey,
      body: {
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 2048,
      },
    });
  }

  return providers;
}

export function getAiProviderStatus() {
  const [primary, fallback] = getProviders();
  return {
    configured: Boolean(primary),
    provider: primary?.name ?? null,
    fallback: fallback?.name ?? null,
  };
}

function formatInlineWhatsApp(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "*$1*")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Turn model Markdown into clean WhatsApp text (bullets, single-asterisk bold, no tables or hash headings). */
export function formatForWhatsApp(answer: string) {
  const cleaned = answer
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .replace(/\r\n/g, "\n");
  const output: string[] = [];
  let tableHeader: string[] | undefined;

  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      if (output.length && output[output.length - 1] !== "") output.push("");
      continue;
    }

    if (line.startsWith("|") && line.endsWith("|")) {
      const cells = splitTableRow(line);
      if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
      if (!tableHeader) {
        tableHeader = cells;
        continue;
      }
      const [title, ...details] = cells;
      const detail = details.filter(Boolean).join(" — ");
      output.push(`• ${formatInlineWhatsApp(title ?? "")}${detail ? ` — ${formatInlineWhatsApp(detail)}` : ""}`);
      continue;
    }
    tableHeader = undefined;

    if (/^(---+|___+|\*\*\*+)$/.test(line)) continue;

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      if (output.length && output[output.length - 1] !== "") output.push("");
      output.push(`*${formatInlineWhatsApp(heading[1] ?? "").replace(/^\*+|\*+$/g, "")}*`);
      continue;
    }

    const bullet = line.match(/^[-*+•]\s+(.+)$/);
    if (bullet) {
      output.push(`• ${formatInlineWhatsApp(bullet[1] ?? "")}`);
      continue;
    }

    output.push(formatInlineWhatsApp(line));
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function callProvider(
  provider: Provider,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: provider.model, messages, ...provider.body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`${provider.name} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const answer = formatForWhatsApp(payload.choices?.[0]?.message?.content ?? "");
  if (!answer) throw new Error(`${provider.name} returned an empty answer`);
  return answer;
}

/**
 * Ask the AI. Tries Groq first, then NVIDIA if Groq is not configured or fails
 * (error, timeout, or empty answer). Throws only if every configured provider fails.
 */
export async function generateReply(input: {
  voterName?: string;
  question: string;
  history: ChatEntry[];
}): Promise<string> {
  const providers = getProviders();
  if (providers.length === 0) {
    throw new Error("No AI provider is configured. Set GROQ_API_KEY and/or NVIDIA_API_KEY.");
  }

  const messages = [
    { role: "system", content: buildSystemPrompt(input.voterName) },
    ...input.history.map((entry) => ({ role: entry.role, content: entry.text })),
    { role: "user", content: input.question },
  ];

  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const answer = await callProvider(provider, messages);
      if (failures.length) {
        logger.warn({ provider: provider.name, earlierFailures: failures }, "Cleo answered using the fallback AI provider");
      }
      return answer;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(reason);
      logger.warn({ provider: provider.name, reason }, "Cleo AI provider failed");
    }
  }

  throw new Error(`All AI providers failed: ${failures.join(" | ")}`);
}
