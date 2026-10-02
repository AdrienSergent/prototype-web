import "dotenv/config";
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.url().default("http://localhost:5173"),
  API_URL: z.url().default("http://localhost:3000"),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().default("postgres://cir_app:cir_app@localhost:5432/cir_dev"),
  DATABASE_OWNER_URL: z.string().default("postgres://cir_owner:cir_owner@localhost:5432/cir_dev"),
  /** Si défini, la migration rend cir_app LOGIN avec ce mot de passe (environnements de dev). */
  DB_APP_PASSWORD: z.string().optional(),

  /** Clé AES-256 en base64 (32 octets) : salaires, secrets MFA. */
  APP_ENCRYPTION_KEY: z.string().default("ZGV2LW9ubHktZGV2LW9ubHktZGV2LW9ubHktZGV2LTE="),
  SESSION_IDLE_HOURS: z.coerce.number().default(12),
  MFA_ENFORCED: bool(true),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("fr-par"),
  S3_BUCKET: z.string().optional(),
  S3_ARCHIVE_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  ARCHIVE_RETENTION_YEARS: z.coerce.number().default(6),

  MAIL_DRIVER: z.enum(["log", "brevo"]).default("log"),
  BREVO_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default("Dossier CIR <no-reply@example.fr>"),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  TRIAL_DAYS: z.coerce.number().default(14),
  GRACE_DAYS: z.coerce.number().default(14),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT: z.string().default("common"),

  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().default(3310),

  RUN_WORKERS_IN_API: bool(true),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Configuration invalide :", z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";
export const billingEnabled = !!config.STRIPE_SECRET_KEY;

if (isProd && config.APP_ENCRYPTION_KEY === schema.shape.APP_ENCRYPTION_KEY.parse(undefined)) {
  console.error("APP_ENCRYPTION_KEY par défaut interdite en production.");
  process.exit(1);
}
