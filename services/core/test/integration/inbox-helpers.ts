// Hilfen für die Tests von T2-22b: Vorschläge, Beziehungen, Belege und Inbox-Einträge direkt in die Tabellen
// schreiben (der Worker läuft nicht). Verweise laufen über Kurznamen wie in `fixtures/concepts/decisions.json`;
// die IDs werden so vergeben, dass ihre Reihenfolge der Reihenfolge der Kurznamen entspricht.
import { asc, eq } from 'drizzle-orm';
import {
  SINGLE_USER_ID,
  type AutoAcceptMode,
  type ConceptProposal,
  type CardProposal,
  type InboxDecision,
  type InboxPayload,
} from '@sg/shared';
import type { DbHandle } from '../../src/db/client.ts';
import {
  card,
  cardState,
  concept,
  conceptModule,
  conceptRelation,
  courseModule,
  evidence,
  inboxItem,
  semester,
  session,
  setting,
  slide,
  slideDeck,
} from '../../src/db/schema/index.ts';
import { emptyDecision } from '../../src/services/concept-graph.ts';

const base = { userId: SINGLE_USER_ID };

/** UUID aus einem Kurznamen (≤ 16 ASCII-Zeichen): gleiche Reihenfolge wie die Kurznamen */
export function refId(ref: string): string {
  const hex = Buffer.from(ref, 'utf8').toString('hex').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const PROPOSAL: ConceptProposal = {
  name: 'Platzhalter',
  aliases: [],
  one_liner: null,
  kind: 'definition',
  importance: 2,
  exam_hint: false,
  prof_explanation: null,
  confidence: 0.8,
};

export interface ConceptSeed {
  name?: string;
  aliases?: string[];
  status?: 'vorschlag' | 'aktiv';
  /** Kurzname der Session (`proposal_session_id`), Pflicht bei `vorschlag` */
  session?: string | null;
  modules?: string[];
  oneLiner?: string | null;
  examRelevant?: boolean;
  embedded?: boolean;
  deletedAt?: Date;
}

export interface RelationSeed {
  from: string;
  to: string;
  kind?: string;
  confirmed?: boolean;
  session?: string | null;
  confidence?: number | null;
}

export interface ItemSeed {
  kind: 'concept_new' | 'concept_merge' | 'relation' | 'card_batch';
  concept?: string;
  /** `card_batch`: Kurzname des Konzepts, zu dem die Karten vorgeschlagen sind (`card_concept_id`) */
  cardConcept?: string;
  /** `card_batch`: Karten des Vorschlags (Standard: `k1` basic und `k2` cloze) */
  cards?: CardProposal[];
  target?: string;
  relation?: string;
  session?: string | null;
  status?: 'offen' | 'angenommen' | 'abgelehnt' | 'automatisch';
  proposal?: Partial<ConceptProposal>;
  /** Teil-Entscheidung mit echten IDs (über `refId`) */
  decision?: Partial<InboxDecision>;
  priority?: number;
  createdAt?: Date;
}

/** Zwei Karten wie im Fake des Workers (§21.6), beide mit einem Zeitraum-Beleg der Session */
export function defaultCards(sessionRef: string): CardProposal[] {
  const sources = [
    { kind: 'transcript' as const, session_id: refId(sessionRef), t_start_ms: 0, t_end_ms: 1000 },
  ];
  return [
    {
      key: 'k1',
      content: {
        kind: 'basic',
        front: { text_md: 'Was ist ein Tupel?' },
        back: { text_md: 'Eine Zeile einer Relation.', explanation_md: null },
      },
      sources,
    },
    {
      key: 'k2',
      content: {
        kind: 'cloze',
        front: { text_md: '{{c1::Tupel}} ist ein Thema dieser Vorlesung.' },
        back: { answers: { c1: ['Tupel'] } },
      },
      sources,
    },
  ];
}

const VECTOR = `[${Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;

export class World {
  private readonly handle: DbHandle;
  private readonly relations = new Map<string, RelationSeed>();

  constructor(handle: DbHandle) {
    this.handle = handle;
  }

  get db() {
    return this.handle.db;
  }

  /** Alles leeren, ein Semester und das Modul `m1` anlegen */
  async reset(): Promise<void> {
    await this.handle
      .sql`TRUNCATE semester, module, calendar_source, calendar_event, session, slide_deck, job,
      sync_op, sync_stream, setting, recording, idempotency_key, concept CASCADE`;
    this.relations.clear();
    await this.db.insert(semester).values({ id: refId('sem'), ...base, name: 'HS 2026' });
    await this.module('m1', 'Datenbanken');
  }

  async module(ref: string, name: string, shortName: string | null = null): Promise<string> {
    await this.db
      .insert(courseModule)
      .values({ id: refId(ref), ...base, semesterId: refId('sem'), name, shortName, color: 'mod-01' });
    return refId(ref);
  }

  async session(ref: string, over: Partial<typeof session.$inferInsert> = {}): Promise<string> {
    await this.db
      .insert(session)
      .values({ id: refId(ref), ...base, moduleId: refId('m1'), state: 'verarbeitet', ...over });
    return refId(ref);
  }

  async ensureSession(ref: string): Promise<string> {
    const [found] = await this.db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.id, refId(ref)));
    return found ? found.id : this.session(ref);
  }

  async deck(ref: string, slides: { ref: string; index: number; title?: string }[]): Promise<string> {
    await this.db.insert(slideDeck).values({
      id: refId(ref),
      ...base,
      moduleId: refId('m1'),
      title: 'Foliensatz',
      filePath: `media/decks/${ref}.pdf`,
      sha256: 'a'.repeat(64),
    });
    for (const s of slides) {
      await this.db.insert(slide).values({
        id: refId(s.ref),
        ...base,
        deckId: refId(ref),
        index: s.index,
        widthPt: 800,
        heightPt: 600,
        title: s.title ?? null,
      });
    }
    return refId(ref);
  }

  async concept(ref: string, seed: ConceptSeed = {}): Promise<string> {
    const status = seed.status ?? 'vorschlag';
    const sessionRef = seed.session === undefined ? (status === 'vorschlag' ? 's1' : null) : seed.session;
    if (sessionRef) await this.ensureSession(sessionRef);
    await this.db.insert(concept).values({
      id: refId(ref),
      ...base,
      name: seed.name ?? `Konzept ${ref}`,
      aliases: seed.aliases ?? [],
      kind: 'definition',
      oneLiner: seed.oneLiner ?? null,
      status,
      proposalSessionId: sessionRef ? refId(sessionRef) : null,
      examRelevant: seed.examRelevant ?? false,
      ...(seed.deletedAt ? { deletedAt: seed.deletedAt } : {}),
    });
    if (seed.embedded) {
      await this.handle.sql`UPDATE concept SET embedding = ${VECTOR}::vector, embedding_model = 'fake'
        WHERE id = ${refId(ref)}`;
    }
    for (const moduleRef of seed.modules ?? []) {
      await this.db.insert(conceptModule).values({
        id: refId(`cm-${ref}-${moduleRef}`),
        ...base,
        conceptId: refId(ref),
        moduleId: refId(moduleRef),
      });
    }
    return refId(ref);
  }

  async relation(ref: string, seed: RelationSeed): Promise<string> {
    const confirmed = seed.confirmed ?? false;
    const sessionRef = seed.session === undefined ? (confirmed ? null : 's1') : seed.session;
    if (sessionRef) await this.ensureSession(sessionRef);
    this.relations.set(ref, seed);
    await this.db.insert(conceptRelation).values({
      id: refId(ref),
      ...base,
      fromId: refId(seed.from),
      toId: refId(seed.to),
      kind: seed.kind ?? 'baut_auf',
      source: 'ki',
      confidence: seed.confidence === undefined ? 0.8 : seed.confidence,
      confirmed,
      why: 'Erfundene Begründung.',
      proposalSessionId: sessionRef ? refId(sessionRef) : null,
    });
    return refId(ref);
  }

  async slideEvidence(
    ref: string,
    seed: { concept: string; session: string; slide: string; auto?: boolean; deletedAt?: Date },
  ): Promise<string> {
    await this.ensureSession(seed.session);
    await this.db.insert(evidence).values({
      id: refId(ref),
      ...base,
      conceptId: refId(seed.concept),
      sessionId: refId(seed.session),
      kind: 'slide',
      refId: refId(seed.slide),
      auto: seed.auto ?? false,
      ...(seed.deletedAt ? { deletedAt: seed.deletedAt } : {}),
    });
    return refId(ref);
  }

  async transcriptEvidence(
    ref: string,
    seed: { concept: string; session: string; startMs: number; endMs: number; quote?: string },
  ): Promise<string> {
    await this.ensureSession(seed.session);
    await this.db.insert(evidence).values({
      id: refId(ref),
      ...base,
      conceptId: refId(seed.concept),
      sessionId: refId(seed.session),
      kind: 'transcript',
      refId: refId(seed.session),
      tStartMs: seed.startMs,
      tEndMs: seed.endMs,
      quote: seed.quote ?? null,
    });
    return refId(ref);
  }

  async item(ref: string, seed: ItemSeed): Promise<string> {
    const sessionRef = seed.session === undefined ? 's1' : seed.session;
    if (sessionRef) await this.ensureSession(sessionRef);
    const status = seed.status ?? 'offen';
    let payload: InboxPayload;
    if (seed.kind === 'card_batch') {
      payload = {
        kind: 'card_batch',
        concept_id: refId(seed.cardConcept!),
        concept_name: 'Name beim Erzeugen',
        cards: seed.cards ?? defaultCards(sessionRef ?? 's1'),
        input_hash: 'a'.repeat(64),
        prompt_version: 'cards.generate/v1',
        model: 'fake',
      };
    } else if (seed.kind === 'relation') {
      const relation = this.relations.get(seed.relation!);
      if (!relation) throw new Error(`Beziehung ${seed.relation} fehlt`);
      payload = {
        kind: 'relation',
        from_concept_id: refId(relation.from),
        to_concept_id: refId(relation.to),
        relation_kind: (relation.kind ?? 'baut_auf') as never,
        why: 'Erfundene Begründung.',
        confidence: relation.confidence ?? 0.8,
        prompt_version: 'concepts.resolve/v1',
        model: 'fake',
      };
    } else {
      const proposal = { ...PROPOSAL, ...seed.proposal };
      const common = {
        proposal,
        evidence: [
          {
            kind: 'transcript' as const,
            session_id: refId(sessionRef ?? 's1'),
            t_start_ms: 0,
            t_end_ms: 1000,
          },
        ],
      };
      payload =
        seed.kind === 'concept_new'
          ? {
              kind: 'concept_new',
              ...common,
              similar: [],
              prompt_version: 'concepts.extract/v1',
              model: 'fake',
            }
          : {
              kind: 'concept_merge',
              ...common,
              target: { concept_id: refId(seed.target!), name: 'Ziel' },
              basis: 'ki',
              similarity: 0.8,
              reason: 'Erfundene Begründung.',
              prompt_version: 'concepts.resolve/v1',
              model: 'fake',
            };
    }
    const decision =
      status === 'offen'
        ? null
        : {
            ...emptyDecision(
              status === 'abgelehnt'
                ? 'abgelehnt'
                : seed.kind === 'relation'
                  ? 'beziehung_bestaetigt'
                  : seed.kind === 'card_batch'
                    ? 'karten_angenommen'
                    : 'angenommen_neu',
            ),
            ...seed.decision,
          };
    await this.db.insert(inboxItem).values({
      id: refId(ref),
      ...base,
      kind: seed.kind,
      sessionId: sessionRef ? refId(sessionRef) : null,
      payload,
      status,
      decidedAt: status === 'offen' ? null : new Date(),
      decision,
      priority: seed.priority ?? (seed.kind === 'card_batch' ? 2000 : 0),
      cardConceptId: seed.cardConcept ? refId(seed.cardConcept) : null,
      conceptId: seed.concept ? refId(seed.concept) : null,
      targetConceptId: seed.target ? refId(seed.target) : null,
      relationId: seed.relation ? refId(seed.relation) : null,
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
    });
    return refId(ref);
  }

  async setAutoAccept(mode: AutoAcceptMode): Promise<void> {
    await this.db
      .insert(setting)
      .values({ key: 'ai', ...base, value: { auto_accept: mode } })
      .onConflictDoUpdate({ target: setting.key, set: { value: { auto_accept: mode } } });
  }

  // --- Lesen ---------------------------------------------------------------------------------------------

  async conceptRow(ref: string) {
    const [row] = await this.handle.sql<
      {
        id: string;
        name: string;
        aliases: string[];
        kind: string | null;
        one_liner: string | null;
        status: string;
        merged_into: string | null;
        proposal_session_id: string | null;
        exam_relevant: boolean;
        importance_base: number;
        embedded: boolean;
      }[]
    >`SELECT id, name, aliases, kind, one_liner, status, merged_into, proposal_session_id, exam_relevant,
        importance_base, embedding IS NOT NULL AS embedded FROM concept WHERE id = ${refId(ref)}`;
    return row!;
  }

  async relationRow(ref: string) {
    const [row] = await this.db
      .select()
      .from(conceptRelation)
      .where(eq(conceptRelation.id, refId(ref)));
    return row!;
  }

  async itemRow(ref: string) {
    const [row] = await this.db
      .select()
      .from(inboxItem)
      .where(eq(inboxItem.id, refId(ref)));
    return row!;
  }

  /** Karten (auch gelöschte) samt Zustand, nach ID */
  async cardRows() {
    return this.db.select().from(card).orderBy(asc(card.id));
  }

  async cardStateCount(): Promise<number> {
    return (await this.db.select({ id: cardState.id }).from(cardState)).length;
  }

  async evidenceRow(ref: string) {
    const [row] = await this.db
      .select()
      .from(evidence)
      .where(eq(evidence.id, refId(ref)));
    return row;
  }

  /** Zustand aller Tabellen des Konzeptgraphen ohne `updated_at` und Vektoren („es ändert sich nichts“) */
  async snapshot(): Promise<unknown> {
    const strip = <T extends { updatedAt: Date }>(rows: T[]) =>
      rows.map(({ updatedAt: _u, ...rest }) => rest);
    const concepts = await this.db.select().from(concept).orderBy(asc(concept.id));
    return {
      concepts: strip(concepts).map(({ embedding, ...rest }) => ({ ...rest, embedded: embedding !== null })),
      modules: strip(await this.db.select().from(conceptModule).orderBy(asc(conceptModule.id))),
      relations: strip(await this.db.select().from(conceptRelation).orderBy(asc(conceptRelation.id))),
      evidence: strip(await this.db.select().from(evidence).orderBy(asc(evidence.id))),
      items: strip(await this.db.select().from(inboxItem).orderBy(asc(inboxItem.id))),
    };
  }
}
