export type ChatRole = "user" | "assistant";

export type ChatEntry = {
  role: ChatRole;
  text: string;
  createdAt: string;
};

/**
 * One remembered conversation. In a DM the key is the chat JID; in a group the
 * key is `groupJid::senderJid`, so every voter keeps their own thread of context.
 */
export type ChatSession = {
  key: string;
  name?: string;
  isGroup: boolean;
  /** Always the most recent HISTORY_LIMIT messages (user + Cleo combined). */
  history: ChatEntry[];
  createdAt: string;
  updatedAt: string;
};

export type IncomingChat = {
  sessionKey: string;
  senderName?: string;
  isGroup: boolean;
  /** Raw message text exactly as the voter typed it. */
  text: string;
};
