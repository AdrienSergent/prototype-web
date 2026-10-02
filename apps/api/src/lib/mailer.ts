import { config } from "../config";
import { logger } from "./logger";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export const sentMails: Mail[] = [];

/** Envoi transactionnel : Brevo (hébergement UE) en production, journal en développement. */
export async function sendMail(mail: Mail): Promise<void> {
  if (config.MAIL_DRIVER === "log" || !config.BREVO_API_KEY) {
    if (config.NODE_ENV === "test") sentMails.push(mail);
    else logger.info({ to: mail.to, subject: mail.subject, text: mail.text }, "Email (non envoyé, MAIL_DRIVER=log)");
    return;
  }
  const from = /^(.*)<(.+)>$/.exec(config.MAIL_FROM);
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": config.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: from ? { name: from[1]!.trim(), email: from[2]!.trim() } : { email: config.MAIL_FROM },
      to: [{ email: mail.to }],
      subject: mail.subject,
      textContent: mail.text,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}
