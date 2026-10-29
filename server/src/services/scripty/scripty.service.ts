import crypto from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { AppError } from "@/utils/AppError";
import * as scheduleService from "@/services/schedule.service";
import { SCRIPTY_TOOLS, getTool, buildScheduleProposal, type ToolContext } from "./tools";
import { SCRIPTY_SYSTEM_PROMPT } from "./systemPrompt";
import { visibleCatalogue } from "@/services/medicineInfo/catalogueVisibility";
import { lookupPrice } from "@/services/medicineInfo/price.service";
import {
  SETUP_INSTRUCTIONS,
  describeForLog,
  getAnthropicClient,
  isScriptyConfigured,
  toScriptyError,
} from "./anthropicClient";
import { createConversation, getConversation, type Conversation } from "./conversationStore";

// Scripty's conversation engine: a Claude tool-use loop.
//
//   user message
//     -> Claude replies, optionally calling tools          [conversation]
//     -> OUR code validates and runs each tool call,
//        with the session's userId and our ownership checks [facts]
//     -> results go back to Claude, which continues
//     -> ... until Claude answers in text
//
// Claude decides what to look up and how to say it. It never decides what
// is true about the user's records (the tools return that), and it can
// never change anything: the two mutating tools only produce a signed
// proposal, which runs solely when the user presses Confirm (confirmAction
// below). There is no keyword fallback and no canned answer — without an
// API key Scripty says it is not configured.

export const QUICK_ACTIONS = [
  { id: "understand", label: "Understand my medicines", message: "Explain the medicines on this prescription in plain language." },
  { id: "information", label: "View medicine information", message: "What is this medicine used for?" },
  { id: "price", label: "Check prices in Pakistan", message: "What do these medicines cost in Pakistan?" },
  { id: "ingredients", label: "Ingredients & side effects", message: "What are the ingredients and common side effects?" },
  { id: "remind", label: "Set up medicine reminders", message: "Help me set up reminders for these medicines." },
  { id: "manage", label: "Manage my schedules", message: "Show my current medicine schedules." },
  { id: "ask", label: "Ask about this prescription", message: "" },
] as const;

// Server-side fallback: if the requested model declines a request on
// policy grounds, the API re-runs it on a fallback model within the same
// call, chosen by refusal category. Medical questions occasionally trip
// safety classifiers, and an unanswered health question is a worse
// outcome than an answer from the fallback model.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// Upper bound on Claude <-> tool round trips in one turn. A real question
// needs two or three (find the medicine, read its label, answer).
const MAX_TOOL_ROUNDS = 6;

// ---------------------------------------------------------------------------
// Confirmation tokens
// ---------------------------------------------------------------------------

// A pending action is signed server-side so the confirm request cannot be
// tampered with between the proposal and the confirmation. The token
// carries the action, NOT a permission: the tool's own ownership and
// review-status checks still run when it is finally executed.
const CONFIRMATION_TTL_MS = 15 * 60 * 1000;

interface PendingActionPayload {
  userId: string;
  tool: string;
  args: Record<string, unknown>;
  expiresAt: number;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", env.jwtAccessSecret).update(payload).digest("base64url");
}

