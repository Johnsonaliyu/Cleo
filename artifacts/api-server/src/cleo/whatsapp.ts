import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { rm } from "node:fs/promises";
import path from "node:path";
import { logger } from "../lib/logger";
import { BOT_NAMES, handleCleoMessage } from "./chatHandler";
import { loadKnowledgeBase } from "./knowledge";
import { mentionsBotName } from "./triggers";

export type WhatsAppConnectionStatus =
  | "not_started"
  | "connecting"
  | "qr_ready"
  | "connected"
  | "closed"
  | "error";

let status: WhatsAppConnectionStatus = "not_started";
let socket: WASocket | undefined;
let reconnecting = false;
let latestQr: string | null = null;

/** Messages older than this (seconds) are ignored, so Cleo never answers a backlog after a restart. */
const MAX_MESSAGE_AGE_SECONDS = 120;

/** Optional: also answer when someone replies directly to one of Cleo's messages. Off by default. */
const REPLY_TRIGGER = process.env.CLEO_REPLY_TRIGGER === "true";

function authDir() {
  return path.resolve(process.env.CLEO_AUTH_DIR ?? "data/cleo-auth");
}

// WhatsApp sometimes wraps the real message (disappearing chats, view-once).
function unwrap(message: any): any {
  return (
    message?.ephemeralMessage?.message ??
    message?.viewOnceMessage?.message ??
    message?.viewOnceMessageV2?.message ??
    message?.documentWithCaptionMessage?.message ??
    message
  );
}

function extractText(message: any): string | undefined {
  const m = unwrap(message);
  return (
    m?.conversation ??
    m?.extendedTextMessage?.text ??
    m?.imageMessage?.caption ??
    m?.videoMessage?.caption ??
    m?.documentMessage?.caption
  );
}

function getContextInfo(message: any) {
  const m = unwrap(message);
  return (
    m?.extendedTextMessage?.contextInfo ??
    m?.imageMessage?.contextInfo ??
    m?.videoMessage?.contextInfo ??
    m?.documentMessage?.contextInfo
  );
}

function isGroupJid(jid: string) {
  return jid.endsWith("@g.us");
}

function isIgnoredJid(jid: string) {
  return jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter");
}

function stripDevice(jid?: string | null): string | undefined {
  // "2348012345678:12@s.whatsapp.net" -> "2348012345678"
  return jid?.split("@")[0]?.split(":")[0];
}

/**
 * In a group Cleo stays silent unless she is called: her name appears in the
 * message, or someone tags (@mentions) her number.
 */
function isCleoCalled(message: any, text: string, sock?: WASocket): boolean {
  // 1) Her name typed in the text, e.g. "Cleo, who is Johnson?"
  if (mentionsBotName(text, BOT_NAMES)) return true;

  const ctx = getContextInfo(message.message);
  const myIds = [stripDevice(sock?.user?.id), stripDevice((sock?.user as any)?.lid)].filter(Boolean);

  // 2) A real WhatsApp @mention (tag) of her number
  const mentioned: string[] = ctx?.mentionedJid ?? [];
  if (mentioned.some((jid) => myIds.includes(stripDevice(jid)))) return true;

  // 3) Optional: a direct reply to one of her messages
  if (REPLY_TRIGGER && myIds.includes(stripDevice(ctx?.participant))) return true;

  return false;
}

export function getWhatsAppStatus() {
  return {
    status,
    connected: status === "connected",
    qr: latestQr,
  };
}

