export type { FirebaseOptions } from 'firebase/app';
export { initFirebase } from './init.js';
export { createFirebaseAuth } from './auth.js';
export { createFirebaseCanonStoreAdapter } from './firebaseCanonStore.js';
export { createFirebaseAisleStoreAdapter } from './firebaseAisleStore.js';
export { createFirebaseMatchLoggingAdapter } from './canonMatchingLog.js';
export { createGeminiEmbeddingAdapter } from './geminiEmbedding.js';
export { createGeminiArbitrationAdapter } from './geminiArbitration.js';
