import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import { ApiError } from "@/api/client";
import * as scriptyApi from "@/api/scripty";
import { ScriptyResultCard } from "./ScriptyResultCard";
import type {
  ScheduleProposal,
  ScriptyPendingAction,
  ScriptyQuickAction,
  ScriptyReply,
  ScriptyToolResult,
} from "@/types";

// Scripty's conversation surface.
//
// Two deliberate choices worth knowing about before editing:
//
// 1. The conversation transcript lives on the SERVER. This component only
//    holds what it displays plus the conversationId, and sends one new
//    message per turn. Replies stream in as Claude writes them; the final
//    `done` payload then replaces the streamed text as the authoritative
//    version.
//
// 2. A proposed schedule renders as a CARD WITH A CONFIRM BUTTON, never as
//    an action that already happened. The assistant cannot create or
//    change a schedule by saying it did; only the user's click on
//    "Confirm" sends the signed token back to be executed.

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  results?: ScriptyToolResult[];
  pendingAction?: ScriptyPendingAction;
  modelComposed?: boolean;
  confirmed?: boolean;
  error?: boolean;
}

let messageCounter = 0;
const nextId = () => `m${++messageCounter}`;

// What the status line says while a tool runs, so a slow lookup reads as
// work in progress rather than a hang.
const TOOL_ACTIVITY: Record<string, string> = {
  summarize_prescription: "Reading your prescription…",
  list_my_medications: "Checking your medicines…",
  get_medicine_information: "Looking up the medicine label…",
  check_medicine_price: "Checking verified prices…",
  check_medicine_interactions: "Checking the labels for interactions…",
  list_my_schedules: "Reading your schedule…",
  check_reminder_delivery: "Checking reminder delivery…",
  propose_schedule: "Preparing a schedule for you to confirm…",
  change_schedule_status: "Preparing the change for you to confirm…",
};

function ProposalCard({
  pending,
  onConfirm,
  isConfirming,
  confirmed,
}: {
  pending: ScriptyPendingAction;
  onConfirm: () => void;
  isConfirming: boolean;
  confirmed?: boolean;
}) {
  const proposal = pending.proposal as Partial<ScheduleProposal> | null;

  return (
    <div className="rounded-2xl border-2 border-forest/30 bg-mint/30 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-forest">Proposed — not saved yet</p>
      <p className="mt-1 font-medium text-charcoal">{pending.summary}</p>

      {proposal?.dosageInstructions && (
        <p className="mt-2 rounded-xl bg-offwhite p-3 text-sm text-charcoal/80">
          {/* Copied verbatim from the confirmed prescription — Scripty
              never rewrites a dose. */}
          <span className="block text-xs uppercase tracking-wide text-gray">Your confirmed instructions</span>
          {proposal.dosageInstructions}
        </p>
      )}

      {proposal?.times && proposal.times.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {proposal.times.map((t) => (
            <span key={t} className="rounded-capsule bg-forest px-3 py-1 text-sm text-offwhite">
              {t}
            </span>
          ))}
        </div>
      )}

      {pending.missingInformation.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {pending.missingInformation.map((q, i) => (
            <li key={i}>• {q}</li>
          ))}
        </ul>
      )}

      {confirmed ? (
        <p className="mt-3 text-sm font-medium text-forest">✓ Saved.</p>
      ) : (
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={onConfirm} disabled={isConfirming} className="px-5 py-2">
            {isConfirming ? "Saving…" : "Confirm and save"}
          </Button>
          <span className="text-xs text-gray">Nothing changes until you confirm.</span>
        </div>
      )}
    </div>
  );
}

