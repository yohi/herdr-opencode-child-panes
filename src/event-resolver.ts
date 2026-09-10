import type { Event } from "@opencode-ai/sdk";
import {
  messagePartDeltaPropertiesSchema,
  messagePartUpdatedPropertiesSchema,
  messageUpdatedPropertiesSchema,
  sessionCreatedPropertiesSchema,
  sessionDeletedPropertiesSchema,
  sessionIdlePropertiesSchema,
  sessionStatusPropertiesSchema,
} from "./schemas.js";

export type ResolvedSessionId = string | undefined;

const SESSION_BY_INFO_ID = new Set(["session.created", "session.deleted"]);
const SESSION_BY_PROPERTIES = new Set(["session.status", "session.idle"]);
const SESSION_BY_MESSAGE_INFO = new Set(["message.updated"]);
const SESSION_BY_MESSAGE_PART_UPDATED = new Set(["message.part.updated"]);
const SESSION_BY_MESSAGE_PART_DELTA = new Set(["message.part.delta"]);
const KNOWN_SESSION_EVENT_TYPES = new Set([
  ...SESSION_BY_INFO_ID,
  ...SESSION_BY_PROPERTIES,
  ...SESSION_BY_MESSAGE_INFO,
  ...SESSION_BY_MESSAGE_PART_UPDATED,
  ...SESSION_BY_MESSAGE_PART_DELTA,
]);

export function resolveSessionId(event: Event): ResolvedSessionId {
  const eventType: string = event.type;
  if (!KNOWN_SESSION_EVENT_TYPES.has(eventType)) {
    return undefined;
  }

  const properties: unknown = event.properties;
  if (typeof properties !== "object" || properties === null) {
    return undefined;
  }

  if (SESSION_BY_INFO_ID.has(eventType)) {
    const schema =
      eventType === "session.created"
        ? sessionCreatedPropertiesSchema
        : sessionDeletedPropertiesSchema;
    const parsed = schema.safeParse(properties);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data.info.id;
  }
  if (SESSION_BY_PROPERTIES.has(eventType)) {
    const schema =
      eventType === "session.status" ? sessionStatusPropertiesSchema : sessionIdlePropertiesSchema;
    const parsed = schema.safeParse(properties);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data.sessionID;
  }
  if (SESSION_BY_MESSAGE_INFO.has(eventType)) {
    const parsed = messageUpdatedPropertiesSchema.safeParse(properties);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data.info.sessionID;
  }
  if (SESSION_BY_MESSAGE_PART_DELTA.has(eventType)) {
    const parsed = messagePartDeltaPropertiesSchema.safeParse(properties);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data.sessionID;
  }
  if (SESSION_BY_MESSAGE_PART_UPDATED.has(eventType)) {
    const parsed = messagePartUpdatedPropertiesSchema.safeParse(properties);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data.part.sessionID;
  }
  return undefined;
}
