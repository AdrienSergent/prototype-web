import clsx from "clsx";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link } from "react-router";

/* ------------------------------ Boutons ------------------------------ */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "wax";
const variants: Record<Variant, string> = {
  primary: "bg-pen text-white hover:bg-pen-dark border border-pen",
  secondary: "bg-surface text-ink border border-line-strong hover:border-ink-soft",
  ghost: "text-pen hover:bg-pen-tint border border-transparent",
  danger: "bg-surface text-bad border border-bad/40 hover:bg-bad-tint",
  wax: "bg-wax text-white border border-wax hover:brightness-110",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
});

export function ButtonLink({ to, variant = "secondary", size = "md", className, children }: { to: string; variant?: Variant; size?: "sm" | "md"; className?: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        variants[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={clsx("inline-block animate-spin rounded-full border-2 border-current border-r-transparent", className ?? "size-4")} />;
}

/* ------------------------------ Formulaires ------------------------------ */

const control =
  "w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-graphite/70 focus:border-pen focus:outline-none focus:ring-2 focus:ring-pen/20 disabled:bg-paper disabled:text-graphite";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(control, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={clsx(control, "py-2 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx(control, "h-9 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  required,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  required?: boolean;
}) {
  // Le libellé englobe le contrôle : association implicite même sans identifiant.
  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ink">
          {label}
          {required && <span className="text-bad"> *</span>}
        </span>
        {children}
      </label>
      {hint && !error && <p className="text-xs text-graphite">{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input id={id} type="checkbox" className="size-4 rounded border-line-strong accent-pen" {...rest} />
      {label}
    </label>
  );
}

/* ------------------------------ Mise en page ------------------------------ */

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-1 inline-block text-[13px] text-pen hover:underline">
            ‹ {back.label}
          </Link>
        )}
        <h1 className="text-[1.75rem] leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-graphite">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("mb-8", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            {title && <h2 className="text-lg text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-graphite">{description}</p>}
          </div>
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-lg border border-line bg-surface", className)}>{children}</div>;
}

type Tone = "neutral" | "pen" | "ok" | "warn" | "bad" | "wax";
const tones: Record<Tone, string> = {
  neutral: "bg-paper text-graphite border-line",
  pen: "bg-pen-tint text-pen-dark border-pen/20",
  ok: "bg-ok-tint text-ok border-ok/20",
  warn: "bg-warn-tint text-warn border-warn/25",
  bad: "bg-bad-tint text-bad border-bad/20",
  wax: "bg-wax-tint text-wax border-wax/25",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function Notice({ tone = "pen", title, children, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={clsx("mb-4 flex flex-wrap items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm", tones[tone])}>
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && "mt-0.5", "text-ink-soft")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <p className="font-serif text-lg text-ink">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-graphite">{children}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-graphite" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="rounded-md border border-bad/20 bg-bad-tint px-3 py-2 text-sm text-bad">
      {msg}
    </p>
  );
}

/* --------------------------------- Tableaux --------------------------------- */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-x-auto rounded-lg border border-line bg-surface", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export const th = "border-b border-line bg-paper px-3 py-2 text-left text-[13px] font-semibold text-ink-soft whitespace-nowrap";
export const td = "border-b border-line px-3 py-2 align-top";

/* --------------------------------- Modale --------------------------------- */

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={clsx("m-auto w-[calc(100%-2rem)] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/30", wide ? "max-w-3xl" : "max-w-lg")}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-lg">{title}</h2>
            <button type="button" onClick={onClose} className="rounded p-1 text-graphite hover:bg-paper" aria-label="Fermer">
              ✕
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/* --------------------------------- Onglets --------------------------------- */

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            value === t.key ? "border-pen text-ink" : "border-transparent text-graphite hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Progression ------------------------------ */

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-line", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx("h-full rounded-full", value >= 100 ? "bg-ok" : "bg-pen")} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function DefList({ items }: { items: { term: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(140px,max-content)_1fr]">
      {items.map((i, idx) => (
        <div key={idx} className="contents">
          <dt className="text-graphite">{i.term}</dt>
          <dd className="whitespace-pre-wrap text-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
