import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import * as scriptyService from "@/services/scripty/scripty.service";
import { deleteConversation } from "@/services/scripty/conversationStore";
import { toScriptyError } from "@/services/scripty/anthropicClient";
import type { ScriptyConfirmInput, ScriptyMessageInput } from "@/validation/scripty.schema";

export const status = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json(scriptyService.scriptyStatus());
});

export const message = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as ScriptyMessageInput;
  const reply = await scriptyService.handleMessage({
    // userId comes from the authenticated session, never from the body —
    // the client cannot ask Scripty to act as someone else.
    userId: req.user!.id,
    message: body.message,
    conversationId: body.conversationId,
    prescriptionId: body.prescriptionId,
    medicineId: body.medicineId,
  });
  res.status(200).json(reply);
});

/**
 * The same turn, streamed as Server-Sent Events so the reply appears as it
 * is written. Everything that can be refused (configuration, ownership,
 * limits) is checked BEFORE the stream opens, so those failures are still
 * ordinary JSON errors with the right status code. Once streaming, a
 * failure arrives as an `error` event.
 *
 * Events: conversation, text, tool, done (the full ScriptyReply), error.
 */
export async function streamMessage(req: Request, res: Response, next: NextFunction) {
  const body = req.body as ScriptyMessageInput;
  let prepared: scriptyService.PreparedTurn;
  try {
    prepared = await scriptyService.prepareTurn({
      userId: req.user!.id,
      message: body.message,
      conversationId: body.conversationId,
      prescriptionId: body.prescriptionId,
      medicineId: body.medicineId,
    });
  } catch (err) {
    return next(err);
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // If the user closes the panel mid-answer, stop generating (and paying).
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const reply = await scriptyService.runTurn(prepared, {
      emit: (event) => send(event.type, event),
      signal: abort.signal,
    });
    send("done", reply);
  } catch (err) {
    if (!abort.signal.aborted) {
      const appError = toScriptyError(err);
      send("error", { code: appError.code, message: appError.message, details: appError.details });
    }
  } finally {
    res.end();
  }
}

export const confirm = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as ScriptyConfirmInput;
  const reply = await scriptyService.confirmAction({
    userId: req.user!.id,
    token: body.token,
    conversationId: body.conversationId,
  });
  res.status(200).json(reply);
});

export const endConversation = asyncHandler(async (req: Request, res: Response) => {
  // Scoped to the session's user: another user's id is simply not found.
  deleteConversation(req.params.conversationId, req.user!.id);
  res.status(204).end();
});
