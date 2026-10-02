import { fileTypeFromBuffer } from "file-type";
import multer from "multer";
import net from "node:net";
import { config } from "../config";
import { HttpError, unprocessable } from "./errors";
import { sha256 } from "./crypto";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PNG = "image/png";
const JPG = "image/jpeg";
const ZIP = "application/zip";

export const ALLOWED = {
  cv: [PDF, DOCX],
  document: [PDF, DOCX, PNG, JPG],
  attachment: [PDF, DOCX, XLSX, PNG, JPG, ZIP, "text/plain", "text/csv", "application/json"],
  table: [XLSX, "text/csv", "text/plain"],
} as const;

const TEXT_EXT: Record<string, string> = {
  csv: "text/csv",
  txt: "text/plain",
  md: "text/plain",
  json: "application/json",
  ipynb: "application/json",
};

export interface InspectedFile {
  buffer: Buffer;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
}

/** Vérifie le type réel (signature binaire), limite la taille, analyse antivirus, calcule le SHA-256. */
export async function inspectUpload(file: Express.Multer.File | undefined, allowed: readonly string[], maxBytes = MAX_UPLOAD_BYTES): Promise<InspectedFile> {
  if (!file) throw unprocessable("Aucun fichier reçu");
  if (file.size > maxBytes) throw new HttpError(413, "file_too_large", "Fichier trop volumineux");
  const filename = Buffer.from(file.originalname, "latin1").toString("utf8").replace(/[\\/\0]/g, "_").slice(0, 200);
  const detected = await fileTypeFromBuffer(file.buffer);
  let mime = detected?.mime as string | undefined;
  if (!mime) {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const textMime = TEXT_EXT[ext];
    if (textMime && isProbablyText(file.buffer)) mime = textMime;
  }
  if (!mime || !allowed.includes(mime)) throw unprocessable(`Type de fichier non autorisé (${mime ?? "inconnu"})`);
  await scanForViruses(file.buffer);
  return { buffer: file.buffer, filename, mime, size: file.size, sha256: sha256(file.buffer) };
}

function isProbablyText(buf: Buffer) {
  const sample = buf.subarray(0, 4096);
  return !sample.includes(0);
}

/** Analyse ClamAV (clamd INSTREAM) si CLAMAV_HOST est configuré. */
export async function scanForViruses(buffer: Buffer): Promise<void> {
  if (!config.CLAMAV_HOST) return;
  const verdict = await new Promise<string>((resolve, reject) => {
    const socket = net.connect(config.CLAMAV_PORT, config.CLAMAV_HOST!);
    let response = "";
    socket.setTimeout(30_000, () => socket.destroy(new Error("ClamAV timeout")));
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < buffer.length; i += 64 * 1024) {
        const chunk = buffer.subarray(i, i + 64 * 1024);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (d) => (response += d.toString()));
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });
  if (!/OK\0?$/.test(verdict.trim())) throw unprocessable("Fichier refusé par l'antivirus");
}
