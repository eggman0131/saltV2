import { describe, it, expect } from 'vitest';
import { modelSupportsRole, type CatalogModelLike } from '../../src/ai/modelCapabilities.js';

// Capability classifier (Phase 3). A minimum-capability gate: cheaper text
// models (flash) intentionally qualify for both reasoning roles.

const textFlash: CatalogModelLike = {
  name: 'gemini-flash-latest',
  displayName: 'Gemini Flash',
  supportedGenerationMethods: ['generateContent', 'countTokens'],
};
const textPro: CatalogModelLike = {
  name: 'gemini-pro-latest',
  supportedGenerationMethods: ['generateContent', 'countTokens'],
};
const textFlashLite: CatalogModelLike = {
  name: 'gemini-flash-lite-latest',
  displayName: 'Gemini Flash Lite',
  supportedGenerationMethods: ['generateContent', 'countTokens'],
};
const embedder: CatalogModelLike = {
  name: 'gemini-embedding-001',
  supportedGenerationMethods: ['embedContent'],
};
const imageModel: CatalogModelLike = {
  name: 'gemini-2.5-flash-image',
  description: 'Image generation model',
  supportedGenerationMethods: ['generateContent'],
};
const imagen: CatalogModelLike = {
  name: 'imagen-3.0-generate-002',
  supportedGenerationMethods: ['predict'],
};

describe('modelSupportsRole', () => {
  it('lets text models (incl. flash) qualify for both fast and pro', () => {
    expect(modelSupportsRole('fast', textFlash)).toBe(true);
    expect(modelSupportsRole('pro', textFlash)).toBe(true);
    expect(modelSupportsRole('fast', textPro)).toBe(true);
    expect(modelSupportsRole('pro', textPro)).toBe(true);
  });

  it('admits text models (incl. flash-lite) for the lite role and excludes embedding/image', () => {
    expect(modelSupportsRole('lite', textFlashLite)).toBe(true);
    expect(modelSupportsRole('lite', textFlash)).toBe(true);
    expect(modelSupportsRole('lite', textPro)).toBe(true);
    // The lite role reuses the text/reasoning predicate, so non-text models are out.
    expect(modelSupportsRole('lite', embedder)).toBe(false);
    expect(modelSupportsRole('lite', imageModel)).toBe(false);
  });

  it('keeps embedders and image models out of the reasoning roles', () => {
    expect(modelSupportsRole('fast', embedder)).toBe(false);
    expect(modelSupportsRole('pro', embedder)).toBe(false);
    expect(modelSupportsRole('fast', imageModel)).toBe(false);
    expect(modelSupportsRole('pro', imageModel)).toBe(false);
  });

  it('matches only embedders for the embedding role', () => {
    expect(modelSupportsRole('embedding', embedder)).toBe(true);
    expect(modelSupportsRole('embedding', textFlash)).toBe(false);
    expect(modelSupportsRole('embedding', imageModel)).toBe(false);
  });

  it('matches image-generation models for the image role (name + method heuristic)', () => {
    expect(modelSupportsRole('image', imageModel)).toBe(true);
    expect(modelSupportsRole('image', imagen)).toBe(true);
    // Plain text/embedder never leak into the image picker.
    expect(modelSupportsRole('image', textFlash)).toBe(false);
    expect(modelSupportsRole('image', textPro)).toBe(false);
    expect(modelSupportsRole('image', embedder)).toBe(false);
  });

  it('excludes a model with no usable generation method from every role', () => {
    const inert: CatalogModelLike = { name: 'gemini-legacy', supportedGenerationMethods: [] };
    expect(modelSupportsRole('fast', inert)).toBe(false);
    expect(modelSupportsRole('pro', inert)).toBe(false);
    expect(modelSupportsRole('embedding', inert)).toBe(false);
    expect(modelSupportsRole('image', inert)).toBe(false);
  });
});