async function connect() {
  status = "connecting";
  const dir = authDir();
  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const connectionSocket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ["Cleo", "Chrome", "1.0.0"],
    logger,
  });
  socket = connectionSocket;

  connectionSocket.ev.on("creds.update", saveCreds);
  connectionSocket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (socket !== connectionSocket) return;

    if (qr) {
      status = "qr_ready";
      latestQr = qr;
      logger.info("Cleo WhatsApp QR ready; scan it with the WhatsApp number");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      status = "connected";
      latestQr = null;
      logger.info("Cleo WhatsApp connection opened");
    } else if (connection === "close") {
      status = "closed";
      latestQr = null;
      socket = undefined;
      const disconnectCode = (
        lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output?.statusCode;
      const loggedOut = disconnectCode === DisconnectReason.loggedOut;
      // 440 = this WhatsApp login was opened somewhere else (e.g. another deployment
      // using the same paired number). Reconnecting just starts a tug-of-war.
      const replaced = disconnectCode === DisconnectReason.connectionReplaced;
      const shouldReconnect = !replaced;
      logger.warn({ shouldReconnect, loggedOut, replaced, disconnectCode }, "Cleo WhatsApp connection closed");
      if (shouldReconnect && !reconnecting) {
        reconnecting = true;
        setTimeout(() => {
          void (async () => {
            try {
              if (loggedOut) {
                await rm(dir, { recursive: true, force: true });
                logger.info("Cleo WhatsApp auth cleared after logout; requesting a new QR");
              }
              await connect();
            } catch (error: unknown) {
              status = "error";
              logger.error({ err: error }, "Cleo WhatsApp reconnect failed");
            } finally {
              reconnecting = false;
            }
          })();
        }, loggedOut ? 500 : 3000);
      }
    }
  });

  connectionSocket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (socket !== connectionSocket) return;
    if (type !== "notify") return;

    for (const message of messages) {
      const chatJid = message.key.remoteJid;
      if (message.key.fromMe || !chatJid || isIgnoredJid(chatJid)) continue;

      const timestamp = Number(message.messageTimestamp);
      if (Number.isFinite(timestamp) && Date.now() / 1000 - timestamp > MAX_MESSAGE_AGE_SECONDS) continue;

      const text = extractText(message.message)?.trim();
      if (!text) continue;

      const isGroup = isGroupJid(chatJid);

      // In groups, stay silent unless Cleo is named or tagged. This check runs before
      // the "typing..." presence so she never appears to type for messages she ignores.
      if (isGroup && !isCleoCalled(message, text, socket)) continue;

      const senderJid = isGroup ? message.key.participant ?? chatJid : chatJid;
      const sessionKey = isGroup ? `${chatJid}::${senderJid}` : chatJid;

      const sendPresence = async (presence: "composing" | "paused") => {
        try {
          await socket?.presenceSubscribe(chatJid);
          await socket?.sendPresenceUpdate(presence, chatJid);
        } catch (error) {
          logger.debug({ err: error, chatJid, presence }, "Cleo presence update failed");
        }
      };

      try {
        await sendPresence("composing");
        const reply = await handleCleoMessage({
          sessionKey,
          senderName: message.pushName ?? undefined,
          isGroup,
          text,
        });
        // In groups, quote the voter's message so everyone can see who Cleo is answering.
        await socket?.sendMessage(chatJid, { text: reply }, isGroup ? { quoted: message } : undefined);
      } catch (error) {
        // Must not throw: an error here escapes the event handler and, on Node 24,
        // an unhandled rejection kills the whole process.
        logger.error({ err: error, chatJid }, "Cleo message handling failed");
      } finally {
        await sendPresence("paused");
      }
    }
  });
}

export async function resetWhatsAppPairing() {
  if (reconnecting) {
    throw new Error("WhatsApp pairing is already being reset.");
  }

  const dir = authDir();
  const currentSocket = socket;
  reconnecting = true;
  status = "closed";
  latestQr = null;
  socket = undefined;

  try {
    await currentSocket?.logout().catch((error: unknown) => {
      logger.debug({ err: error }, "WhatsApp logout was already completed");
    });
    await rm(dir, { recursive: true, force: true });
    logger.info("Cleo WhatsApp pairing reset; requesting a new QR");
    await connect();
  } finally {
    reconnecting = false;
  }
}

export async function startWhatsApp() {
  if (status === "connecting" || status === "connected" || status === "qr_ready") return;
  // Fail loudly at startup if the knowledge base file is missing, not on the first voter question.
  loadKnowledgeBase();
  await connect();
}

/** Used by the dashboard preview endpoint: runs a message through Cleo exactly as WhatsApp would, without WhatsApp. */
export async function previewConversation(sessionId: string, senderName: string | undefined, text: string) {
  return handleCleoMessage({
    sessionKey: `preview::${sessionId}`,
    senderName,
    isGroup: false,
    text,
  });
}
