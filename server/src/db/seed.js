// npm run seed
// Writes the fleet catalogue to Firestore so the "units" collection exists
// before the first run. Safe to run more than once.
import { config } from '../config.js';
import { createStore } from './store.js';
import { FLEET, SITES } from '../sim/catalog.js';

const store = await createStore(config);
if (store.mode !== 'firebase') {
  console.error('Firebase is not configured. Add your credentials to server/.env and run again.');
  process.exit(1);
}
await store.syncUnits(FLEET.map((u) => {
  const s = SITES.find((x) => x.id === u.site);
  return { ...u, siteName: s.name, city: s.city };
}));
const batch = store.db.batch();
SITES.forEach((s) => batch.set(store.db.collection('sites').doc(s.id), s));
await batch.commit();
console.log(`Seeded ${FLEET.length} compressors and ${SITES.length} sites into Firestore.`);
process.exit(0);
