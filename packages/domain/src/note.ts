export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
}

export interface NoteRepository {
  save(note: Note): Promise<void>;
  findAll(): Promise<Note[]>;
}

export interface CreateNoteInput {
  id: string;
  title: string;
  body: string;
}

export function createNote(input: CreateNoteInput): Note {
  if (!input.title.trim()) {
    throw new Error('INVALID_TITLE');
  }
  return {
    id: input.id,
    title: input.title.trim(),
    body: input.body,
    createdAt: new Date(),
  };
}

export async function listNotes(repo: NoteRepository): Promise<Note[]> {
  return repo.findAll();
}
