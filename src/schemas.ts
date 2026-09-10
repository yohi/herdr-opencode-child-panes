import { z } from "zod";

export const directionSchema = z.enum(["auto", "horizontal", "vertical"]);

export const agentSessionSchema = z.object({
  agent: z.string().min(1),
  session_id: z.string().min(1),
});

export const paneInfoSchema = z.object({
  id: z.string().min(1),
  agent_session: agentSessionSchema.optional(),
});

const paneLayoutChildSchema = z.object({
  id: z.string().min(1),
  direction: directionSchema.optional(),
});

export const paneLayoutSchema = z.object({
  paneId: z.string().min(1),
  direction: directionSchema.optional(),
  children: z.array(paneLayoutChildSchema).optional(),
});

export const splitPaneResponseSchema = z.object({
  id: z.string().min(1),
});
export type AgentSessionSchemaOutput = z.infer<typeof agentSessionSchema>;

export type DirectionSchemaOutput = z.infer<typeof directionSchema>;
export type PaneInfoSchemaOutput = z.infer<typeof paneInfoSchema>;
export type PaneLayoutChildSchemaOutput = z.infer<typeof paneLayoutChildSchema>;
export type PaneLayoutSchemaOutput = z.infer<typeof paneLayoutSchema>;
