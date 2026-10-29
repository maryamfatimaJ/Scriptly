import { Router } from "express";
import * as scriptyController from "@/controllers/scripty.controller";
import { requireAuth } from "@/middleware/auth.middleware";
import { csrfProtection } from "@/middleware/csrf.middleware";
import { scriptyRateLimiter } from "@/middleware/rateLimit.middleware";
import { validate } from "@/middleware/validate.middleware";
import {
  scriptyConfirmSchema,
  scriptyConversationParamsSchema,
  scriptyMessageSchema,
} from "@/validation/scripty.schema";

const router = Router();

router.use(requireAuth);

router.get("/status", scriptyController.status);
router.post("/message", csrfProtection, scriptyRateLimiter, validate(scriptyMessageSchema), scriptyController.message);
router.post(
  "/message/stream",
  csrfProtection,
  scriptyRateLimiter,
  validate(scriptyMessageSchema),
  scriptyController.streamMessage
);
// Separate endpoint, separate CSRF-protected request: confirming a schedule
// change is a deliberate act by the user, not a continuation of a chat turn.
router.post("/confirm", csrfProtection, validate(scriptyConfirmSchema), scriptyController.confirm);
router.delete(
  "/conversations/:conversationId",
  csrfProtection,
  validate(scriptyConversationParamsSchema, "params"),
  scriptyController.endConversation
);

export default router;
