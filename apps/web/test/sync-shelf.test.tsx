import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorShelf, shelfToJson, type ShelfSource } from '../src/lib/sync/ErrorShelf.tsx';
import type { ShelfEntry } from '../src/lib/sync/types.ts';

const entry: ShelfEntry = {
  id: 1,
  shelvedAt: 1762240000000,
  op: {
    type: 'op',
    op_id: '019a4e14-0000-7000-8000-000000000001',
    stream: 'notebook:019a4e14-0000-7000-8000-000000000002',
    kind: 'page.delete',
    at: 1,
    clock_uncertain: false,
    data: { page_id: '019a4e14-0000-7000-8000-000000000003' },
  },
  reason: { kind: 'rejected', code: 'page_not_found', message: 'Seite fehlt', causedBy: null },
};

describe('ErrorShelf', () => {
  it('zeigt nichts bei leerer Ablage', async () => {
    const src: ShelfSource = { listShelf: async () => [], onEvent: () => () => undefined };
    const { container } = render(<ErrorShelf client={src} />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('zeigt Zähler und Liste und exportiert JSON', async () => {
    const create = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const src: ShelfSource = { listShelf: async () => [entry], onEvent: () => () => undefined };
    render(<ErrorShelf client={src} />);
    await userEvent.click(await screen.findByRole('button', { name: /Fehlerablage \(1\)/ }));
    expect(screen.getByText(/page_not_found/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /JSON exportieren/ }));
    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('Export enthält Format, Version und Einträge', () => {
    const json = JSON.parse(shelfToJson([entry], 0)) as {
      format: string;
      version: number;
      entries: unknown[];
    };
    expect(json).toMatchObject({ format: 'sg-sync-error-shelf', version: 1 });
    expect(json.entries).toHaveLength(1);
  });
});
