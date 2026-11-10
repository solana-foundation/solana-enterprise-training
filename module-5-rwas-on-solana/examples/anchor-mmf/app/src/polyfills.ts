// Anchor and web3.js expect Node's Buffer. Imported first from main.tsx so it
// is in place before either library loads.
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: { env: Record<string, string> } };
g.Buffer ??= Buffer;
g.process ??= { env: {} };
