import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app';
import type { NoteDTO } from '@salt/shared-types';

interface CreateNoteRequest {
  title: string;
  body: string;
}

export async function callCreateNote(input: CreateNoteRequest): Promise<NoteDTO> {
  const fn = httpsCallable<CreateNoteRequest, NoteDTO>(
    getFunctions(getApp()),
    'createNoteCallable',
  );
  const result = await fn(input);
  return result.data;
}