export function createConfirmationToken(payload: PendingActionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyConfirmationToken(token: string, userId: string): PendingActionPayload {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw AppError.badRequest("That confirmation is not valid any more.");

  const expected = sign(body);
  // Constant-time compare; lengths must match first or timingSafeEqual throws.
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw AppError.badRequest("That confirmation is not valid any more.");
  }

  let payload: PendingActionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PendingActionPayload;
  } catch {
    throw AppError.badRequest("That confirmation is not valid any more.");
  }

  if (payload.expiresAt < Date.now()) {
    throw AppError.badRequest("That confirmation expired. Please ask Scripty again.");
  }
  // The token is bound to the user it was issued to — one user's
  // confirmation can never act on another user's account.
  if (payload.userId !== userId) {
    throw AppError.forbidden("That confirmation was not issued to you.");
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Types shared with the controller
// ---------------------------------------------------------------------------

export interface ScriptyPendingAction {
  token: string;
  tool: string;
  summary: string;
  proposal: unknown;
  missingInformation: string[];
}

export interface ScriptyToolResult {
  tool: string;
  data: unknown;
}

export interface ScriptyReply {
  conversationId: string;
  reply: string;
  /** Results the UI renders as cards. Structured data, not prose, is the source of truth. */
  results: ScriptyToolResult[];
  /** The most relevant result, kept for single-card renderers. */
  tool: string | null;
  data: unknown;
  /** Present when the user must confirm before anything changes. */
  pendingAction?: ScriptyPendingAction;
  /** Every tool Claude called this turn, in order — what the answer was based on. */
  toolsUsed: string[];
  quickActions: typeof QUICK_ACTIONS;
  /** Always true for a conversational reply: the wording came from the model. */
  modelComposed: boolean;
  /** Set when the client's conversation had expired and a new one was started. */
  conversationRestarted?: boolean;
  notice?: string;
}

export type ScriptyStreamEvent =
  | { type: "conversation"; conversationId: string; restarted: boolean }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "running" | "done" | "error" };

// ---------------------------------------------------------------------------
// Turn preparation — everything that can fail BEFORE a stream is opened
// ---------------------------------------------------------------------------

export interface PreparedTurn {
  userId: string;
  message: string;
  conversation: Conversation;
  restarted: boolean;
}

export async function prepareTurn(input: {
  userId: string;
  message: string;
  conversationId?: string;
  prescriptionId?: string;
  medicineId?: string;
}): Promise<PreparedTurn> {
  if (!isScriptyConfigured()) {
    throw new AppError(503, "SCRIPTY_NOT_CONFIGURED", SETUP_INSTRUCTIONS);
  }

  // The prescription a conversation is opened from must be the user's
  // own. Checked here, not left to a tool, so a foreign id is refused
  // before anything reaches the model.
  if (input.prescriptionId) {
    const owned = await prisma.prescription.findFirst({
      where: { id: input.prescriptionId, userId: input.userId },
      select: { id: true },
    });
    if (!owned) throw AppError.notFound("Prescription not found.");
  }
  // Likewise a catalogue medicine must exist and be visible (not a
  // synthetic/demo row) before its details are given to the model.
  if (input.medicineId) {
    const visible = await prisma.medicineReference.findFirst({
      where: { id: input.medicineId, ...visibleCatalogue() },
      select: { id: true },
    });
    if (!visible) throw AppError.notFound("Medicine not found.");
  }

  let conversation = input.conversationId ? getConversation(input.conversationId, input.userId) : null;
  // An unknown id — expired, from before a restart, or another user's —
  // starts a fresh conversation. It never reveals whether the id existed.
  const restarted = Boolean(input.conversationId && !conversation);
  conversation ??= createConversation(input.userId, input.prescriptionId, input.medicineId);

  if (conversation.busy) {
    throw AppError.conflict("Scripty is still answering your previous message.");
  }
  if (conversation.userTurns >= env.scriptyMaxTurns) {
    throw new AppError(
      409,
      "CONVERSATION_LIMIT",
      "This conversation has reached its length limit. Start a new conversation to keep going."
    );
  }

  return { userId: input.userId, message: input.message, conversation, restarted };
}

/**
 * Per-conversation context, sent once as the start of the first user
 * message — never in the system prompt, which must stay identical across
 * every request (see systemPrompt.ts). Contains no medical data: the model
 * fetches records through tools only when a question needs them.
 */
