export interface NoteDTO {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export const ErrorCode = {
  INVALID_TITLE: 'INVALID_TITLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
