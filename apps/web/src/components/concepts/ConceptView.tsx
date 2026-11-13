'use client';

// Konzeptansicht `/bibliothek?konzept=<id>` (VERTRAEGE §20.10, F-BIB-02, 07 §3.6; ohne Notiz-Editor und ohne
// Beherrschung): Kopf, Belege als Kacheln, Beziehungen nach Art und Richtung. Hüllen leiten auf `merged_into` weiter.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { EvidenceView } from '@sg/shared';
import { ApiRequestError, friendlyMessage } from '../../lib/api.ts';
import {
  KIND_LABELS,
  conceptHref,
  evidenceHref,
  groupRelations,
  sessionRefLabel,
  useConceptDetail,
} from '../../lib/concepts.ts';
import { pageThumbUrl } from '../../lib/material.ts';
import { moduleHref } from '../../lib/nav.ts';
import { formatMmSs } from '../../lib/search.ts';
import { ConceptCards } from '../learn/ConceptCards.tsx';
import { EmptyState } from '../Placeholder.tsx';

const action =
  'inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface';
const mark = 'rounded-sm border border-border px-1.5 py-0.5 text-xs text-text-muted';
const tile =
  'relative flex h-full min-w-0 flex-col gap-2 rounded-lg border border-border p-3 hover:bg-surface sg-transition';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="screen-title">
      <p className="text-sm text-text-muted">
        <Link href="/bibliothek" className="hover:text-text hover:underline">
          Bibliothek
        </Link>
      </p>
      {children}
    </section>
  );
}

function EvidenceTile({ evidence }: { evidence: EvidenceView }) {
  const { ref } = evidence;
  const session = evidence.session ? sessionRefLabel(evidence.session) : null;
  if (evidence.missing) {
    return (
      <div className={`${tile} hover:bg-transparent`} data-evidence={evidence.id} data-missing="true">
        <p className="text-sm text-text-muted">
          {ref.kind === 'slide' ? `Folie ${ref.slide_index}` : `Aufnahme ab ${formatMmSs(ref.t_start_ms)}`} ·
          nicht mehr vorhanden
        </p>
        {session ? <p className="text-xs text-text-muted">{session}</p> : null}
      </div>
    );
  }
  if (ref.kind === 'slide') {
    return (
      <Link href={evidenceHref(ref)} className={tile} data-evidence={evidence.id}>
        <img
          src={pageThumbUrl('folien', ref.deck_id, ref.slide_id, ref.slide_index)}
          alt=""
          loading="lazy"
          className="aspect-video w-full rounded-md border border-border bg-surface-raised object-contain"
        />
        <p className="break-words text-sm">
          <span className="font-medium">Folie {ref.slide_index}</span>
          {evidence.slide_title ? ` · ${evidence.slide_title}` : null}
        </p>
        {session ? <p className="text-xs text-text-muted">{session}</p> : null}
      </Link>
    );
  }
  return (
    <Link href={evidenceHref(ref)} className={tile} data-evidence={evidence.id}>
      <p className="text-sm font-medium tabular-nums">
        <span aria-hidden="true" className="mr-1">
          ▶
        </span>
        <span className="sr-only">Aufnahme ab </span>
        {formatMmSs(ref.t_start_ms)}
      </p>
      {evidence.quote ? <p className="break-words text-sm text-text-muted">„{evidence.quote}“</p> : null}
      {session ? <p className="mt-auto text-xs text-text-muted">{session}</p> : null}
    </Link>
  );
}

