export const makeId = (): string => Math.random().toString(36).slice(2, 9);

export const makeTimestamp = (): Date => new Date();
