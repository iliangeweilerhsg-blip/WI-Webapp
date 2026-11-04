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

/** Vorschlag für den Semesternamen: Herbstsemester ab September (der Januar gehört noch dazu), sonst Frühjahrssemester. */
export function suggestSemesterName(date: Date = new Date()): string {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month >= 9) return `HS ${year}`;
  if (month === 1) return `HS ${year - 1}`;
  return `FS ${year}`;
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
