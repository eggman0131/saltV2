import { describe, it, expect } from 'vitest';
import { createNote } from '@salt/domain';
import type { NoteDTO } from '@salt/shared-types';

describe('createNoteCallable domain integration', () => {
  it('createNote produces a Note convertible to NoteDTO', () => {
    const note = createNote({ id: 'cf-test', title: 'Cloud Function Test', body: 'Wiring proof' });

    const dto: NoteDTO = {
      id: note.id,
      title: note.title,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    };

    expect(dto.id).toBe('cf-test');
    expect(dto.title).toBe('Cloud Function Test');
    expect(dto.body).toBe('Wiring proof');
    expect(dto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('createNote rejects blank titles (same guard the callable relies on)', () => {
    expect(() => createNote({ id: 'x', title: '  ', body: '' })).toThrow('INVALID_TITLE');
  });
});