export function ScriptyChat({
  prescriptionId,
  medicineId,
  greeting,
  className,
  onClose,
}: {
  prescriptionId?: string;
  /** Opened from a catalogue medicine page; the server supplies its verified details. */
  medicineId?: string;
  greeting?: string;
  className?: string;
  /** When provided, a close control is rendered in the panel header. */
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: status } = useQuery({ queryKey: ["scripty", "status"], queryFn: scriptyApi.getScriptyStatus });

  const [quickActions, setQuickActions] = useState<ScriptyQuickAction[]>([]);

  useEffect(() => {
    if (messages.length === 0 && greeting) {
      setMessages([{ id: nextId(), role: "assistant", content: greeting }]);
    }
  }, [greeting, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const conversationIdRef = useRef<string | undefined>(undefined);
  const [activity, setActivity] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Closing the panel mid-answer stops generation on the server too.
  useEffect(() => () => abortRef.current?.abort(), []);

  const updateMessage = (id: string, patch: (m: ChatMessage) => Partial<ChatMessage>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)));

  const finishReply = (id: string, reply: ScriptyReply) => {
    setQuickActions(reply.quickActions ?? []);
    if (reply.conversationId) conversationIdRef.current = reply.conversationId;
    updateMessage(id, () => ({
      // The final payload is authoritative over the streamed text.
      content: reply.reply,
      results: reply.results ?? [],
      pendingAction: reply.pendingAction,
      modelComposed: reply.modelComposed,
    }));
  };

  const sendMutation = useMutation({
    mutationFn: async ({ message, replyId }: { message: string; replyId: string }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const reply = await scriptyApi.streamMessage(
        // Only the new message is sent. The transcript is held server-side.
        { message, prescriptionId, medicineId, conversationId: conversationIdRef.current },
        {
          onConversation: (conversationId) => {
            conversationIdRef.current = conversationId;
          },
          onText: (delta) => {
            setActivity(null);
            updateMessage(replyId, (m) => ({ content: m.content + delta }));
          },
          onTool: (name, state) => setActivity(state === "running" ? (TOOL_ACTIVITY[name] ?? "Looking that up…") : null),
        },
        controller.signal
      );
      return { reply, replyId };
    },
    onSuccess: ({ reply, replyId }) => finishReply(replyId, reply),
    onError: (error, { replyId }) => {
      // Any partially streamed text is discarded: the server did not
      // keep that turn, so showing half an answer would be misleading.
      updateMessage(replyId, () => ({
        error: true,
        content:
          error instanceof ApiError ? error.message : "Something went wrong reaching Scripty. Please try again.",
      }));
    },
    onSettled: () => {
      setActivity(null);
      abortRef.current = null;
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (token: string) => scriptyApi.confirmAction(token, conversationIdRef.current),
    onSuccess: (reply, token) => {
      // Mark the originating proposal as done so its button can't be
      // pressed twice.
      setMessages((prev) => [
        ...prev.map((m) => (m.pendingAction?.token === token ? { ...m, confirmed: true } : m)),
        { id: nextId(), role: "assistant", content: reply.reply, modelComposed: reply.modelComposed },
      ]);
      // The schedule list, medication list and reminder views all change
      // when a schedule is created.
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      queryClient.invalidateQueries({ queryKey: ["medications"] });
    },
    onError: (error) => {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          error: true,
          content: error instanceof ApiError ? error.message : "That action could not be completed.",
        },
      ]);
    },
  });

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    const replyId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: trimmed },
      { id: replyId, role: "assistant", content: "" },
    ]);
    setInput("");
    sendMutation.mutate({ message: trimmed, replyId });
  };

  const visibleQuickActions = (quickActions.length > 0 ? quickActions : DEFAULT_ACTIONS).filter((a) => a.message);

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-3xl border border-charcoal/10 bg-offwhite ${className ?? ""}`}>
      <header className="flex items-center gap-3 border-b border-charcoal/10 px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-capsule bg-forest text-sm font-medium text-offwhite">
          S
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg leading-tight">Scripty</p>
          <p className="truncate text-xs text-gray">
            {status?.configured ? `AI assistant · ${status.model}` : "AI assistant · not configured"}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close Scripty"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-charcoal/70 transition hover:bg-charcoal/10 hover:text-charcoal"
          >
            ×
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.filter((m) => m.role === "user" || m.content || m.error).map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : ""}>
            {message.role === "user" ? (
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-forest px-4 py-2.5 text-sm text-offwhite">
                {message.content}
              </p>
            ) : (
              <div className="max-w-full space-y-3">
                <p
                  className={`whitespace-pre-line text-sm leading-relaxed ${
                    message.error ? "text-red-700" : "text-charcoal/90"
                  }`}
                >
                  {message.content}
                </p>

                {message.pendingAction && (
                  <ProposalCard
                    pending={message.pendingAction}
                    confirmed={message.confirmed}
                    isConfirming={confirmMutation.isPending && confirmMutation.variables === message.pendingAction.token}
                    onConfirm={() => confirmMutation.mutate(message.pendingAction!.token)}
                  />
                )}

                {!message.pendingAction &&
                  message.results?.map((result, index) => (
                    <ScriptyResultCard key={`${result.tool}-${index}`} tool={result.tool} data={result.data} />
                  ))}
              </div>
            )}
          </div>
        ))}

        {sendMutation.isPending && (activity || !messages[messages.length - 1]?.content) && (
          <p className="text-sm text-charcoal/70" aria-live="polite">
            {activity ?? "Scripty is thinking…"}
          </p>
        )}
      </div>

      {visibleQuickActions.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-charcoal/10 px-5 py-3">
          {visibleQuickActions.map((action) => (
            <button
              key={action.id}
              onClick={() => send(action.message)}
              disabled={sendMutation.isPending}
              className="rounded-capsule border border-charcoal/15 px-3 py-1.5 text-xs text-charcoal transition hover:border-forest hover:text-forest disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-charcoal/10 px-5 py-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your medicines…"
          className="field flex-1"
          aria-label="Message Scripty"
        />
        <Button type="submit" disabled={!input.trim() || sendMutation.isPending} className="px-5 py-2.5">
          Send
        </Button>
      </form>

      <p className="border-t border-charcoal/10 px-5 py-2.5 text-[11px] leading-snug text-gray">
        Scripty gives general medicine information, not medical advice. It never changes a prescribed dose. Always
        follow your doctor's or pharmacist's instructions.
      </p>
    </div>
  );
}

const DEFAULT_ACTIONS: ScriptyQuickAction[] = [
  { id: "understand", label: "Understand my medicines", message: "Explain my medicines in plain language." },
  { id: "price", label: "Check prices", message: "What do these cost in Pakistan?" },
  { id: "manage", label: "My schedules", message: "Show my current medicine schedules." },
];
