import { z } from "zod";

export const directionSchema = z.enum(["auto", "right", "down"]);
export const paneLayoutDirectionSchema = z.enum(["right", "down"]);

export const agentSessionSchema = z.object({
  agent: z.string().min(1),
  value: z.string().min(1),
});

export const paneInfoSchema = z.object({
  pane_id: z.string().min(1),
  agent: z.string().min(1).optional(),
  agent_session: agentSessionSchema.optional(),
});

export const paneInfoResponseSchema = z.object({
  result: z.object({
    pane: paneInfoSchema,
  }),
});

const paneLayoutAreaSchema = z.object({
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});

const paneLayoutPaneSchema = z.object({
  pane_id: z.string().min(1),
  focused: z.boolean(),
  rect: paneLayoutAreaSchema.extend({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  }),
});

const paneLayoutSplitSchema = z.object({
  id: z.string().min(1),
  direction: paneLayoutDirectionSchema,
  ratio: z.number(),
  rect: paneLayoutAreaSchema.extend({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  }),
});

export const paneLayoutSchema = z.object({
  result: z.object({
    layout: z.object({
      area: paneLayoutAreaSchema,
      panes: z.array(paneLayoutPaneSchema),
      splits: z.array(paneLayoutSplitSchema),
    }),
  }),
});

export const splitPaneResponseSchema = z.object({
  result: z.object({
    pane: paneInfoSchema,
  }),
});

export const sessionCreatedPropertiesSchema = z.object({
  info: z.object({
    id: z.string().min(1),
    parentID: z.string().min(1).optional(),
  }),
});

export const sessionDeletedPropertiesSchema = z.object({
  info: z.object({
    id: z.string().min(1),
  }),
});

export const sessionStatusPropertiesSchema = z.object({
  sessionID: z.string().min(1),
  status: z.looseObject({}),
});

export const sessionIdlePropertiesSchema = z.object({
  sessionID: z.string().min(1),
});

export const messageUpdatedPropertiesSchema = z.object({
  info: z.looseObject({
    sessionID: z.string().min(1),
  }),
});

export const messagePartUpdatedPropertiesSchema = z.object({
  part: z.looseObject({
    sessionID: z.string().min(1),
  }),
});

export const messagePartDeltaPropertiesSchema = z.object({
  sessionID: z.string().min(1),
  messageID: z.string().min(1),
  partID: z.string().min(1),
  field: z.string().min(1),
  delta: z.string(),
});

export type AgentSessionSchemaOutput = z.infer<typeof agentSessionSchema>;

export type DirectionSchemaOutput = z.infer<typeof directionSchema>;
export type PaneLayoutDirectionSchemaOutput = z.infer<typeof paneLayoutDirectionSchema>;
export type PaneInfoSchemaOutput = z.infer<typeof paneInfoSchema>;
export type PaneLayoutSchemaOutput = z.infer<typeof paneLayoutSchema>;
