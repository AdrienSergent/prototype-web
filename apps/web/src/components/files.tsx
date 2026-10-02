import { formatBytes, formatDateTime, type FileDto, type FileKind } from "@cir/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { del, errorMessage, get, upload } from "../lib/api";
import { useToast } from "./toast";
import { Button, Spinner } from "./ui";

const ACCEPT: Partial<Record<FileKind, string>> = {
  person_cv: ".pdf,.docx",
  person_diploma: ".pdf,.docx,.png,.jpg,.jpeg",
  person_job_description: ".pdf,.docx,.png,.jpg,.jpeg",
  company_orgchart: ".pdf,.docx,.png,.jpg,.jpeg",
  company_rd_orgchart: ".pdf,.docx,.png,.jpg,.jpeg",
  note_attachment: ".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.zip,.csv,.txt,.md,.json,.ipynb",
};

/** Pièces d'un objet : dépôt (empreinte SHA-256 calculée côté serveur), versions, téléchargement. */
export function FileBox({ kind, ownerId, canWrite, label, latestOnly }: { kind: FileKind; ownerId: string; canWrite: boolean; label: string; latestOnly?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const key = ["files", kind, ownerId];
  const files = useQuery({ queryKey: key, queryFn: () => get<FileDto[]>(`/files?kind=${kind}&ownerId=${ownerId}`) });
  const add = useMutation({
    mutationFn: (file: File) => upload<FileDto>("/files", { kind, ownerId }, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["people"] });
      toast("Fichier déposé");
    },
    onError: (e) => toast(errorMessage(e), "bad"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/files/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast(errorMessage(e), "bad"),
  });
  const list = files.data ?? [];
  const shown = latestOnly ? list.slice(0, 1) : list;
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        {canWrite && (
          <>
            <input
              ref={input}
              type="file"
              className="sr-only"
              accept={ACCEPT[kind]}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) add.mutate(f);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="ghost" onClick={() => input.current?.click()} loading={add.isPending}>
              {list.length && kind !== "note_attachment" ? "Nouvelle version" : "Déposer un fichier"}
            </Button>
          </>
        )}
      </div>
      {files.isLoading ? (
        <Spinner className="mt-2 size-4" />
      ) : shown.length === 0 ? (
        <p className="mt-1 text-[13px] text-graphite">Aucun fichier.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {shown.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[13px]">
              <div className="min-w-0">
                <a href={`/api/v1/files/${f.id}/download`} className="font-medium text-pen hover:underline">
                  {f.filename}
                </a>
                <span className="ml-2 text-graphite">
                  v{f.version}, {formatBytes(f.size)}, {formatDateTime(f.createdAt)}
                </span>
                <div className="truncate text-[11px] text-graphite" title={f.sha256}>
                  SHA-256 {f.sha256.slice(0, 16)}…
                </div>
              </div>
              {canWrite && (
                <Button size="sm" variant="ghost" className="text-bad" onClick={() => remove.mutate(f.id)}>
                  Retirer
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
