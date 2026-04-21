import { describe, it, expect } from 'vitest';
import { createNote, listNotes } from '../src/note.js';
import type { NoteRepository, Note } from '../src/note.js';

describe('createNote', () => {
  it('builds a Note with trimmed title', () => {
    const note = createNote({ id: 'abc', title: '  Hello World  ', body: 'content' });
    expect(note.id).toBe('abc');
    expect(note.title).toBe('Hello World');
    expect(note.body).toBe('content');
    expect(note.createdAt).toBeInstanceOf(Date);
  });

  it('throws INVALID_TITLE when title is blank', () => {
    expect(() => createNote({ id: 'abc', title: '   ', body: '' })).toThrow('INVALID_TITLE');
  });

  it('throws INVALID_TITLE when title is empty string', () => {
    expect(() => createNote({ id: 'abc', title: '', body: '' })).toThrow('INVALID_TITLE');
  });
});

describe('listNotes', () => {
  it('delegates to the repository findAll', async () => {
    const mockNotes: Note[] = [{ id: '1', title: 'First', body: '', createdAt: new Date() }];
    const repo: NoteRepository = {
      save: async () => {},
      findAll: async () => mockNotes,
    };
    const result = await listNotes(repo);
    expect(result).toBe(mockNotes);
  });
});
