import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type { ChefChatInput } from '@salt/domain/schemas';

const REGION = 'europe-west2';

function getErr(err: unknown): DomainError {
  const code = (err as { code?: string }).code ?? '';
  if (code === 'functions/unauthenticated') {
    return { kind: 'AuthError', reason: 'unauthenticated' };
  }
  if (code === 'functions/permission-denied') {
    return { kind: 'AuthError', reason: 'forbidden' };
  }
  return { kind: 'NetworkError', reason: 'transient' };
}

export async function callGenerateChatTitle(
  userMessage: string,
  assistantResponse: string,
): Promise<ReadResult<string, DomainError>> {
  try {
    const fn = httpsCallable<{ userMessage: string; assistantResponse: string }, string>(
      getFunctions(undefined, REGION),
      'generateChatTitle',
    );
    const res = await fn({ userMessage, assistantResponse });
    return success(res.data);
  } catch (err) {
    return failure(getErr(err));
  }
}

// Streams the chef's reply chunk-by-chunk. onChunk is called for each text
// fragment as it arrives. The returned promise resolves to the full reply text
// once the stream is complete, or a Failure on error.
export async function streamChefChat(
  input: ChefChatInput,
  onChunk: (chunk: string) => void,
): Promise<ReadResult<string, DomainError>> {
  try {
    const fn = httpsCallable<ChefChatInput, string, string>(
      getFunctions(undefined, REGION),
      'chefChat',
    );
    const { stream, data } = await fn.stream(input);
    for await (const chunk of stream) {
      onChunk(chunk);
    }
    const result = await data;
    return success(result);
  } catch (err) {
    return failure(getErr(err));
  }
}
