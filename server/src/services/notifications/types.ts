// Shared contract for reminder email delivery providers — mirrors the
// extraction provider pattern (services/extraction/types.ts): swap
// EMAIL_PROVIDER in the environment, nothing else changes.
//
// A provider's job is just to attempt a send and either succeed or throw.
// It must NEVER resolve successfully unless the message was actually
// handed off to a real transport — the caller (reminderScheduler.service
// .ts) is what turns a thrown error into a recorded FAILED/retry, so a
// provider that silently swallows an error would show up as a false
// "SENT" status, which this project must not do.

export interface ReminderEmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailDeliveryProvider {
  readonly name: string;
  send(message: ReminderEmailMessage): Promise<void>;
}

export class EmailProviderNotConfiguredError extends Error {
  constructor(message = "Email delivery is not configured (EMAIL_PROVIDER=none).") {
    super(message);
    this.name = "EmailProviderNotConfiguredError";
  }
}
