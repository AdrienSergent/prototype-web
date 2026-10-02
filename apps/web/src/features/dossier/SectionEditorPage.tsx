import {
  MESR_PLAN,
  formatDate,
  formatDateTime,
  formatNumber,
  estimatePages,
  type CommentDto,
  type NoteDto,
  type PMNode,
  type ProjectDto,
  type ReferenceDto,
  type SectionDto,
  type SectionVersionDto,
} from "@cir/shared";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useToast } from "../../components/toast";
import { Badge, Button, ErrorText, Input, Loading, Modal, Notice, Tabs, Textarea } from "../../components/ui";
import { ApiError, del, errorMessage, get, patch, post, put } from "../../lib/api";
import { useFy, usePermissions } from "../../lib/session";
import { SectionStatus } from "./DossierPage";

const AUTOSAVE_MS = 30_000;

function ToolbarButton({ onClick, active, label, children }: { onClick: () => void; active?: boolean; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx("h-8 min-w-8 rounded px-2 text-sm", active ? "bg-pen-tint text-pen-dark" : "text-ink-soft hover:bg-paper")}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, onCiteRef, onCiteNote }: { editor: Editor; onCiteRef: () => void; onCiteNote?: () => void }) {
  return (
    <div className="sticky top-[52px] z-10 flex flex-wrap items-center gap-0.5 border-b border-line bg-surface px-2 py-1">
      <ToolbarButton label="Gras" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong>G</strong>
      </ToolbarButton>
      <ToolbarButton label="Italique" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton label="Intertitre" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        Intertitre
      </ToolbarButton>
      <ToolbarButton label="Liste à puces" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        Liste
      </ToolbarButton>
      <ToolbarButton label="Liste numérotée" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1. 2. 3.
      </ToolbarButton>
      <ToolbarButton label="Citation" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        Citation
      </ToolbarButton>
      <ToolbarButton label="Tableau" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        Tableau
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-line" />
      <ToolbarButton label="Citer une référence bibliographique" onClick={onCiteRef}>
        Citer une référence
      </ToolbarButton>
      {onCiteNote && (
        <ToolbarButton label="Renvoyer à une fiche de recherche" onClick={onCiteNote}>
          Renvoyer à une fiche
        </ToolbarButton>
      )}
      <span className="mx-1 h-5 w-px bg-line" />
      <ToolbarButton label="Annuler" onClick={() => editor.chain().focus().undo().run()}>
        Annuler
      </ToolbarButton>
      <ToolbarButton label="Rétablir" onClick={() => editor.chain().focus().redo().run()}>
        Rétablir
      </ToolbarButton>
    </div>
  );
}

function refLabel(r: ReferenceDto) {
  const author = r.authors.split(/[,;]/)[0]?.trim() || r.title.slice(0, 20);
  return `${author} ${r.publishedOn.slice(0, 4)}`;
}

