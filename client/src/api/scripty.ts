import { ApiError, BASE_URL, apiRequest, getCsrfToken } from "./client";
import type { ScriptyReply, ScriptyStatus } from "@/types";

export function getScriptyStatus() {
  return apiRequest<ScriptyStatus>("/scripty/status");
}

export interface ScriptyMessageInput {
  message: string;
  /** Omit to start a new conversation; the server returns the id to continue it. */
  conversationId?: string;
  prescriptionId?: string;
  /** Catalogue medicine page the chat was opened from. */
  medicineId?: string;
}

export function sendMessage(input: ScriptyMessageInput) {
  return apiRequest<ScriptyReply>("/scripty/message", { method: "POST", body: input });
}

export interface ScriptyStreamHandlers {
  onConversation?: (conversationId: string, restarted: boolean) => void;
  onText?: (delta: string) => void;
  onTool?: (name: string, status: "running" | "done" | "error") => void;
}

/**
 * Sends a message and streams Scripty's reply as it is written
 * (Server-Sent Events over a POST, so it can carry the CSRF header and
 * auth cookies like every other mutating call). Resolves with the final
 * reply; rejects with ApiError on any failure, before or during the stream.
 */
export async function streamMessage(
  input: ScriptyMessageInput,
  handlers: ScriptyStreamHandlers,
  signal?: AbortSignal
): Promise<ScriptyReply> {
  const res = await fetch(`${BASE_URL}/scripty/message/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "x-csrf-token": await getCsrfToken() },
    body: JSON.stringify(input),
    signal,
  });

  // Refusals that happen before streaming (not configured, rate limited,
  // validation, ownership) arrive as ordinary JSON errors.
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => undefined);
    const error = data?.error ?? { code: "UNKNOWN_ERROR", message: "Something went wrong reaching Scripty." };
    throw new ApiError(res.status, error.code, error.message, error.details);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let final: ScriptyReply | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE frames are separated by a blank line.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      const event = frame.match(/^event: (.*)$/m)?.[1];
      const dataLine = frame.match(/^data: (.*)$/m)?.[1];
      if (!event || dataLine === undefined) continue;
      const data = JSON.parse(dataLine);

      switch (event) {
        case "conversation":
          handlers.onConversation?.(data.conversationId, data.restarted);
          break;
        case "text":
          handlers.onText?.(data.delta);
          break;
        case "tool":
          handlers.onTool?.(data.name, data.status);
          break;
        case "done":
          final = data as ScriptyReply;
          break;
        case "error":
          throw new ApiError(502, data.code, data.message, data.details);
      }
    }
  }

  if (!final) throw new ApiError(502, "STREAM_INTERRUPTED", "Scripty's reply was interrupted. Please try again.");
  return final;
}

/**
 * Confirms a schedule action Scripty proposed. Deliberately a separate
 * call from sendMessage: nothing is created or changed until the user
 * takes this explicit step.
 */
export function confirmAction(token: string, conversationId?: string) {
  return apiRequest<ScriptyReply>("/scripty/confirm", { method: "POST", body: { token, conversationId } });
}
