import { describe, it, expect } from 'vitest';
import { parseChatCommand } from '../../src/memory/index.js';

// The whole of capture's decision-making (issue #816). Everything asserted here is
// settled by reading characters — there is no model on this path, and these tests
// are the guarantee of that as much as they are a check on the string handling.

describe('parseChatCommand — recognising the command', () => {
  it('reads the note out of a /remember line', () => {
    expect(parseChatCommand('/remember we hate coriander')).toEqual({
      kind: 'remember',
      text: 'we hate coriander',
    });
  });

  it('trims the remainder', () => {
    expect(parseChatCommand('/remember    the oven runs hot   ')).toEqual({
      kind: 'remember',
      text: 'the oven runs hot',
    });
  });

  it('keeps the note verbatim otherwise — nothing rewrites what was typed', () => {
    expect(parseChatCommand('/remember Ana is vegetarian on Mondays (not Tuesdays!)')?.text).toBe(
      'Ana is vegetarian on Mondays (not Tuesdays!)',
    );
  });
});

// The command opens the line, so a phone keyboard's sentence-start capitalisation
// produces `/Remember …` as a matter of course. Matching case-sensitively would
// forward that to the chef — a model call, no note saved — and read as the feature
// being broken.
describe('parseChatCommand — case', () => {
  it('matches however the keyboard capitalised it', () => {
    for (const line of ['/Remember buy more salt', '/REMEMBER buy more salt']) {
      expect(parseChatCommand(line)).toEqual({ kind: 'remember', text: 'buy more salt' });
    }
  });
});

// The caller, not the parser, decides that empty is a rejection: this reports what
// was typed so the composer can answer in place instead of sending `/remember` to
// the chef as if it were a question.
describe('parseChatCommand — the empty remainder', () => {
  it('reports a bare /remember as the command with no text', () => {
    expect(parseChatCommand('/remember')).toEqual({ kind: 'remember', text: '' });
  });

  it('reports /remember followed only by whitespace the same way', () => {
    expect(parseChatCommand('/remember    ')).toEqual({ kind: 'remember', text: '' });
  });
});

describe('parseChatCommand — what is NOT the command', () => {
  it('leaves an ordinary message alone', () => {
    expect(parseChatCommand('what can I make with leftover rice?')).toBeNull();
  });

  it('leaves an empty line alone', () => {
    expect(parseChatCommand('')).toBeNull();
  });

  it('does not fire on a word that merely starts with it', () => {
    expect(parseChatCommand('/rememberings are lovely')).toBeNull();
    expect(parseChatCommand('/remembering')).toBeNull();
  });

  it('does not fire mid-sentence — the command opens the line', () => {
    expect(parseChatCommand('could you /remember that for me?')).toBeNull();
  });

  it('does not fire on another slash word', () => {
    expect(parseChatCommand('/forget the coriander')).toBeNull();
  });
});
