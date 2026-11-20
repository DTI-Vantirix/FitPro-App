import { Link } from 'react-router-dom';
import { ArrowUpRight, Footprints } from 'lucide-react';

export default function NextSession({ session, cta = { label: 'Start leg 1', to: '/run' } }) {
  if (!session) return null;

  return (
    <section className="panel relative overflow-hidden p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
      <header className="relative flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Next up
          </p>
          <h2 className="mt-2 font-heading text-xl font-bold leading-tight sm:text-2xl">{session.title}</h2>
        </div>
        <span className="num shrink-0 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground">
          {session.total}
        </span>
      </header>

      <ol className="relative mt-5">
        {session.steps.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-secondary">
                <step.icon className="h-4 w-4 text-primary" strokeWidth={1.9} />
              </span>
              {i < session.steps.length - 1 && <span className="my-1 w-px flex-1 bg-border" />}
            </div>
            <div className="pb-4">
              <p className="text-sm font-semibold leading-snug">{step.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.meta}</p>
            </div>
          </li>
        ))}
      </ol>

      <Link
        to={cta.to}
        className="relative flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 active:scale-[0.99]"
      >
        <Footprints className="h-4 w-4" strokeWidth={2.2} />
        {cta.label}
        <ArrowUpRight className="h-4 w-4" strokeWidth={2.2} />
      </Link>
    </section>
  );
}