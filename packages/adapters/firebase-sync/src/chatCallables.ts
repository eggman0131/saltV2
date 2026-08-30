import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type {
  ChefChatInput,
  GenerateChatTitleInput,
  GenerateChatTitleOutput,
} from '@salt/domain/schemas';
import { classifyCallableError } from './callableErrors.js';
import { callableRef, callFunction } from './callFunction.js';

export async function callGenerateChatTitle(
  userMessage: string,
  assistantResponse: string,
): Promise<ReadResult<string, DomainError>> {
  return callFunction<GenerateChatTitleInput, GenerateChatTitleOutput>({
    name: 'generateChatTitle',
    input: { userMessage, assistantResponse },
  });
}

// Streams the chef's reply chunk-by-chunk. onChunk is called for each text
// fragment as it arrives. The returned promise resolves to the full reply text
// once the stream is complete, or a Failure on error.
//
// THE ONE WRAPPER THAT IS STILL HAND-WRITTEN, and it takes only the transport
// from `callableRef`. `callFunction` awaits one answer; this awaits a sequence,
// and the drain loop below is the whole point of the function — chunks reach the
// caller AS THEY ARRIVE, which is what a reader needs to see. A helper that hid
// the loop would save four lines and cost the only interesting thing here.
// Region, name and the absent timeout still come from the one place.
export async function streamChefChat(
  input: ChefChatInput,
  onChunk: (chunk: string) => void,
): Promise<ReadResult<string, DomainError>> {
  try {
    // `chefChat` declares 120 s (`cloud-functions/src/index.ts:559`). The
    // callable client's default is 70, and this is a STREAM: the browser used to
    // abandon a long reply mid-flow, so the user watched an answer stop
    // half-written.
    const fn = callableRef<ChefChatInput, string, string>('chefChat', 120_000);
    const { stream, data } = await fn.stream(input);
    for await (const chunk of stream) {
      onChunk(chunk);
    }
    const result = await data;
    return success(result);
  } catch (err) {
    return failure(classifyCallableError(err));
  }
}