async function buildConversationContext(conversation: Conversation): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: conversation.userId }, select: { timezone: true } });
  const timezone = user?.timezone ?? "UTC";
  const now = DateTime.now().setZone(timezone);
  const lines = [
    "<app_context>",
    `Today is ${now.toFormat("cccc d LLLL yyyy")}; the user's local time is ${now.toFormat("HH:mm")} (${timezone}).`,
    conversation.prescriptionId
      ? `The user opened this chat from one of their prescriptions (prescriptionId ${conversation.prescriptionId}). "This prescription" means that one.`
      : "The user opened this chat from the app, not from a specific prescription.",
    ...(conversation.medicineId ? await medicineContextLines(conversation.medicineId) : []),
    "</app_context>",
  ];
  return lines.join("\n");
}

/**
 * The catalogue record a chat was opened from, exactly as stored, with its
 * verification status stated so the model cannot treat an unverified or
 * partial record as a confirmed product. Built from the database on the
 * server; nothing here comes from the client.
 */
export async function medicineContextLines(medicineId: string): Promise<string[]> {
  const record = await prisma.medicineReference.findFirst({ where: { id: medicineId, ...visibleCatalogue() } });
  if (!record) return [];
  const price = await lookupPrice({
    name: record.brandName ?? record.genericName,
    strength: record.strength,
    form: record.formulation,
    packSize: record.packSize,
  });
  const field = (label: string, value: string | null) => `- ${label}: ${value ?? "not recorded (unknown — do not fill in)"}`;
  return [
    `The user opened this chat from Scriptly's catalogue page for one medicine (medicineId ${record.id}). "This medicine" means that record. It is catalogue information, not the user's prescription: do not assume they take it.`,
    "Catalogue record, as stored:",
    field("Brand", record.brandName),
    field("Generic name", record.genericName),
    field("Active ingredient", record.activeIngredient),
    field("Strength", record.strength),
    field("Dosage form", record.formulation),
    field("Manufacturer", record.manufacturer),
    field("Pack size", record.packSize),
    field("Market", record.countryOrMarket),
    field("DRAP registration no.", record.registrationId),
    `- Record status: ${record.verificationStatus}${record.lastVerifiedAt ? `, last verified ${record.lastVerifiedAt.toISOString().slice(0, 10)}` : ""}, provenance ${record.dataProvenance}.` +
      (record.verificationStatus === "VERIFIED"
        ? ""
        : " This record is NOT verified: say so if you rely on it, and never present it as a confirmed product."),
    price.status === "VERIFIED"
      ? `- Price: ${price.price.priceBasis} (${price.price.priceType === "OFFICIAL_MRP" ? "official DRAP maximum retail price" : "retailer-listed price, not an official MRP"}; source ${price.price.sourceName ?? "unknown"}, last verified ${price.price.lastVerifiedAt?.toISOString().slice(0, 10) ?? "unknown"}).`
      : `- Price: no verified price (${price.reason}). Do not estimate one.`,
    "For label information (uses, warnings, side effects) call get_medicine_information; keep the source's meaning and warnings when you simplify it.",
  ];
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

interface TurnState {
  ctx: ToolContext;
  results: ScriptyToolResult[];
  toolsUsed: string[];
  pendingAction?: ScriptyPendingAction;
}

function errorResult(toolUseId: string, message: string): Anthropic.Beta.BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: toolUseId, is_error: true, content: message };
}

