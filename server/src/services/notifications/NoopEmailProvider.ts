import type { EmailDeliveryProvider, ReminderEmailMessage } from "./types";
import { EmailProviderNotConfiguredError } from "./types";

// The default provider (EMAIL_PROVIDER=none). Always throws a specific,
// recognizable error so the scheduler records a clear
// SKIPPED_NOT_CONFIGURED delivery status — never a silent no-op, and
// never a false "sent".
export class NoopEmailProvider implements EmailDeliveryProvider {
  readonly name = "none";

  async send(_message: ReminderEmailMessage): Promise<void> {
    throw new EmailProviderNotConfiguredError();
  }
}
