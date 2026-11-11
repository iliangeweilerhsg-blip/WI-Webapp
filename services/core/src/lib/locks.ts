/** Advisory-Lock-Schlüssel des Core (jeweils an genau einer Stelle definiert) */
export const SEMESTER_LOCK_KEY = 70070001;
export const BACKUP_LOCK_KEY = 70070002;
export const NIGHTLY_LOCK_KEY = 70070003;
export const RESTORE_TEST_LOCK_KEY = 70070004;
/** Automatische Kurszuordnung (#141) und Zuordnung von Hand: nie zwei gleichzeitig, keine doppelten Module */
export const MOODLE_AUTO_LOCK_KEY = 70070005;
/** Konzeptgraph (VERTRAEGE §20.6): jede Annahme und Rücknahme in der Inbox, im Worker `concepts.resolve` */
export const CONCEPT_GRAPH_LOCK_KEY = 70070006;
