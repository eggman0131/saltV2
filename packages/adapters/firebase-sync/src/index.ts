export type { FirebaseOptions } from 'firebase/app';
export { initFirebase, setFirestoreNetwork } from './init.js';
export { createFirebaseAuth } from './auth.js';
export { createFirebaseMatchLoggingAdapter } from './canonMatchingLog.js';
export { createGeminiEmbeddingAdapter } from './geminiEmbedding.js';
export { createGeminiArbitrationAdapter } from './geminiArbitration.js';
export { subscribeCanonItems, upsertCanonItem } from './canonSubscription.js';
export { subscribeAisles, saveAisles } from './aisleSubscription.js';
