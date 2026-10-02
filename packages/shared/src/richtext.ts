/**
 * Utilitaires sur le contenu riche des sections (JSON ProseMirror / TipTap).
 * Les renvois sont des liens au schéma `cir://` :
 *   cir://ref/<uuid>   → référence bibliographique
 *   cir://note/<uuid>  → fiche de recherche
 */

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
}

export const EMPTY_DOC: PMNode = { type: "doc", content: [] };

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CITE_RE = /^cir:\/\/(ref|note)\/([0-9a-f-]{36})$/i;

export function parseCitation(href: string): { kind: "ref" | "note"; id: string } | null {
  const m = CITE_RE.exec(href);
  if (!m) return null;
  return { kind: m[1]!.toLowerCase() as "ref" | "note", id: m[2]!.toLowerCase() };
}

function walk(node: PMNode | undefined, fn: (n: PMNode) => void) {
  if (!node) return;
  fn(node);
  node.content?.forEach((c) => walk(c, fn));
}

/** Texte brut (pour le comptage de pages et la complétude). */
export function toPlainText(doc: PMNode | null | undefined): string {
  if (!doc) return "";
  const parts: string[] = [];
  const blockTypes = new Set(["paragraph", "heading", "listItem", "tableCell", "tableHeader", "blockquote", "codeBlock"]);
  const visit = (n: PMNode) => {
    if (n.type === "text" && n.text) parts.push(n.text);
    if (n.type === "hardBreak") parts.push("\n");
    n.content?.forEach(visit);
    if (blockTypes.has(n.type)) parts.push("\n");
  };
  visit(doc);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/** Identifiants des références et fiches citées. */
export function extractCitations(doc: PMNode | null | undefined): { refIds: string[]; noteIds: string[] } {
  const refIds = new Set<string>();
  const noteIds = new Set<string>();
  walk(doc ?? undefined, (n) => {
    n.marks?.forEach((m) => {
      if (m.type === "link" && typeof m.attrs?.href === "string") {
        const c = parseCitation(m.attrs.href);
        if (c?.kind === "ref") refIds.add(c.id);
        if (c?.kind === "note") noteIds.add(c.id);
      }
    });
  });
  return { refIds: [...refIds], noteIds: [...noteIds] };
}

export interface CitationLabels {
  ref: (id: string) => string | undefined;
  note: (id: string) => string | undefined;
}

function renderMarks(text: string, marks: PMMark[] | undefined, labels?: CitationLabels): string {
  let html = escapeHtml(text);
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
        html = `<strong>${html}</strong>`;
        break;
      case "italic":
        html = `<em>${html}</em>`;
        break;
      case "strike":
        html = `<s>${html}</s>`;
        break;
      case "code":
        html = `<code>${html}</code>`;
        break;
      case "underline":
        html = `<u>${html}</u>`;
        break;
      case "link": {
        const href = String(mark.attrs?.href ?? "");
        const cite = parseCitation(href);
        if (cite) {
          const label = cite.kind === "ref" ? labels?.ref(cite.id) : labels?.note(cite.id);
          html = `<span class="cite cite-${cite.kind}">${html}${label ? ` <sup>[${escapeHtml(label)}]</sup>` : ""}</span>`;
        } else if (/^https?:\/\//i.test(href)) {
          html = `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${html}</a>`;
        }
        break;
      }
    }
  }
  return html;
}

/** Rendu HTML sûr (échappé) d'un document ProseMirror, sans dépendance au DOM. */
export function toHtml(node: PMNode | null | undefined, labels?: CitationLabels): string {
  if (!node) return "";
  const children = () => (node.content ?? []).map((c) => toHtml(c, labels)).join("");
  switch (node.type) {
    case "doc":
      return children();
    case "paragraph":
      return `<p>${children()}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(3, Number(node.attrs?.level ?? 3) + 2));
      return `<h${level}>${children()}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${children()}</ul>`;
    case "orderedList":
      return `<ol>${children()}</ol>`;
    case "listItem":
      return `<li>${children()}</li>`;
    case "blockquote":
      return `<blockquote>${children()}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${(node.content ?? []).map((c) => escapeHtml(c.text ?? "")).join("")}</code></pre>`;
    case "horizontalRule":
      return "<hr />";
    case "hardBreak":
      return "<br />";
    case "table":
      return `<table>${children()}</table>`;
    case "tableRow":
      return `<tr>${children()}</tr>`;
    case "tableHeader":
      return `<th>${children()}</th>`;
    case "tableCell":
      return `<td>${children()}</td>`;
    case "text":
      return renderMarks(node.text ?? "", node.marks, labels);
    default:
      return children();
  }
}

/** Document ProseMirror minimal à partir de texte brut (paragraphes séparés par une ligne vide). */
export function docFromText(text: string): PMNode {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
  };
}