async function proposeAction(
  toolName: string,
  args: Record<string, unknown>,
  state: TurnState
): Promise<unknown> {
  if (state.pendingAction) {
    throw AppError.conflict(
      "A change is already waiting for the user's confirmation in this reply. Propose one change at a time."
    );
  }

  if (toolName === "propose_schedule") {
    const typed = args as { medicationId: string; times: string[]; startDate?: string; durationDays?: number; notes?: string };
    // Re-checks ownership and that the instructions are CONFIRMED; throws otherwise.
    const proposal = await buildScheduleProposal(state.ctx.userId, typed.medicationId, typed.times);
    const durationDays = typed.durationDays ?? proposal.durationDays ?? undefined;
    const token = createConfirmationToken({
      userId: state.ctx.userId,
      tool: toolName,
      args: { medicationId: typed.medicationId, times: typed.times, startDate: typed.startDate, durationDays, notes: typed.notes },
      expiresAt: Date.now() + CONFIRMATION_TTL_MS,
    });
    const name = proposal.medicationName ?? "this medicine";
    state.pendingAction = {
      token,
      tool: toolName,
      summary: `Create reminders for ${name} at ${typed.times.join(", ")}`,
      proposal,
      missingInformation: proposal.missingInformation,
    };
    return { status: "AWAITING_USER_CONFIRMATION", proposal };
  }

  // change_schedule_status — the schedule must be the user's own before a
  // proposal is even shown.
  const typed = args as { scheduleId: string; status: "ACTIVE" | "PAUSED" | "CANCELLED" };
  const schedule = await scheduleService.getScheduleById(state.ctx.userId, typed.scheduleId);
  const medicationName = schedule.medication.confirmedName ?? schedule.medication.extractedName ?? "this medicine";
  const proposal = { scheduleId: schedule.id, medicationName, currentStatus: schedule.status, newStatus: typed.status };
  const verb = { ACTIVE: "Resume", PAUSED: "Pause", CANCELLED: "Discontinue" }[typed.status];
  state.pendingAction = {
    token: createConfirmationToken({
      userId: state.ctx.userId,
      tool: toolName,
      args: { scheduleId: typed.scheduleId, status: typed.status },
      expiresAt: Date.now() + CONFIRMATION_TTL_MS,
    }),
    tool: toolName,
    summary: `${verb} the ${medicationName} schedule`,
    proposal,
    missingInformation: [],
  };
  return { status: "AWAITING_USER_CONFIRMATION", proposal };
}

async function runToolUse(
  block: Anthropic.Beta.BetaToolUseBlock,
  state: TurnState,
  emit: (event: ScriptyStreamEvent) => void
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  state.toolsUsed.push(block.name);
  const tool = getTool(block.name);
  if (!tool) return errorResult(block.id, `Unknown tool "${block.name}".`);

  // The JSON schema Claude saw is advisory; this is the enforced contract.
  const parsed = tool.schema.safeParse(block.input);
  if (!parsed.success) {
    return errorResult(block.id, JSON.stringify({ INVALID_INPUT: parsed.error.flatten() }));
  }

  emit({ type: "tool", name: tool.name, status: "running" });
  try {
    if (tool.requiresConfirmation) {
      const outcome = await proposeAction(tool.name, parsed.data as Record<string, unknown>, state);
      emit({ type: "tool", name: tool.name, status: "done" });
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify({
          ...(outcome as object),
          note:
            "Nothing has been saved. The user now sees this proposal with a Confirm button. Ask them to review " +
            "it and press Confirm; do not say it is saved.",
        }),
      };
    }

    const data = await tool.execute(state.ctx, parsed.data as never);
    if (tool.display) state.results.push({ tool: tool.name, data });
    emit({ type: "tool", name: tool.name, status: "done" });
    return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(data) };
  } catch (err) {
    emit({ type: "tool", name: tool.name, status: "error" });
    // Expected refusals (not found, not confirmed, bad input) go back to
    // Claude verbatim so it can explain them. Anything else is reported
    // as unavailable data — the model is told plainly not to fill the gap.
    if (err instanceof AppError && err.statusCode < 500) {
      return errorResult(block.id, err.message);
    }
    console.warn(`[scripty] tool ${tool.name} failed (${describeForLog(err)})`);
    return errorResult(
      block.id,
      "This lookup failed because of a server problem. The information is unavailable right now — tell the user, " +
        "and do not substitute your own figures or records."
    );
  }
}

// ---------------------------------------------------------------------------
// The conversation loop
// ---------------------------------------------------------------------------

function claudeTools(): Anthropic.Beta.BetaTool[] {
  return SCRIPTY_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
    // Streamed requests with client tools stream tool inputs as generated;
    // every input is still validated with Zod before it runs.
    eager_input_streaming: true,
  }));
}

