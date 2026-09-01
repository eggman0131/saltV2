// Push-subscription module (issue #1145). The document id itself, composed in
// one place so the two live call sites (enable/disable in web-pwa) and the id
// scheme cannot drift apart. The rest of a push subscription — the endpoint,
// keys, `deviceHashFromEndpoint` — stays in web-pwa: it reads browser crypto and
// has no pure logic worth extracting here (CLAUDE.md Rule 1).
export { pushSubscriptionId } from './pushSubscriptionId.js';
