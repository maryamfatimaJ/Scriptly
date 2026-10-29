import crypto from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";

// Where Scripty's conversations live: server memory, nowhere else.
//
// Why on the server at all: the model needs the real transcript —
// including its own tool calls and the tool results our code returned —
// to follow a conversation ("I also have a headache" only makes sense
// next to "I have a fever"). Keeping that transcript server-side means the
// browser cannot replay a forged assistant turn or a fake tool result into
// the model, which the previous client-held history allowed.
//
// Why memory and not the database: symptom chats are some of the most
// sensitive data this app touches, and nothing else in Scriptly needs
// them later. Holding them only for an idle window (default two hours)
// and never writing them to disk is the minimum storage that makes a
// conversation work. The cost is deliberate: a server restart ends open
// conversations, and the client starts a fresh one. This is a
// single-process store; a multi-instance deployment would need a shared
// store with the same expiry rules.
//
// Every read is keyed by BOTH conversation id and the session's user id,
// so an id leaked or guessed from another account resolves to nothing.

export interface Conversation {
  id: string;
  userId: string;
  /** The prescription the conversation was opened from, if any. */
  prescriptionId?: string;
  /** The catalogue medicine page the conversation was opened from, if any. */
  medicineId?: string;
  /**
   * The transcript exactly as sent to and returned by the API. Append-only:
   * thinking blocks are bound to the prefix that produced them, so earlier
   * turns are never edited or trimmed. Length is bounded by maxTurns.
   */
  messages: Anthropic.Beta.BetaMessageParam[];
  userTurns: number;
  updatedAt: number;
  /** True while a turn is running, so two requests cannot interleave. */
  busy: boolean;
}

const MAX_CONVERSATIONS_PER_USER = 20;
const conversations = new Map<string, Conversation>();

function ttlMs(): number {
  return env.scriptyConversationTtlMinutes * 60 * 1000;
}

function sweep(now = Date.now()) {
  for (const [id, conversation] of conversations) {
    if (!conversation.busy && now - conversation.updatedAt > ttlMs()) conversations.delete(id);
  }
}

export function createConversation(userId: string, prescriptionId?: string, medicineId?: string): Conversation {
  sweep();

  // Bound per-user memory: drop that user's least recently used
  // conversation rather than growing without limit.
  const owned = [...conversations.values()]
    .filter((c) => c.userId === userId && !c.busy)
    .sort((a, b) => a.updatedAt - b.updatedAt);
  while (owned.length >= MAX_CONVERSATIONS_PER_USER) {
    conversations.delete(owned.shift()!.id);
  }

  const conversation: Conversation = {
    id: crypto.randomUUID(),
    userId,
    prescriptionId,
    medicineId,
    messages: [],
    userTurns: 0,
    updatedAt: Date.now(),
    busy: false,
  };
  conversations.set(conversation.id, conversation);
  return conversation;
}

/** Returns the conversation only if it exists, has not expired, AND belongs to this user. */
export function getConversation(conversationId: string, userId: string): Conversation | null {
  const conversation = conversations.get(conversationId);
  if (!conversation || conversation.userId !== userId) return null;
  if (!conversation.busy && Date.now() - conversation.updatedAt > ttlMs()) {
    conversations.delete(conversationId);
    return null;
  }
  return conversation;
}

/** Ends a conversation early (the user cleared it). Scoped to the owner like every read. */
export function deleteConversation(conversationId: string, userId: string): boolean {
  const conversation = conversations.get(conversationId);
  if (!conversation || conversation.userId !== userId) return false;
  return conversations.delete(conversationId);
}

/** Test-only: forget every conversation. */
export function clearConversationsForTests() {
  conversations.clear();
}
