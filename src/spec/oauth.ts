/**
 * OAuth (auth-axis) spec checks — Zero-Touch OAuth *discovery shape* only.
 *
 * Scope per mvp_plan §6: v0.1 asserts the SHAPE of the discovery surface, NOT a
 * live end-to-end token grant. Two things are checked when an HTTP base URL is
 * known:
 *
 *   1. `.well-known/oauth-protected-resource` — RFC 9728 Protected Resource
 *      Metadata: a JSON document with at least `resource` and
 *      `authorization_servers`.
 *   2. The `WWW-Authenticate` challenge on a 401 — must be a `Bearer` challenge
 *      and, per RFC 9728 §5.1, should carry a `resource_metadata` parameter
 *      pointing at the metadata document above.
 *
 * stdio servers have no HTTP surface to probe, so for the canonical stdio path
 * the auth axis resolves to `skip` (optional, yellow in the matrix) rather than
 * `fail`. This keeps the echo-fixture demo honest: behavior is green, auth is a
 * yellow "not applicable over stdio" cell.
 */
import type { Axis, CheckResult, ClientId } from "../adapters/types.js";

const AXIS: Axis = "auth";

function row(
  client: ClientId,
  check_id: string,
  status: CheckResult["status"],
  detail: string
): CheckResult {
  return { client, axis: AXIS, check_id, status, detail };
}

export interface OAuthProbeOptions {
  /**
   * HTTP(S) base URL of the server's resource, if it exposes one. When absent
   * (the stdio case) the auth checks short-circuit to `skip`.
   */
  baseUrl?: string;
  /** Injectable fetch for testing; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * Per-probe timeout in milliseconds. Each `fetchImpl` call is wrapped in an
   * `AbortController` + `setTimeout` so a non-responsive HTTP resource (one
   * that accepts the TCP connection but never responds) is turned into a `fail`
   * row ("probe timed out after Nms") instead of stalling the CLI forever —
   * the §3 "sub-30s total run" contract. Defaults to 10000 (two probes bound
   * the worst case at ~20s, under the 30s contract).
   */
  probeTimeoutMs?: number;
}

/** Parse a WWW-Authenticate Bearer challenge into its parameters. */
export function parseWwwAuthenticate(header: string): {
  scheme: string;
  params: Record<string, string>;
} {
  const trimmed = header.trim();
  const spaceIdx = trimmed.indexOf(" ");
  const scheme = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);
  const params: Record<string, string> = {};
  // Match key="value" or key=value pairs.
  const re = /([a-zA-Z0-9_-]+)\s*=\s*("([^"]*)"|[^,\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    params[m[1]!.toLowerCase()] = m[3] !== undefined ? m[3] : m[2]!;
  }
  return { scheme, params };
}

/** True iff s is a parseable absolute http(s) URL. RFC 9728 `resource` and
 * `authorization_servers` entries (and the WWW-Authenticate `resource_metadata`
 * param) are URLs, so a non-URL value is malformed discovery metadata, not a
 * passing shape — a conformance tool must not false-pass it. */
