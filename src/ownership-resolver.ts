import type { ChildSession, ChildSessionRegistry } from "./child-session.js";
import type { RootSessionResolver } from "./root-session-resolver.js";

export interface CreateChildOwnershipResolverOptions {
  readonly rootSessionResolver: RootSessionResolver;
  readonly registry: ChildSessionRegistry;
}

export interface ChildOwnershipResolver {
  isOwnedChild(input: { sessionId: string; parentId: string }): Promise<boolean>;
  isTrackedDescendant(sessionId: string): boolean;
}

export function createChildOwnershipResolver(
  options: CreateChildOwnershipResolverOptions,
): ChildOwnershipResolver {
  const rootSessionResolver = options.rootSessionResolver;
  const registry = options.registry;

  return {
    async isOwnedChild(input: { sessionId: string; parentId: string }): Promise<boolean> {
      if (input.sessionId === input.parentId) {
        return false;
      }

      const parent = registry.get(input.parentId);
      if (parent) {
        return parent.state !== "ignored" && parent.state !== "failed" && parent.state !== "closed";
      }

      const { rootSessionId } = await rootSessionResolver.resolve();
      return rootSessionId !== undefined && input.parentId === rootSessionId;
    },

    isTrackedDescendant(sessionId: string): boolean {
      return registry.isTrackedDescendant(sessionId);
    },
  };
}

export type { ChildSession };
