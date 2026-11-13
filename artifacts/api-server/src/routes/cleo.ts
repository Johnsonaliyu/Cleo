import { Router, type IRouter } from "express";
import { getAiProviderStatus } from "../cleo/aiHandler";
import { countSessions } from "../cleo/sessionStore";
import { getWhatsAppStatus, previewConversation, resetWhatsAppPairing } from "../cleo/whatsapp";

const router: IRouter = Router();

router.get("/cleo/status", async (_req, res) => {
  res.json({
    whatsapp: getWhatsAppStatus(),
    ai: getAiProviderStatus(),
    sessions: await countSessions(),
  });
});

router.post("/cleo/whatsapp/reset", async (_req, res) => {
  try {
    await resetWhatsAppPairing();
    res.json({ status: getWhatsAppStatus() });
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : "Could not reset WhatsApp pairing.",
    });
  }
});

// Try Cleo without WhatsApp, e.g.
//   curl -X POST localhost:8080/api/cleo/preview -H 'content-type: application/json' \
//        -d '{"name":"Tunde","text":"Hello Cleo"}'
router.post("/cleo/preview", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    res.status(400).json({ error: "text is required." });
    return;
  }
  const name = String(req.body?.name ?? "").trim() || undefined;
  const sessionId = String(req.body?.sessionId ?? "default").trim() || "default";
  try {
    res.json({ reply: await previewConversation(sessionId, name, text) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Preview failed." });
  }
});

export default router;
