'use client';

// Einstellungen → KI (VERTRAEGE §20.7, §20.10, F-EIN-01, F-DAT-05): Status, Monatsbudget, automatisches Annehmen und
// die Kosten des Monats. Den Schlüssel trägt man in der `.env` ein; hier gibt es nie ein Eingabefeld dafür.
import { useQueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import type { AiSettingsUpdate, AutoAcceptMode, CostSummary } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import { sessionRefLabel } from '../../lib/concepts.ts';
import {
  AI_STATE_LABELS,
  AI_STATUS_KEY,
  AUTO_ACCEPT_OPTIONS,
  AUTO_ACCEPT_WARNING,
  COSTS_KEY,
  aiState,
  aiStateSentence,
  budgetPercent,
  formatEur,
  monthLabel,
  parseBudget,
  taskLabel,
  useAiStatus,
  useCostSummary,
} from '../../lib/costs.ts';
import { useSettings, useUpdateSettings } from '../../lib/settings.ts';
import { useToast } from '../../lib/toast.tsx';
import { rueckblickHref } from '../../lib/transcript.ts';
import { CoreHint } from '../CoreHint.tsx';
import { AreaForm, NumberField, SelectField, SettingsTabContext, type AreaFormState } from './form.tsx';

const budgetText = (value: number) => String(value).replace('.', ',');

function AiStatusBox() {
  const status = useAiStatus();
  return (
    <section aria-labelledby="ai-status-title" className="mt-6 rounded-lg border border-border p-4">
      <h2 id="ai-status-title" className="text-lg font-medium">
        KI
      </h2>
      {status.isError ? (
        <div className="mt-3">
          <CoreHint error={status.error} />
        </div>
      ) : !status.data ? (
        <p role="status" className="mt-3 text-sm text-text-muted">
          Status wird geladen …
        </p>
      ) : (
        <div role="status" data-testid="ai-state" data-state={aiState(status.data)} className="mt-2">
          <p className="text-md font-medium">{AI_STATE_LABELS[aiState(status.data)]}</p>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{aiStateSentence(status.data)}</p>
        </div>
      )}
    </section>
  );
}

/** Formular des Bereichs `ai`. `form.tsx` kennt nur ganze Zahlen und die alten Bereiche, darum ein eigener Zustand. */
function AiForm() {
  const query = useSettings();
  const update = useUpdateSettings();
  const toast = useToast();
  const client = useQueryClient();
  const server = query.data?.ai;
  const [budget, setBudget] = useState<string | null>(null);
  const [mode, setMode] = useState<AutoAcceptMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = budget === null ? null : parseBudget(budget);
  const invalid = budget !== null && parsed === null;
  const patch: AiSettingsUpdate = {};
  if (server && parsed !== null && parsed !== server.monthly_budget_eur) patch.monthly_budget_eur = parsed;
  if (server && mode !== null && mode !== server.auto_accept) patch.auto_accept = mode;
  const changed = Object.keys(patch).length > 0;
  const dirty = changed || invalid;

  const { report, active } = useContext(SettingsTabContext);
  const activeRef = useRef(active);
  activeRef.current = active;
  const hasError = error !== null;
  useEffect(() => {
    report({ error: hasError, dirty });
  }, [report, hasError, dirty]);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!server || !changed || invalid || update.isPending) return;
    setError(null);
    try {
      await update.mutateAsync({ ai: patch });
      setBudget(null);
      setMode(null);
      toast.show({ message: 'KI-Einstellungen gespeichert' });
      // Das Budget steht auch im Status und in den Kosten
      void client.invalidateQueries({ queryKey: AI_STATUS_KEY });
      void client.invalidateQueries({ queryKey: COSTS_KEY });
    } catch (failure) {
      const message = friendlyMessage(failure);
      setError(message);
      if (!activeRef.current) toast.show({ message: `Nicht gespeichert: ${message}` });
    }
  }

  const form: AreaFormState = {
    query,
    values: server,
    save,
    discard: () => {
      setBudget(null);
      setMode(null);
      setError(null);
    },
    saving: update.isPending,
    dirty,
    canSave: changed && !invalid && !update.isPending,
    disabledReason: update.isPending
      ? null
      : invalid
        ? 'Bitte zuerst das markierte Feld korrigieren.'
        : !changed
          ? 'Keine Änderungen zu speichern.'
          : null,
    error,
  };
  const shownMode = mode ?? server?.auto_accept ?? 'aus';

  return (
    <AreaForm
      title="Budget und Automatik"
      intro="Wie viel die KI im Monat kosten darf und was sie ohne Rückfrage übernimmt."
      form={form}
    >
      {server ? (
        <>
          <NumberField
            label="Monatsbudget"
            unit="€"
            hint="Ist es erreicht, pausiert die KI bis zum nächsten Monat. 0 schaltet sie aus."
            field={{
              text: budget ?? budgetText(server.monthly_budget_eur),
              error: invalid ? 'Bitte einen Betrag von 0 bis 1000 eingeben.' : null,
              onChange: (text) => {
                setError(null);
                setBudget(text);
              },
            }}
          />
          <SelectField
            label="Automatisch annehmen"
            hint="Was nicht automatisch angenommen wird, wartet in der Inbox."
            value={shownMode}
            options={AUTO_ACCEPT_OPTIONS}
            onChange={(value) => {
              setError(null);
              setMode(value);
            }}
          />
          {shownMode === 'alles_ab_0_9' ? (
            <p data-testid="auto-accept-warning" className="text-sm text-text-muted sm:col-span-2">
              {AUTO_ACCEPT_WARNING}
            </p>
          ) : null}
        </>
      ) : null}
    </AreaForm>
  );
}

