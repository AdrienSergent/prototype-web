import { formatDate, formatHours, LOCK_OUTCOME_LABELS, NOTE_RESULT_LABELS, type NoteResultKind, type TimelineDto } from "@cir/shared";
import { scaleLinear, scaleUtc } from "d3-scale";
import { useNavigate } from "react-router";

const RESULT_COLORS: Record<NoteResultKind, string> = {
  succes: "var(--color-ok)",
  echec_partiel: "var(--color-warn)",
  echec: "var(--color-bad)",
  non_concluant: "var(--color-graphite)",
};

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Frise F5.6 : fiches par sujet, heures par semaine et changements d'issue du verrou sur l'exercice. */
export function Timeline({ data }: { data: TimelineDto }) {
  const navigate = useNavigate();
  const W = 900;
  const left = 150;
  const right = 20;
  const top = 40;
  const rowH = 34;
  const rows = Math.max(1, data.topics.length);
  const barsTop = top + rows * rowH + 16;
  const barsH = 70;
  const H = barsTop + barsH + 30;
  const x = scaleUtc().domain([d(data.start), d(data.end)]).range([left, W - right]);
  const maxH = Math.max(1, ...data.weeklyHours.map((w) => w.hours));
  const y = scaleLinear().domain([0, maxH]).range([0, barsH]);
  const months: Date[] = [];
  const start = d(data.start);
  for (let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); m <= d(data.end); m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    if (m >= start) months.push(m);
  }
  const weekW = Math.max(2, x(d("2026-01-08")) - x(d("2026-01-01")) - 2);

  return (
    <figure className="overflow-x-auto rounded-lg border border-line bg-surface p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[720px]" role="img" aria-label={`Frise du verrou ${data.lock.code}`}>
        {months.map((m) => (
          <g key={m.toISOString()}>
            <line x1={x(m)} x2={x(m)} y1={top - 8} y2={H - 26} stroke="var(--color-line)" />
            <text x={x(m) + 3} y={top - 14} fontSize={11} fill="var(--color-graphite)">
              {MONTHS[m.getUTCMonth()]}
            </text>
          </g>
        ))}
        {data.outcomeChanges.map((o, i) => (
          <g key={i}>
            <line x1={x(d(o.date))} x2={x(d(o.date))} y1={top - 6} y2={barsTop - 6} stroke="var(--color-ink)" strokeDasharray="3 3" />
            <text x={x(d(o.date)) + 4} y={top - 28} fontSize={11} fill="var(--color-ink)" fontWeight={600}>
              {LOCK_OUTCOME_LABELS[o.outcome]}
            </text>
          </g>
        ))}
        {data.topics.map((t, i) => {
          const cy = top + i * rowH + rowH / 2;
          return (
            <g key={t.id}>
              <line x1={left} x2={W - right} y1={cy} y2={cy} stroke="var(--color-line)" />
              <text x={8} y={cy + 4} fontSize={12} fontWeight={600} fill="var(--color-ink)">
                {t.code}
              </text>
              <text x={44} y={cy + 4} fontSize={11} fill="var(--color-graphite)">
                {t.title.length > 16 ? `${t.title.slice(0, 15)}…` : t.title}
              </text>
              {data.notes
                .filter((n) => n.topicId === t.id)
                .map((n) => (
                  <circle
                    key={n.id}
                    cx={x(d(n.date))}
                    cy={cy}
                    r={6}
                    fill={RESULT_COLORS[n.resultKind]}
                    stroke="#fff"
                    strokeWidth={1.5}
                    className="cursor-pointer"
                    onClick={() => navigate(`/fiches/${n.id}`)}
                  >
                    <title>{`${n.ref}, ${formatDate(n.date)}, ${n.authorName} : ${NOTE_RESULT_LABELS[n.resultKind]}, ${formatHours(n.hours)}`}</title>
                  </circle>
                ))}
            </g>
          );
        })}
        <text x={8} y={barsTop + barsH / 2 + 4} fontSize={11} fill="var(--color-graphite)">
          Heures / semaine
        </text>
        <line x1={left} x2={W - right} y1={barsTop + barsH} y2={barsTop + barsH} stroke="var(--color-line-strong)" />
        {data.weeklyHours.map((w) => (
          <rect key={w.week} x={x(d(w.week))} y={barsTop + barsH - y(w.hours)} width={weekW} height={y(w.hours)} fill="var(--color-pen)" opacity={0.75}>
            <title>{`Semaine du ${formatDate(w.week)} : ${formatHours(w.hours)}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-graphite">
        {(Object.keys(RESULT_COLORS) as NoteResultKind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: RESULT_COLORS[k] }} />
            {NOTE_RESULT_LABELS[k]}
          </span>
        ))}
        <span>Pointillés : changement d'issue du verrou</span>
      </figcaption>
    </figure>
  );
}
