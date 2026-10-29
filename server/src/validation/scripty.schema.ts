import { z } from "zod";

// The client sends only the new message and which conversation it belongs
// to. The transcript itself lives on the server (conversationStore.ts):
// a client can no longer replay a forged assistant turn or tool result
// into the model. Unknown fields, including a legacy `history`, are
// stripped by Zod and never reach the model.
export const scriptyMessageSchema = z.object({
  message: z.string().trim().min(1, "Type a message.").max(2000, "Messages are limited to 2,000 characters."),
  conversationId: z.string().uuid().optional(),
  prescriptionId: z.string().uuid().optional(),
  /** Catalogue medicine page the chat was opened from. Validated server-side. */
  medicineId: z.string().uuid().optional(),
});

export const scriptyConfirmSchema = z.object({
  token: z.string().min(10).max(4000),
  conversationId: z.string().uuid().optional(),
});

export const scriptyConversationParamsSchema = z.object({
  conversationId: z.string().uuid(),
});

export type ScriptyMessageInput = z.infer<typeof scriptyMessageSchema>;
export type ScriptyConfirmInput = z.infer<typeof scriptyConfirmSchema>;
