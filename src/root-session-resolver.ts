import type { HerdrClient, PaneInfo } from "./types.js";

const DEFAULT_CACHE_TTL_MS = 750;
const OPCODE_AGENT = "opencode";

/**
 * Result of resolving the root OpenCode session associated with the caller
 * Herdr pane. `rootSessionId` is `undefined` whenever the pane metadata does
 * not report a usable OpenCode root session.
 */
export interface ResolvedRootSession {
  readonly rootSessionId: string | undefined;
}

/**
 * Resolves the current root OpenCode session from the caller Herdr pane,
 * caching the result for a short TTL to avoid invoking Herdr on every event.
 */
export interface RootSessionResolver {
  /**
   * Resolve the current root OpenCode session for the configured pane.
   * Returns the cached value if the cache has not expired.
   */
  resolve(): Promise<ResolvedRootSession>;
}

/**
 * Options for creating a {@link RootSessionResolver}.
 */
export interface CreateRootSessionResolverOptions {
  /** The caller Herdr pane to inspect. */
  readonly paneId: string;
  /** Adapter for invoking Herdr CLI commands. */
  readonly herdrClient: HerdrClient;
  /** Cache TTL in milliseconds. Defaults to 750 ms. */
  readonly cacheTtlMs?: number;
  /** Clock source; defaults to `Date.now`. Useful for tests. */
  readonly now?: () => number;
}

interface CacheEntry {
  readonly resolved: ResolvedRootSession;
  readonly timestamp: number;
}

function isOpenCodeRootSession(pane: PaneInfo): ResolvedRootSession {
  const agentSession = pane.agent_session;
  if (agentSession?.agent !== OPCODE_AGENT) {
    return { rootSessionId: undefined };
  }
  const sessionId = agentSession.value;
  if (!sessionId) {
    return { rootSessionId: undefined };
  }
  return { rootSessionId: sessionId };
}

export function createRootSessionResolver(
  options: CreateRootSessionResolverOptions,
): RootSessionResolver {
  const paneId = options.paneId;
  const herdrClient = options.herdrClient;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;

  let cache: CacheEntry | undefined;

  async function fetchRootSession(): Promise<ResolvedRootSession> {
    const pane = await herdrClient.getPane(paneId);
    if (!pane) {
      return { rootSessionId: undefined };
    }
    return isOpenCodeRootSession(pane);
  }

  return {
    async resolve(): Promise<ResolvedRootSession> {
      const nowMs = now();
      if (cache && nowMs - cache.timestamp < cacheTtlMs) {
        return cache.resolved;
      }

      const resolved = await fetchRootSession();
      cache = { resolved, timestamp: now() };
      return resolved;
    },
  };
}
