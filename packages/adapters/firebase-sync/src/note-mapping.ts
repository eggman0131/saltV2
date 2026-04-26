import type { Note } from '@salt/domain';
import type { NoteDTO } from '@salt/shared-types';

export function noteToDTO(note: Note): NoteDTO {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
  };
}

export function dtoToNote(dto: NoteDTO): Note {
  return {
    id: dto.id,
    title: dto.title,
    body: dto.body,
    createdAt: new Date(dto.createdAt),
  };
}
