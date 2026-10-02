import type { ChecklistItemDto } from "@cir/shared";

/** Lien vers l'objet à corriger pour une ligne de check-list. */
export function targetLink(t: ChecklistItemDto["target"]): string {
  switch (t.type) {
    case "project":
      return `/projets/${t.id}`;
    case "frascati":
      return `/projets/${t.id}?onglet=frascati`;
    case "lock":
      return `/verrous/${t.id}`;
    case "person":
      return `/equipe/${t.id}`;
    case "section":
      return `/dossier/sections/${t.id}`;
    case "reference":
      return "/dossier/bibliographie";
    case "note":
      return `/fiches/${t.id}`;
    default:
      return "/projets";
  }
}
