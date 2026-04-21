import { onCall } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createNote } from '@salt/domain';
import type { NoteDTO } from '@salt/shared-types';

initializeApp();

interface CreateNoteData {
  title: string;
  body: string;
}

export const createNoteCallable = onCall<CreateNoteData, Promise<NoteDTO>>(async (request) => {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const note = createNote({ id, title: request.data.title, body: request.data.body });

  const dto: NoteDTO = {
    id: note.id,
    title: note.title,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
  };

  await getFirestore().collection('notes').doc(note.id).set(dto);
  return dto;
});
