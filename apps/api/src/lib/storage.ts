import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile, access, chmod } from "node:fs/promises";
import path from "node:path";
import { config } from "../config";

export interface PutOptions {
  /** Archive scellée : stockage non modifiable (S3 Object Lock, mode COMPLIANCE). */
  immutable?: boolean;
}

export interface Storage {
  put(key: string, body: Buffer, mime: string, opts?: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root))) throw new Error("Clé de stockage invalide");
    return p;
  }
  async put(key: string, body: Buffer, _mime: string, opts?: PutOptions) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    const exists = await access(p).then(
      () => true,
      () => false,
    );
    if (exists && opts?.immutable) throw new Error("Objet immuable déjà présent");
    await writeFile(p, body, { flag: opts?.immutable ? "wx" : "w" });
    if (opts?.immutable) await chmod(p, 0o444);
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
}

class S3Storage implements Storage {
  private client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: !!config.S3_ENDPOINT,
    credentials:
      config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
        : undefined,
  });

  async put(key: string, body: Buffer, mime: string, opts?: PutOptions) {
    const retainUntil = new Date();
    retainUntil.setFullYear(retainUntil.getFullYear() + config.ARCHIVE_RETENTION_YEARS);
    await this.client.send(
      new PutObjectCommand({
        Bucket: opts?.immutable ? (config.S3_ARCHIVE_BUCKET ?? config.S3_BUCKET) : config.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: mime,
        ServerSideEncryption: "AES256",
        ...(opts?.immutable ? { ObjectLockMode: "COMPLIANCE" as const, ObjectLockRetainUntilDate: retainUntil } : {}),
      }),
    );
  }

  async get(key: string) {
    const bucket = key.startsWith("archives/") ? (config.S3_ARCHIVE_BUCKET ?? config.S3_BUCKET) : config.S3_BUCKET;
    const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
}

export const storage: Storage =
  config.STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage(path.resolve(config.STORAGE_LOCAL_DIR));