/**
 * Picks which results to show as cards. A broad lookup Claude used only to
 * find an id (the medicine list) is dropped when a specific answer
 * (a label, a price) is also present, so the reply isn't buried in cards.
 */
function selectResultCards(results: ScriptyToolResult[]): ScriptyToolResult[] {
  const broad = new Set(["list_my_medications", "summarize_prescription"]);
  const hasSpecific = results.some((r) => !broad.has(r.tool));
  const seen = new Set<string>();
  return results
    .filter((r) => !(hasSpecific && broad.has(r.tool)))
    .filter((r) => {
      const key = `${r.tool}:${JSON.stringify(r.data)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-3);
}

export async function runTurn(
  prepared: PreparedTurn,
  options: { emit?: (event: ScriptyStreamEvent) => void; signal?: AbortSignal } = {}
): Promise<ScriptyReply> {
  const emit = options.emit ?? (() => {});
  const { conversation } = prepared;
  const client = getAnthropicClient();

  conversation.busy = true;
  emit({ type: "conversation", conversationId: conversation.id, restarted: prepared.restarted });

  try {
    // Work on a copy; the conversation is only updated once the turn
    // completes. A failed turn leaves the stored transcript untouched, so
    // the next message continues from the last good state.
    const working: Anthropic.Beta.BetaMessageParam[] = [...conversation.messages];
    const userContent: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (conversation.messages.length === 0) {
      userContent.push({ type: "text", text: await buildConversationContext(conversation) });
    }
    userContent.push({ type: "text", text: prepared.message });
    working.push({ role: "user", content: userContent });

    const state: TurnState = {
      ctx: { userId: conversation.userId, prescriptionId: conversation.prescriptionId },
      results: [],
      toolsUsed: [],
    };
    const replyParts: string[] = [];
    let emittedText = false;
    let refused = false;

    for (let round = 0; ; round += 1) {
      // Past the round limit, Claude must answer with what it has.
      const toolsAllowed = round < MAX_TOOL_ROUNDS;
      let roundHasText = false;

      const stream = client.beta.messages.stream(
        {
          model: env.anthropicModel,
          max_tokens: env.scriptyMaxOutputTokens,
          system: SCRIPTY_SYSTEM_PROMPT,
          tools: claudeTools(),
          tool_choice: toolsAllowed ? { type: "auto" } : { type: "none" },
          messages: working,
          thinking: { type: "adaptive" },
          output_config: { effort: env.scriptyEffort },
          // Caches the system prompt, tools and history between turns.
          cache_control: { type: "ephemeral" },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
        },
        { signal: options.signal }
      );

      stream.on("text", (delta) => {
        // Separate this round's text from an earlier round's ("Let me
        // check…" before a lookup, then the answer).
        if (!roundHasText && emittedText) emit({ type: "text", delta: "\n\n" });
        roundHasText = true;
        emittedText = true;
        emit({ type: "text", delta });
      });

      const message = await stream.finalMessage();
      working.push({ role: "assistant", content: message.content });

      const text = message.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
      if (text) replyParts.push(text);

      if (message.stop_reason === "refusal") {
        refused = true;
        break;
      }

      const toolUses = message.content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use"
      );
      // A tool call cut off at max_tokens may parse as a plausible but
      // truncated input. Never run it, and never commit a transcript that
      // ends in an unanswered tool call.
      if (message.stop_reason === "max_tokens" && toolUses.length > 0) {
        throw new AppError(502, "SCRIPTY_TRUNCATED", "Scripty's answer was cut short. Please try asking again.");
      }
      if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

      // Run this round's calls together and return every result in ONE
      // user message, as the API expects for parallel tool use.
      const toolResults = await Promise.all(toolUses.map((block) => runToolUse(block, state, emit)));
      working.push({ role: "user", content: toolResults });
    }

    let reply = replyParts.join("\n\n");
    if (refused) {
      const note =
        "I'm not able to help with that particular request. If it's about your health or a medicine, a doctor " +
        "or pharmacist is the right person to ask — and if it's urgent, please call Rescue 1122.";
      reply = reply ? `${reply}\n\n${note}` : note;
      emit({ type: "text", delta: emittedText ? `\n\n${note}` : note });
    }
    if (!reply) {
      throw new AppError(502, "SCRIPTY_EMPTY_REPLY", "Scripty didn't produce an answer. Please try asking again.");
    }

    // The turn succeeded: commit the transcript (append-only).
    conversation.messages = working;
    conversation.userTurns += 1;
    conversation.updatedAt = Date.now();

    const cards = selectResultCards(state.results);
    const primary = cards[cards.length - 1] ?? null;
    return {
      conversationId: conversation.id,
      reply,
      results: cards,
      tool: primary?.tool ?? null,
      data: primary?.data ?? null,
      pendingAction: state.pendingAction,
      toolsUsed: state.toolsUsed,
      quickActions: QUICK_ACTIONS,
      modelComposed: true,
      conversationRestarted: prepared.restarted || undefined,
    };
  } catch (err) {
    if (!(err instanceof AppError)) console.warn(`[scripty] turn failed (${describeForLog(err)})`);
    throw toScriptyError(err);
  } finally {
    conversation.busy = false;
  }
}

/** Non-streaming convenience: prepare and run a turn, returning the final reply. */
export async function handleMessage(input: {
  userId: string;
  message: string;
  conversationId?: string;
  prescriptionId?: string;
  medicineId?: string;
}): Promise<ScriptyReply> {
  return runTurn(await prepareTurn(input));
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

/**
 * Executes a previously proposed action after the user confirmed it.
 *
 * The token proves WHICH action was proposed and to WHOM; it does not
 * grant permission. The tool's own checks (ownership, CONFIRMED review
 * status) run here exactly as they would from any other caller.
 */
export async function confirmAction(input: {
  userId: string;
  token: string;
  conversationId?: string;
}): Promise<Omit<ScriptyReply, "conversationId"> & { conversationId: string | null }> {
  const payload = verifyConfirmationToken(input.token, input.userId);

  const tool = getTool(payload.tool);
  if (!tool || !tool.requiresConfirmation) {
    throw AppError.badRequest("That action can no longer be confirmed.");
  }

  const parsed = tool.schema.safeParse(payload.args);
  if (!parsed.success) {
    throw AppError.badRequest("That action is no longer valid. Please ask Scripty again.");
  }

  const data = await tool.execute({ userId: input.userId }, parsed.data as never);

  // Tell the conversation what actually happened, so Scripty's next
  // answer reflects the saved state rather than its own proposal. Marked
  // as an app event so it is never mistaken for something the user typed.
  const conversation = input.conversationId ? getConversation(input.conversationId, input.userId) : null;
  if (conversation && !conversation.busy) {
    conversation.messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text:
            `<app_event>The user pressed Confirm on the proposed ${payload.tool === "propose_schedule" ? "schedule" : "schedule change"}. ` +
            `The app saved it. Result: ${JSON.stringify(data)}</app_event>`,
        },
      ],
    });
    conversation.updatedAt = Date.now();
  }

  return {
    conversationId: conversation?.id ?? null,
    reply:
      payload.tool === "propose_schedule"
        ? "Done — your reminders are saved. You can see them on the Schedule page."
        : "Done — your schedule has been updated.",
    results: [],
    tool: payload.tool,
    data,
    toolsUsed: [],
    quickActions: QUICK_ACTIONS,
    // This confirmation is a fact reported by the app, not model output.
    modelComposed: false,
  };
}

export function scriptyStatus() {
  const configured = isScriptyConfigured();
  return {
    configured,
    provider: "anthropic",
    model: configured ? env.anthropicModel : null,
    setupInstructions: configured ? undefined : SETUP_INSTRUCTIONS,
    emailDelivery: env.emailProvider,
  };
}