function CostTable({ costs }: { costs: CostSummary }) {
  const { budget } = costs;
  const percent = budgetPercent(budget.spent_eur, budget.budget_eur);
  return (
    <>
      <p className="mt-2 text-md">
        <span className="font-medium tabular-nums">{formatEur(budget.spent_eur)}</span>
        <span className="text-text-muted">
          {' '}
          von {formatEur(budget.budget_eur)} · {costs.calls === 1 ? '1 Aufruf' : `${costs.calls} Aufrufe`}
        </span>
      </p>
      {/* Neutraler Balken, nie rot (07 §2, LP9) */}
      <div
        role="progressbar"
        aria-label="Anteil am Monatsbudget"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} % des Monatsbudgets`}
        className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-border"
      >
        <div className="h-full rounded-full bg-text-muted" style={{ width: `${percent}%` }} />
      </div>
      {budget.reached ? (
        <p className="mt-2 text-sm text-text-muted">
          Das Budget ist erreicht. Die KI pausiert bis zum nächsten Monat oder bis du es erhöhst.
        </p>
      ) : budget.warn ? (
        <p className="mt-2 text-sm text-text-muted">Über 80 % des Budgets sind verbraucht.</p>
      ) : null}

      {costs.by_task.length > 0 ? (
        <table className="relative mt-4 w-full max-w-md text-sm">
          <caption className="text-left text-sm font-medium text-text-muted">Je Aufgabe</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Aufgabe</th>
              <th scope="col">Aufrufe</th>
              <th scope="col">Kosten</th>
            </tr>
          </thead>
          <tbody>
            {costs.by_task.map((row) => (
              <tr key={row.task} className="border-t border-border">
                <th scope="row" className="py-1.5 text-left font-normal">
                  {taskLabel(row.task)}
                </th>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{row.calls}</td>
                <td className="py-1.5 pl-4 text-right tabular-nums">{formatEur(row.eur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {costs.by_session.length > 0 ? (
        <table className="relative mt-4 w-full max-w-md text-sm">
          <caption className="text-left text-sm font-medium text-text-muted">Teuerste Vorlesungen</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Vorlesung</th>
              <th scope="col">Aufrufe</th>
              <th scope="col">Kosten</th>
            </tr>
          </thead>
          <tbody>
            {costs.by_session.map((row) => (
              <tr key={row.session_id} className="border-t border-border">
                <th scope="row" className="py-1.5 text-left font-normal">
                  {row.session ? (
                    <a href={rueckblickHref(row.session.id)} className="underline-offset-2 hover:underline">
                      {sessionRefLabel(row.session)}
                    </a>
                  ) : (
                    <span className="text-text-muted">Gelöschte Vorlesung</span>
                  )}
                </th>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{row.calls}</td>
                <td className="py-1.5 pl-4 text-right tabular-nums">{formatEur(row.eur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

function AiCosts() {
  const costs = useCostSummary();
  return (
    <section aria-labelledby="ai-costs-title" className="mt-6 rounded-lg border border-border p-4">
      <h2 id="ai-costs-title" className="text-lg font-medium">
        Kosten{costs.data ? ` im ${monthLabel(costs.data.budget.month)}` : ''}
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Geschätzt aus den Aufrufen. Die Abrechnung des Anbieters kann abweichen.
      </p>
      {costs.isError ? (
        <div className="mt-3">
          <CoreHint error={costs.error} />
        </div>
      ) : !costs.data ? (
        <p role="status" className="mt-3 text-sm text-text-muted">
          Kosten werden geladen …
        </p>
      ) : (
        <CostTable costs={costs.data} />
      )}
    </section>
  );
}

/** Einstellungen → KI */
export function AiSettings() {
  return (
    <>
      <AiStatusBox />
      <AiForm />
      <AiCosts />
    </>
  );
}