function isUrl(s: unknown): s is string {
  if (typeof s !== "string" || s.length === 0) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Thrown when an OAuth HTTP probe exceeds its per-probe timeout. The §3
 * "sub-30s total run" contract requires that a non-responsive HTTP resource
 * (one that accepts the TCP connection but never responds) becomes a `fail`
 * auth row instead of an indefinite CLI stall. Only `client.connect` was
 * previously wrapped in a timeout; the two `fetchImpl` calls in `checkOAuth`
 * were not, so a hanging resource stalled forever with no matrix and no exit.
 */
class ProbeTimeoutError extends Error {
  constructor(ms: number) {
    super(`probe timed out after ${ms}ms`);
    this.name = "ProbeTimeoutError";
  }
}

/**
 * Run `fetchImpl(url)` bounded by a per-probe timeout. A single timer both
 * aborts the in-flight request (so a cooperative `fetch` releases its socket)
 * and rejects the race with a {@link ProbeTimeoutError}. The fetch promise is
 * also `.catch`-guarded so an abort that fires after the race has settled on
 * the timeout does not surface as an unhandled rejection (and a non-cooperative
 * fetch that ignores the signal is still bounded by the race).
 */
function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  probeTimeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProbeTimeoutError(probeTimeoutMs));
    }, probeTimeoutMs);
  });
  const fetchP = fetchImpl(url, { ...init, signal: controller.signal });
  // Swallow the eventual AbortError once the race has settled on the timeout.
  fetchP.catch(() => {});
  return Promise.race([fetchP, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Validate the SHAPE of a Protected Resource Metadata document (RFC 9728). */
export function validateProtectedResourceMetadata(doc: unknown): {
  ok: boolean;
  detail: string;
} {
  if (!doc || typeof doc !== "object") {
    return { ok: false, detail: "metadata is not a JSON object" };
  }
  const d = doc as Record<string, unknown>;
  if (!isUrl(d.resource)) {
    return {
      ok: false,
      detail: `metadata "resource" is not a valid http(s) URL (RFC 9728): ${JSON.stringify(d.resource)}`,
    };
  }
  if (
    !Array.isArray(d.authorization_servers) ||
    d.authorization_servers.length === 0 ||
    !d.authorization_servers.every((s) => isUrl(s))
  ) {
    return {
      ok: false,
      detail:
        'metadata "authorization_servers" must be a non-empty http(s) URL[] (RFC 9728)',
    };
  }
  return {
    ok: true,
    detail: `resource="${d.resource}", ${d.authorization_servers.length} authorization_server(s)`,
  };
}

/**
 * Run the auth-axis checks. For stdio targets (no `baseUrl`) these are `skip`.
 * For HTTP targets they probe the discovery surface SHAPE.
 */
export async function checkOAuth(
  client: ClientId,
  opts: OAuthProbeOptions = {}
): Promise<CheckResult[]> {
  const { baseUrl } = opts;

  if (!baseUrl) {
    return [
      row(
        client,
        "oauth.protected_resource_metadata",
        "skip",
        "no HTTP surface (stdio transport): OAuth discovery is optional/not applicable"
      ),
      row(
        client,
        "oauth.www_authenticate",
        "skip",
        "no HTTP surface (stdio transport): WWW-Authenticate challenge not applicable"
      ),
    ];
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const probeTimeoutMs = opts.probeTimeoutMs ?? 10_000;
  const results: CheckResult[] = [];

  // Parse the HTTP origin up front. A malformed base URL (e.g. missing scheme)
  // throws ERR_INVALID_URL outside the per-probe try/catch blocks below, which
  // would reject the whole run and crash the CLI with no matrix. Fail both
  // auth rows gracefully instead — the CI contract is "exit 1 on a fail row".
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch (err) {
    const detail = `invalid base URL "${baseUrl}": ${errMessage(err)}`;
    results.push(
      row(client, "oauth.protected_resource_metadata", "fail", detail)
    );
    results.push(row(client, "oauth.www_authenticate", "fail", detail));
    return results;
  }

  // --- 1. Protected Resource Metadata ---
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource`;
  try {
    const res = await fetchWithTimeout(
      fetchImpl,
      metadataUrl,
      { headers: { accept: "application/json" } },
      probeTimeoutMs
    );
    if (!res.ok) {
      results.push(
        row(
          client,
          "oauth.protected_resource_metadata",
          "fail",
          `GET ${metadataUrl} -> HTTP ${res.status} (expected 200 with metadata)`
        )
      );
    } else {
      const doc = await res.json().catch(() => undefined);
      const check = validateProtectedResourceMetadata(doc);
      results.push(
        row(
          client,
          "oauth.protected_resource_metadata",
          check.ok ? "pass" : "fail",
          check.ok
            ? `valid Protected Resource Metadata: ${check.detail}`
            : `invalid Protected Resource Metadata: ${check.detail}`
        )
      );
    }
  } catch (err) {
    results.push(
      row(
        client,
        "oauth.protected_resource_metadata",
        "fail",
        err instanceof ProbeTimeoutError
          ? `metadata ${err.message}`
          : `metadata probe threw: ${errMessage(err)}`
      )
    );
  }

  // --- 2. WWW-Authenticate challenge shape on a 401 ---
  try {
    const res = await fetchWithTimeout(
      fetchImpl,
      baseUrl,
      { headers: { accept: "application/json" } },
      probeTimeoutMs
    );
    const challenge = res.headers.get("www-authenticate");
    if (res.status !== 401) {
      results.push(
        row(
          client,
          "oauth.www_authenticate",
          res.status >= 200 && res.status < 300 ? "skip" : "fail",
          res.status >= 200 && res.status < 300
            ? `${baseUrl} -> HTTP ${res.status} (unauthenticated access allowed; no challenge to inspect)`
            : `${baseUrl} -> HTTP ${res.status} (expected 401 to inspect WWW-Authenticate)`
        )
      );
    } else if (!challenge) {
      results.push(
        row(
          client,
          "oauth.www_authenticate",
          "fail",
          "401 response carried no WWW-Authenticate header"
        )
      );
    } else {
      const { scheme, params } = parseWwwAuthenticate(challenge);
      if (scheme !== "bearer") {
        results.push(
          row(
            client,
            "oauth.www_authenticate",
            "fail",
            `WWW-Authenticate scheme is "${scheme}" (expected "Bearer")`
          )
        );
      } else if (!params.resource_metadata) {
        results.push(
          row(
            client,
            "oauth.www_authenticate",
            "fail",
            'Bearer challenge missing "resource_metadata" parameter (RFC 9728 §5.1)'
          )
        );
      } else if (!isUrl(params.resource_metadata)) {
        results.push(
          row(
            client,
            "oauth.www_authenticate",
            "fail",
            `Bearer challenge "resource_metadata" is not a valid http(s) URL (RFC 9728): ${JSON.stringify(params.resource_metadata)}`
          )
        );
      } else {
        results.push(
          row(
            client,
            "oauth.www_authenticate",
            "pass",
            `Bearer challenge points to resource_metadata=${params.resource_metadata}`
          )
        );
      }
    }
  } catch (err) {
    results.push(
      row(
        client,
        "oauth.www_authenticate",
        "fail",
        err instanceof ProbeTimeoutError
          ? `WWW-Authenticate ${err.message}`
          : `WWW-Authenticate probe threw: ${errMessage(err)}`
      )
    );
  }

  return results;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
