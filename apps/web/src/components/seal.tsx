import { FISCAL_YEAR_STATUS_LABELS, type FiscalYearStatus } from "@cir/shared";
import clsx from "clsx";

/**
 * Cachet de statut de l'exercice : l'élément signature de l'interface.
 * Brouillon = tracé pointillé, en relecture = encre, validé = vert, scellé = cire rouge.
 */
export function Seal({ status, size = 44, hash }: { status: FiscalYearStatus; size?: number; hash?: string | null }) {
  const label = FISCAL_YEAR_STATUS_LABELS[status];
  const sealed = status === "sealed";
  const color = sealed ? "var(--color-wax)" : status === "expert_validated" ? "var(--color-ok)" : "var(--color-ink)";
  const r = size / 2;
  return (
    <span className="inline-flex items-center gap-2" title={hash ? `${label} : ${hash}` : label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Statut : ${label}`}>
        {sealed ? (
          <>
            <path
              d={wavy(r, r, r - 1, 14)}
              fill="var(--color-wax)"
            />
            <circle cx={r} cy={r} r={r * 0.62} fill="none" stroke="#f6e7e9" strokeWidth={1.2} strokeDasharray="2 2" />
            <text x={r} y={r + size * 0.09} textAnchor="middle" fontFamily="var(--font-serif)" fontWeight={700} fontSize={size * 0.26} fill="#f6e7e9">
              CIR
            </text>
          </>
        ) : (
          <>
            <circle cx={r} cy={r} r={r - 2} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray={status === "draft" ? "3 3" : undefined} />
            <circle cx={r} cy={r} r={r * 0.62} fill="none" stroke={color} strokeWidth={1} opacity={0.5} />
            <text x={r} y={r + size * 0.09} textAnchor="middle" fontFamily="var(--font-serif)" fontWeight={700} fontSize={size * 0.26} fill={color}>
              CIR
            </text>
          </>
        )}
      </svg>
      <span className={clsx("text-sm font-semibold", sealed ? "text-wax" : status === "expert_validated" ? "text-ok" : "text-ink")}>{label}</span>
    </span>
  );
}

/** Contour festonné du cachet de cire. */
function wavy(cx: number, cy: number, radius: number, lobes: number) {
  const pts: string[] = [];
  const steps = lobes * 8;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = radius - (1 + Math.cos(a * lobes)) * radius * 0.035;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}
