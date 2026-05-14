export type { FirebaseOptions } from 'firebase/app';
export { initFirebase, setFirestoreNetwork } from './init.js';
export { createFirebaseAuth } from './auth.js';
export { subscribeCanonItems, upsertCanonItem } from './canonSubscription.js';
export { subscribeAisles, saveAisles } from './aisleSubscription.js';
export {
  subscribeEquipmentManifest,
  saveEquipmentManifest,
} from './equipmentManifestSubscription.js';
export { callMatchOrCreate } from './canonMatching.js';
export { callIdentifyEquipment, callPopulateEquipmentEntry } from './equipmentCallables.js';
export type {
  IdentifyEquipmentCandidate,
  IdentifyEquipmentResult,
  PopulateAccessory,
  PopulateEquipmentEntryResult,
} from './equipmentCallables.js';
