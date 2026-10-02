import { useRef } from "react";
import { Button, PageHeader } from "../../components/ui";
import { useFy } from "../../lib/session";

export function ConsolidatedPage() {
  const fy = useFy();
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <div>
      <PageHeader
        title="Vue consolidée"
        description="Le dossier tel qu'il sera remis : plan MESR, tableau du personnel, bibliographie numérotée, fiches de recherche et pièces annexées avec leur empreinte. L'export Word et PDF arrive en V1."
        actions={<Button onClick={() => frame.current?.contentWindow?.print()}>Imprimer ou enregistrer en PDF</Button>}
      />
      <iframe
        ref={frame}
        title="Dossier consolidé"
        src={`/api/v1/fiscal-years/${fy.id}/consolidated.html`}
        className="h-[calc(100dvh-220px)] min-h-[600px] w-full rounded-lg border border-line bg-white"
      />
    </div>
  );
}
