import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/config/env";
import type { EmailDeliveryProvider, ReminderEmailMessage } from "./types";

// Generic SMTP provider via nodemailer — deliberately provider-agnostic
// (works with Gmail app passwords for local testing, or any transactional
// provider's SMTP relay — Resend, SendGrid, Mailgun, Postmark, etc. — not
// locking this project into one vendor's proprietary API). Real
// credentials (SMTP_HOST/PORT/USER/PASS/FROM_EMAIL) must be supplied in
// server/.env before this can send anything.
//
// STATUS: implemented and ready to test, but NOT verified against a real
// mailbox in this environment — no SMTP credentials have been provided.
// Do not report emails as "delivered" until this has actually been
// exercised end-to-end with real credentials and a received message
// confirmed.
export class SmtpEmailProvider implements EmailDeliveryProvider {
  readonly name = "smtp";
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    if (!env.smtpHost || !env.smtpPort || !env.smtpUser || !env.smtpPass || !env.smtpFromEmail) {
      throw new Error(
        "EMAIL_PROVIDER=smtp but SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM_EMAIL are not fully set. " +
          "Set all of these in server/.env, or switch EMAIL_PROVIDER back to \"none\"."
      );
    }

    this.transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });
    return this.transporter;
  }

  async send(message: ReminderEmailMessage): Promise<void> {
    const transporter = this.getTransporter();
    // Let nodemailer's own error propagate on failure (network issue, auth
    // failure, rejected recipient, etc.) — the caller treats any thrown
    // error as a failed delivery attempt, never a silent success.
    await transporter.sendMail({
      from: `"${env.smtpFromName}" <${env.smtpFromEmail}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
