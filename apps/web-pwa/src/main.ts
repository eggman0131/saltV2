import { initFirebase, createNoteRepository, callCreateNote } from '@salt/firebase-adapter';
import type { Note } from '@salt/domain';

initFirebase(
  {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  },
  import.meta.env.VITE_USE_EMULATORS === 'true',
);

const repo = createNoteRepository();
const statusEl = document.getElementById('status') as HTMLElement;
const listEl = document.getElementById('notes-list') as HTMLElement;

async function loadNotes(): Promise<void> {
  const notes = await repo.findAll();
  renderNotes(notes);
}

function renderNotes(notes: Note[]): void {
  if (notes.length === 0) {
    listEl.innerHTML = '<li>No notes yet. Create one above!</li>';
    return;
  }
  listEl.innerHTML = notes
    .map(
      (n) =>
        `<li><strong>${escHtml(n.title)}</strong>${n.body ? ' — ' + escHtml(n.body) : ''}<em>${n.createdAt.toLocaleString()}</em></li>`,
    )
    .join('');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.getElementById('create-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const titleInput = form.elements.namedItem('title');
  const bodyInput = form.elements.namedItem('body');
  if (!(titleInput instanceof HTMLInputElement) || !(bodyInput instanceof HTMLInputElement)) return;

  statusEl.textContent = 'Creating…';
  try {
    await callCreateNote({ title: titleInput.value, body: bodyInput.value });
    form.reset();
    statusEl.textContent = '';
    await loadNotes();
  } catch (err) {
    statusEl.textContent = String(err);
  }
});

loadNotes().catch((err) => {
  listEl.innerHTML = `<li>Error loading notes: ${String(err)}</li>`;
});
