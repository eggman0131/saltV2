import { getFirestore, collection, addDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { MatchLoggingPort } from '@salt/domain';

export function createFirebaseMatchLoggingAdapter(): MatchLoggingPort {
  return {
    write(entry) {
      const db = getFirestore(getApp());
      // Fire-and-forget: failures are swallowed so the pipeline is never blocked by logging.
      addDoc(collection(db, 'canonMatchingLogs'), entry).catch(() => {});
      return Promise.resolve();
    },
  };
}
