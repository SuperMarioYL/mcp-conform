/**
 * Spec barrel — the hard-coded conformance suite, versioned to the MCP spec.
 *
 * A custom spec-authoring DSL is explicitly out of scope for v0.1 (mvp_plan §6);
 * checks are plain TypeScript functions re-exported here.
 */
export const SPEC_VERSION = "0.1";

export { checkHandshake } from "./handshake.js";
export { checkTools } from "./tools.js";
export {
  checkOAuth,
  parseWwwAuthenticate,
  validateProtectedResourceMetadata,
} from "./oauth.js";
export type { OAuthProbeOptions } from "./oauth.js";