export function ConceptView({ id }: { id: string }) {
  const router = useRouter();
  const detail = useConceptDetail(id);
  const data = detail.data;
  const mergedInto = data?.concept.status === 'zusammengefuehrt' ? data.concept.merged_into : null;
  useEffect(() => {
    if (mergedInto) router.replace(conceptHref(mergedInto));
  }, [mergedInto, router]);

  if (!data) {
    if (detail.isError) {
      const gone =
        detail.error instanceof ApiRequestError &&
        detail.error.kind === 'api' &&
        (detail.error.status === 404 || detail.error.status === 400);
      return (
        <Shell>
          <h1 id="screen-title" className="mt-1 text-xxl font-semibold">
            Konzept
          </h1>
          <div className="mt-6">
            <EmptyState
              action={
                <Link href="/bibliothek" className={action}>
                  Zur Bibliothek
                </Link>
              }
            >
              {gone
                ? 'Dieses Konzept gibt es nicht (mehr).'
                : `Das Konzept ist gerade nicht erreichbar: ${friendlyMessage(detail.error)}`}
            </EmptyState>
          </div>
        </Shell>
      );
    }
    return (
      <Shell>
        <h1 id="screen-title" className="mt-1 text-xxl font-semibold">
          Konzept
        </h1>
        <p role="status" aria-busy="true" className="mt-4 text-md text-text-muted">
          Lädt …
        </p>
      </Shell>
    );
  }

  const { concept } = data;
  if (mergedInto) {
    return (
      <Shell>
        <h1 id="screen-title" className="mt-1 text-xxl font-semibold">
          {concept.name}
        </h1>
        <p role="status" className="mt-4 text-md text-text-muted">
          Wurde zusammengeführt.{' '}
          <Link href={conceptHref(mergedInto)} className="underline underline-offset-2">
            Zum Konzept
          </Link>
        </p>
      </Shell>
    );
  }

  const groups = groupRelations(data.relations);
  return (
    <Shell>
      <header className="relative mt-1">
        <h1 id="screen-title" tabIndex={-1} className="break-words text-xxl font-semibold focus:outline-none">
          {concept.name}
        </h1>
        {concept.aliases.length > 0 ? (
          <p className="mt-1 break-words text-sm text-text-muted">
            <span className="sr-only">Aliase: </span>
            <span aria-hidden="true">auch: </span>
            {concept.aliases.join(' · ')}
          </p>
        ) : null}
        <ul aria-label="Einordnung" className="mt-3 flex flex-wrap items-center gap-2">
          {concept.status === 'vorschlag' ? (
            <li>
              <Link href="/inbox" className={`${mark} border-dashed hover:text-text`}>
                Vorschlag · in der Inbox
              </Link>
            </li>
          ) : null}
          {data.modules.map((module) => (
            <li key={module.id}>
              <Link href={moduleHref(module.id)} className={`${mark} hover:text-text`}>
                {module.name}
              </Link>
            </li>
          ))}
          {data.modules.length === 0 ? <li className={mark}>Ohne Fach</li> : null}
          {concept.kind ? <li className={mark}>{KIND_LABELS[concept.kind]}</li> : null}
          {concept.exam_relevant ? <li className={mark}>Klausurrelevant</li> : null}
        </ul>
        {concept.one_liner ? <p className="mt-4 max-w-3xl break-words text-md">{concept.one_liner}</p> : null}
      </header>

      <section aria-labelledby="concept-evidence" className="mt-8">
        <h2 id="concept-evidence" className="text-lg font-medium">
          Belege
        </h2>
        {data.evidence.length === 0 ? (
          <p className="mt-2 text-md text-text-muted">Keine Belege mehr.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.evidence.map((evidence) => (
              <li key={evidence.id} className="min-w-0">
                <EvidenceTile evidence={evidence} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Karten des Konzepts (VERTRAEGE §21.10); ein Vorschlag hat noch keine */}
      {concept.status === 'aktiv' ? (
        <ConceptCards conceptId={concept.id} conceptName={concept.name} evidence={data.evidence} />
      ) : null}

      <section aria-labelledby="concept-relations" className="mt-8">
        <h2 id="concept-relations" className="text-lg font-medium">
          Beziehungen
        </h2>
        {groups.length === 0 ? (
          <p className="mt-2 text-md text-text-muted">Noch keine Beziehungen.</p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`relation-${group.key}`}>
                <h3 id={`relation-${group.key}`} className="text-sm font-medium text-text-muted">
                  {group.label}
                </h3>
                <ul className="mt-1 flex flex-col gap-1">
                  {group.relations.map((relation) => (
                    <li key={relation.id} className="flex flex-wrap items-baseline gap-2">
                      <Link
                        href={conceptHref(relation.other.id)}
                        className="break-words underline-offset-2 hover:underline"
                      >
                        {relation.other.name}
                      </Link>
                      {relation.cross_module ? <span className={mark}>Fächerbrücke</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