function CommentsPanel({ section, editor }: { section: SectionDto; editor: Editor | null }) {
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["comments", section.id], queryFn: () => get<CommentDto[]>(`/sections/${section.id}/comments`) });
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const roots = (q.data ?? []).filter((c) => !c.parentId);
  const replies = (id: string) => (q.data ?? []).filter((c) => c.parentId === id);
  const send = async () => {
    const sel = editor ? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ").slice(0, 300) : "";
    try {
      await post(`/sections/${section.id}/comments`, { body, anchorText: replyTo ? null : sel || null, parentId: replyTo });
      setBody("");
      setReplyTo(null);
      await qc.invalidateQueries({ queryKey: ["comments", section.id] });
      await qc.invalidateQueries({ queryKey: ["section", section.id] });
    } catch (e) {
      toast(errorMessage(e), "bad");
    }
  };
  return (
    <div className="grid gap-3">
      {roots.length === 0 && <p className="text-sm text-graphite">Aucun commentaire.</p>}
      {roots.map((c) => (
        <div key={c.id} className={clsx("rounded-md border p-3 text-sm", c.resolved ? "border-line bg-paper text-graphite" : "border-warn/30 bg-surface")}>
          {c.anchorText && <p className="mb-1 border-l-2 border-warn pl-2 font-serif italic text-ink-soft">« {c.anchorText} »</p>}
          <p className="whitespace-pre-wrap">{c.body}</p>
          <p className="mt-1 text-xs text-graphite">
            {c.authorName}, {formatDateTime(c.createdAt)}
          </p>
          {replies(c.id).map((r) => (
            <div key={r.id} className="mt-2 border-l border-line pl-3">
              <p className="whitespace-pre-wrap">{r.body}</p>
              <p className="text-xs text-graphite">
                {r.authorName}, {formatDateTime(r.createdAt)}
              </p>
            </div>
          ))}
          {perms.comment && (
            <div className="mt-2 flex gap-2">
              <button className="text-xs text-pen hover:underline" onClick={() => setReplyTo(c.id)}>
                Répondre
              </button>
              <button
                className="text-xs text-pen hover:underline"
                onClick={async () => {
                  await patch(`/comments/${c.id}`, { resolved: !c.resolved });
                  await qc.invalidateQueries({ queryKey: ["comments", section.id] });
                  await qc.invalidateQueries({ queryKey: ["section", section.id] });
                }}
              >
                {c.resolved ? "Rouvrir" : "Marquer comme résolu"}
              </button>
            </div>
          )}
        </div>
      ))}
      {perms.comment && (
        <div className="grid gap-2 border-t border-line pt-3">
          {replyTo ? (
            <p className="text-xs text-graphite">
              Réponse au fil.{" "}
              <button className="text-pen hover:underline" onClick={() => setReplyTo(null)}>
                Annuler
              </button>
            </p>
          ) : (
            <p className="text-xs text-graphite">Sélectionnez un passage du texte pour y ancrer le commentaire.</p>
          )}
          <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Commentaire" />
          <div>
            <Button size="sm" disabled={!body.trim()} onClick={send}>
              Commenter
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ section, onRestore }: { section: SectionDto; onRestore: (v: number) => void }) {
  const perms = usePermissions();
  const q = useQuery({ queryKey: ["section-versions", section.id, section.version], queryFn: () => get<SectionVersionDto[]>(`/sections/${section.id}/versions`) });
  const [open, setOpen] = useState<number | null>(null);
  if (q.isLoading) return <Loading />;
  return (
    <ul className="grid gap-2">
      {(q.data ?? []).length === 0 && <p className="text-sm text-graphite">Aucune version enregistrée.</p>}
      {(q.data ?? []).map((v) => (
        <li key={v.version} className="rounded-md border border-line bg-surface p-2.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <button className="text-left" onClick={() => setOpen(open === v.version ? null : v.version)}>
              <span className="font-semibold">Version {v.version}</span>
              <span className="block text-xs text-graphite">
                {formatDateTime(v.createdAt)}, {v.authorName ?? "?"}
              </span>
            </button>
            {perms.writeSections && v.version !== section.version && (
              <Button size="sm" variant="ghost" onClick={() => onRestore(v.version)}>
                Restaurer
              </Button>
            )}
          </div>
          {open === v.version && <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-line pt-2 font-serif text-[13px] text-ink-soft">{v.contentText || "(vide)"}</p>}
        </li>
      ))}
    </ul>
  );
}

export default function SectionEditorPage() {
  const { id = "" } = useParams();
  const fy = useFy();
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["section", id], queryFn: () => get<SectionDto>(`/sections/${id}`) });
  const section = q.data;
  const project = useQuery({ queryKey: ["project", section?.projectId], queryFn: () => get<ProjectDto>(`/projects/${section!.projectId}`), enabled: !!section?.projectId });
  const refs = useQuery({ queryKey: ["references", fy.id], queryFn: () => get<ReferenceDto[]>(`/references?fiscalYearId=${fy.id}`) });
  const notes = useQuery({ queryKey: ["notes", "project", section?.projectId], queryFn: () => get<NoteDto[]>(`/notes?projectId=${section!.projectId}`), enabled: !!section?.projectId });
  const [panel, setPanel] = useState<"attendus" | "commentaires" | "historique">("attendus");
  const [cite, setCite] = useState<"ref" | "note" | null>(null);
  const [filter, setFilter] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chars, setChars] = useState(0);
  const versionRef = useRef(0);
  const loadedRef = useRef<string | null>(null);

  const frascatiBlocked = !!section?.projectId && project.data && !project.data.frascatiComplete;
  const readOnly = !perms.writeSections || !!frascatiBlocked;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ["cir"],
          isAllowedUri: (url, ctx) => url.startsWith("cir://") || ctx.defaultValidate(url),
        },
      }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: "Rédigez cette rubrique. Citez vos références et renvoyez aux fiches de recherche." }),
    ],
    editable: false,
    editorProps: { attributes: { class: "prose-dossier px-6 py-5", "aria-label": "Contenu de la rubrique" } },
    onUpdate: ({ editor: ed }) => {
      setDirty(true);
      setChars(ed.getText().length);
    },
  });

  useEffect(() => {
    if (!editor || !section) return;
    editor.setEditable(!readOnly);
    if (loadedRef.current === `${section.id}:${section.version}`) return;
    if (loadedRef.current?.startsWith(section.id) && dirty) return;
    editor.commands.setContent(section.content as object, { emitUpdate: false });
    versionRef.current = section.version;
    loadedRef.current = `${section.id}:${section.version}`;
    setChars(section.contentText.length);
    setDirty(false);
  }, [editor, section, readOnly, dirty]);

  const save = useCallback(
    async (checkpoint: boolean) => {
      if (!editor || readOnly || saving) return;
      setSaving(true);
      setError(null);
      try {
        const s = await put<SectionDto>(`/sections/${id}`, { content: editor.getJSON(), baseVersion: versionRef.current, checkpoint });
        versionRef.current = s.version;
        loadedRef.current = `${s.id}:${s.version}`;
        qc.setQueryData(["section", id], s);
        await qc.invalidateQueries({ queryKey: ["dossier", fy.id] });
        setDirty(false);
        setLastSaved(new Date());
      } catch (e) {
        if (e instanceof ApiError && e.code === "version_conflict") setConflict(true);
        setError(errorMessage(e));
      } finally {
        setSaving(false);
      }
    },
    [editor, readOnly, saving, id, qc, fy.id],
  );

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => save(false), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save(true);
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [save, dirty]);

  if (q.isLoading || !section) return <Loading />;
  if (q.error) return <ErrorText error={q.error} />;
  const info = MESR_PLAN[section.rubrique];

  const action = async (fn: () => Promise<SectionDto>, msg: string) => {
    try {
      const s = await fn();
      qc.setQueryData(["section", id], s);
      await qc.invalidateQueries({ queryKey: ["dossier", fy.id] });
      toast(msg);
    } catch (e) {
      toast(errorMessage(e), "bad");
    }
  };

  const insertCitation = (href: string, label: string) => {
    editor?.chain().focus().insertContent([{ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }, { type: "text", text: " " }]).run();
    setCite(null);
    setFilter("");
  };

  const datedWarning = info.dateeDebutTravaux && project.data;
  const lateRefs = datedWarning ? (refs.data ?? []).filter((r) => r.citedIn.some((c) => c.sectionId === section.id) && r.publishedOn > project.data!.startDate) : [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <Link to="/dossier" className="text-[13px] text-pen hover:underline">
            ‹ Rédaction du dossier
          </Link>
          <h1 className="mt-1 text-[1.6rem] leading-tight">
            <span className="text-graphite">{info.numero}.</span> {info.label}
          </h1>
          <p className="mt-1 text-sm text-graphite">
            {project.data ? `Projet ${project.data.code}, ${project.data.title}` : "Partie 1 : la société"}. Version {section.version}
            {section.authorName && `, modifiée par ${section.authorName}`}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SectionStatus s={section} />
          {!readOnly && (
            <Button variant="primary" onClick={() => save(true)} loading={saving}>
              Enregistrer
            </Button>
          )}
          {perms.validateSections &&
            (section.validatedAt ? (
              <Button onClick={() => action(() => del<SectionDto>(`/sections/${id}/validate`), "Validation retirée")}>Retirer la validation</Button>
            ) : (
              <Button disabled={dirty || !section.contentText.trim() || section.toUpdate} onClick={() => action(() => post<SectionDto>(`/sections/${id}/validate`), "Rubrique validée")}>
                Valider la rubrique
              </Button>
            ))}
        </div>
      </div>

      {frascatiBlocked && (
        <Notice tone="warn" title="Rédaction bloquée" action={<Link to={`/projets/${section.projectId}?onglet=frascati`} className="text-sm font-semibold text-pen underline">Qualifier le projet</Link>}>
          Les 5 critères de Frascati doivent être argumentés avant de rédiger.
        </Notice>
      )}
      {section.toUpdate && (
        <Notice
          tone="warn"
          title="Rubrique reprise de l'exercice précédent"
          action={perms.writeSections && <Button size="sm" onClick={() => action(() => post<SectionDto>(`/sections/${id}/confirm`), "Rubrique confirmée")}>Confirmer sans modification</Button>}
        >
          Actualisez-la, ou confirmez qu'elle reste exacte pour cet exercice.
        </Notice>
      )}
      {conflict && (
        <Notice tone="bad" title="Rubrique modifiée entre-temps" action={<Button size="sm" onClick={() => location.reload()}>Recharger</Button>}>
          Quelqu'un a enregistré une autre version. Copiez votre texte avant de recharger.
        </Notice>
      )}
      {section.validatedAt && <p className="mb-3 text-sm text-ok">Validée par {section.validatedByName} le {formatDateTime(section.validatedAt)}. Toute modification retire la validation.</p>}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 rounded-lg border border-line bg-surface">
          {editor && !readOnly && <Toolbar editor={editor} onCiteRef={() => setCite("ref")} onCiteNote={section.projectId ? () => setCite("note") : undefined} />}
          <EditorContent editor={editor} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-graphite">
            <span>
              {formatNumber(chars)} caractères, environ {formatNumber(estimatePages(chars), 1)} page{estimatePages(chars) > 1 ? "s" : ""}
              {info.limitePages && ` (limite ${info.groupeLimite ? "partagée " : ""}${info.limitePages} p.)`}
            </span>
            <span>{saving ? "Enregistrement…" : dirty ? "Modifications non enregistrées (enregistrement automatique sous 30 s)" : lastSaved ? `Enregistré à ${lastSaved.toLocaleTimeString("fr-FR")}` : ""}</span>
          </div>
          {error && !conflict && (
            <div className="px-4 pb-3">
              <ErrorText error={error} />
            </div>
          )}
        </div>

        <aside className="min-w-0">
          <Tabs
            value={panel}
            onChange={setPanel}
            tabs={[
              { key: "attendus", label: "Attendus" },
              { key: "commentaires", label: `Commentaires${section.openCommentCount ? ` (${section.openCommentCount})` : ""}` },
              { key: "historique", label: "Historique" },
            ]}
          />
          {panel === "attendus" && (
            <div className="grid gap-3 text-sm">
              <p className="font-serif text-[15px] leading-relaxed text-ink">{info.attendu}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-graphite">Portée</dt>
                <dd>{info.portee === "commune" ? "Partie commune à l'opération" : "Enrichie chaque année"}</dd>
                <dt className="text-graphite">Alimentée par</dt>
                <dd>{info.alimentation}</dd>
                {info.limitePages && (
                  <>
                    <dt className="text-graphite">Limite</dt>
                    <dd>
                      {info.limitePages} page{info.limitePages > 1 ? "s" : ""}
                      {info.groupeLimite === "bcd" && " pour état de l'art, verrous et démarche"}
                      {info.groupeLimite === "ef" && " pour travaux et contribution"}
                    </dd>
                  </>
                )}
              </dl>
              {info.dateeDebutTravaux && project.data && (
                <Notice tone="pen">Datée au début des travaux ({formatDate(project.data.startDate)}) : n'y citez que des références antérieures à cette date.</Notice>
              )}
              {lateRefs.map((r) => (
                <Notice key={r.id} tone="warn">
                  « {r.title} » est publiée le {formatDate(r.publishedOn)}, après le début des travaux.
                </Notice>
              ))}
            </div>
          )}
          {panel === "commentaires" && <CommentsPanel section={section} editor={editor} />}
          {panel === "historique" && <HistoryPanel section={section} onRestore={(v) => action(() => post<SectionDto>(`/sections/${id}/restore`, { version: v }), `Version ${v} restaurée`).then(() => (loadedRef.current = null))} />}
        </aside>
      </div>

      <Modal open={cite === "ref"} onClose={() => setCite(null)} title="Citer une référence" wide>
        <Input placeholder="Filtrer par titre ou auteur" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-3" />
        {(refs.data ?? []).length === 0 && (
          <p className="text-sm text-graphite">
            Aucune référence. <Link to="/dossier/bibliographie" className="text-pen underline">Ajoutez-en dans la bibliographie.</Link>
          </p>
        )}
        <ul className="divide-y divide-line">
          {(refs.data ?? [])
            .filter((r) => `${r.title} ${r.authors}`.toLowerCase().includes(filter.toLowerCase()))
            .map((r) => (
              <li key={r.id}>
                <button className="w-full px-1 py-2 text-left text-sm hover:bg-paper" onClick={() => insertCitation(`cir://ref/${r.id}`, refLabel(r))}>
                  <span className="font-medium">{r.title}</span>
                  <span className="block text-xs text-graphite">
                    {r.authors}, {formatDate(r.publishedOn)}
                    {project.data && r.publishedOn > project.data.startDate && <Badge tone="warn" className="ml-2">Postérieure au début des travaux</Badge>}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </Modal>
      <Modal open={cite === "note"} onClose={() => setCite(null)} title="Renvoyer à une fiche de recherche" wide>
        <ul className="divide-y divide-line">
          {(notes.data ?? []).map((n) => (
            <li key={n.id}>
              <button className="w-full px-1 py-2 text-left text-sm hover:bg-paper" onClick={() => insertCitation(`cir://note/${n.id}`, n.ref)}>
                <span className="font-medium">
                  {n.ref}, {formatDate(n.noteDate)}, {n.topicCode}
                </span>
                <span className="block truncate text-xs text-graphite">{n.hypothesis}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

export type { PMNode };
