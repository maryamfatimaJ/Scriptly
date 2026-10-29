import { env } from "@/config/env";
import { NoopEmailProvider } from "./NoopEmailProvider";
import { SmtpEmailProvider } from "./SmtpEmailProvider";
import type { EmailDeliveryProvider, ReminderEmailMessage } from "./types";

const providers: Record<string, EmailDeliveryProvider> = {
  none: new NoopEmailProvider(),
  smtp: new SmtpEmailProvider(),
};

function getProvider(): EmailDeliveryProvider {
  const provider = providers[env.emailProvider];
  if (!provider) {
    throw new Error(`Unknown EMAIL_PROVIDER "${env.emailProvider}". Expected one of: ${Object.keys(providers).join(", ")}`);
  }
  return provider;
}

/** Single entry point for sending a reminder email — callers never import a specific provider directly. */
export async function sendReminderEmail(message: ReminderEmailMessage): Promise<void> {
  const provider = getProvider();
  await provider.send(message);
}

export function currentEmailProviderName(): string {
  return env.emailProvider;
}

export { EmailProviderNotConfiguredError } from "./types";
export type { ReminderEmailMessage } from "./types";
