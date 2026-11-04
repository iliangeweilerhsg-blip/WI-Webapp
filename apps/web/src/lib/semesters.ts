'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SemesterListSchema,
  SemesterSchema,
  type Semester,
  type SemesterCreate,
  type SemesterUpdate,
} from '@sg/shared';
import { apiGet, apiSend } from './api.ts';

/** Alle Semester aus `GET /semesters` (neueste zuerst, archivierte inklusive). */
export function useSemesters() {
  return useQuery({
    queryKey: ['semesters'],
    queryFn: ({ signal }) => apiGet('/semesters?limit=100', SemesterListSchema, { signal }),
    select: (page) => page.items.filter((s) => s.deleted_at === null),
  });
}

/**
 * Das Semester, dessen Module die Seitenleiste zeigt: das aktuelle, sonst das neueste nicht archivierte.
 * Archivierte Semester sind in der Navigation ausgeblendet (F-ORG-01), bleiben aber lesbar.
 */
export function pickCurrentSemester(semesters: readonly Semester[]): Semester | undefined {
  const active = semesters.filter((s) => s.archived_at === null);
  return active.find((s) => s.is_current) ?? active[0];
}

/**
 * Vorschlag für den Semesternamen: Herbstsemester ab September (der Januar gehört noch dazu), sonst
 * Frühjahrssemester. Namen, die es schon gibt, werden übersprungen (HS 2026 → FS 2027 → HS 2027 …).
 */
export function suggestSemesterName(date: Date = new Date(), taken: readonly string[] = []): string {
  const month = date.getMonth() + 1;
  let year = date.getFullYear();
  let autumn = month >= 9 || month === 1;
  if (month === 1) year -= 1;
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  for (let i = 0; i < 40; i += 1) {
    const name = `${autumn ? 'HS' : 'FS'} ${year}`;
    if (!used.has(name.toLowerCase())) return name;
    if (autumn) year += 1;
    autumn = !autumn;
  }
  return `${autumn ? 'HS' : 'FS'} ${year}`;
}

export function useCreateSemester() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SemesterCreate) => apiSend('POST', '/semesters', SemesterSchema, { body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['semesters'] }),
  });
}

export function useUpdateSemester() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SemesterUpdate }) =>
      apiSend('PATCH', `/semesters/${encodeURIComponent(id)}`, SemesterSchema, { body: patch }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['semesters'] }),
  });
}
