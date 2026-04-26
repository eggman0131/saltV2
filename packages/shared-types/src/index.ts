export interface NoteDTO {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface CanonItemDTO {
  id: string;
  name: string;
  synonyms: string[];
  aisle: string | null;
}

export const ErrorCode = {
  INVALID_TITLE: 'INVALID_TITLE',
  INVALID_CANON_NAME: 'INVALID_CANON_NAME',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
