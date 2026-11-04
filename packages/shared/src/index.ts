// @sg/shared – gemeinsame Typen und Validatoren für Core und Web-App.
// Datenformate kommen ausschließlich aus packages/schemas (generiert, nie von Hand dupliziert).
export * from './generated/index.ts';

/** API-Basis-Pfad (08 §1) */
export const API_BASE = '/api/v1';

/** Standard-Port des Core (02 §3) */
export const CORE_PORT = 4710;

/** Feste Nutzer-ID für v1 (genau ein Nutzer, 01 §2) */
export const SINGLE_USER_ID = '0190f6a2-0000-7000-8000-000000000000';
