import { describe, it, expect } from 'vitest';
import { noteToDTO, dtoToNote } from '../src/note-mapping.js';
import type { Note } from '@salt/domain';
import type { NoteDTO } from '@salt/shared-types';

describe('note mapping', () => {
  const createdAt = new Date('2024-03-15T10:00:00.000Z');

  it('noteToDTO converts a Note to NoteDTO', () => {
    const note: Note = { id: '1', title: 'Test', body: 'Hello', createdAt };
    const dto = noteToDTO(note);
    expect(dto).toEqual<NoteDTO>({
      id: '1',
      title: 'Test',
      body: 'Hello',
      createdAt: '2024-03-15T10:00:00.000Z',
    });
  });

  it('dtoToNote converts a NoteDTO to Note', () => {
    const dto: NoteDTO = {
      id: '2',
      title: 'Round Trip',
      body: 'Body',
      createdAt: '2024-03-15T10:00:00.000Z',
    };
    const note = dtoToNote(dto);
    expect(note.id).toBe('2');
    expect(note.title).toBe('Round Trip');
    expect(note.createdAt).toBeInstanceOf(Date);
    expect(note.createdAt.toISOString()).toBe('2024-03-15T10:00:00.000Z');
  });

  it('round-trips without data loss', () => {
    const original: Note = { id: '3', title: 'Roundtrip', body: 'Test body', createdAt };
    const result = dtoToNote(noteToDTO(original));
    expect(result.id).toBe(original.id);
    expect(result.title).toBe(original.title);
    expect(result.body).toBe(original.body);
    expect(result.createdAt.getTime()).toBe(createdAt.getTime());
  });
});
