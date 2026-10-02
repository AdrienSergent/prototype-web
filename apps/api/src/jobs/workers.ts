import { todayParis, weekday } from "@cir/shared";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import type PgBoss from "pg-boss";
import { config } from "../config";
import { db, schema } from "../db/client";
import { logger } from "../lib/logger";
import { sendMail } from "../lib/mailer";
import { sealArchive, type SealJob } from "../modules/archives/service";
import { QUEUES } from "./queues";

/** Rappel quotidien optionnel (F5.5) : contributeurs ayant activé le rappel, jours ouvrés, heure choisie. */
export async function sendDailyReminders(now = new Date()) {
  const today = todayParis(now);
  const hour = Number(new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", hour12: false, timeZone: "Europe/Paris" }).format(now));
  const wd = weekday(today);
  const rows = await db
    .select({ r: schema.reminders, u: schema.users })
    .from(schema.reminders)
    .innerJoin(schema.users, eq(schema.users.id, schema.reminders.userId))
    .where(and(eq(schema.reminders.enabled, true), eq(schema.reminders.hour, hour), or(isNull(schema.reminders.lastSentOn), ne(schema.reminders.lastSentOn, today))));
  for (const { r, u } of rows) {
    if (!r.weekdays.includes(wd)) continue;
    await sendMail({
      to: u.email,
      subject: "Rappel : votre fiche de recherche du jour",
      text: `Bonjour ${u.fullName},\n\nPensez à consigner vos travaux du jour (moins de 2 minutes) : ${config.APP_URL}/fiches/nouvelle\n\nVous pouvez désactiver ce rappel dans votre profil.`,
    });
    await db.update(schema.reminders).set({ lastSentOn: today }).where(eq(schema.reminders.userId, r.userId));
  }
  return rows.length;
}

export async function registerWorkers(boss: PgBoss) {
  await boss.work<SealJob>(QUEUES.sealArchive, async (jobs) => {
    for (const job of jobs) await sealArchive(job.data);
  });
  await boss.work(QUEUES.reminders, async () => {
    const n = await sendDailyReminders();
    if (n) logger.info({ n }, "Rappels envoyés");
  });
  await boss.schedule(QUEUES.reminders, "*/15 * * * *", undefined, { tz: "Europe/Paris" });
}
