import type { Firestore } from 'firebase/firestore';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { NoteRepository, Note } from '@salt/domain';
import type { NoteDTO } from '@salt/shared-types';
import { noteToDTO, dtoToNote } from './note-mapping.js';

export class FirestoreNoteRepository implements NoteRepository {
  constructor(private readonly db: Firestore) {}

  async save(note: Note): Promise<void> {
    await setDoc(doc(this.db, 'notes', note.id), noteToDTO(note));
  }

  async findAll(): Promise<Note[]> {
    const snapshot = await getDocs(collection(this.db, 'notes'));
    return snapshot.docs.map((d) => dtoToNote(d.data() as NoteDTO));
  }
}

export function createNoteRepository(): NoteRepository {
  return new FirestoreNoteRepository(getFirestore(getApp()));
}
