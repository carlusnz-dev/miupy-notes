import { z } from "zod";

export const taskOutputSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  status: z.enum(["pending", "completed"]),
  completedAt: z.iso.datetime().nullable(),
  /** `true` quando a tarefa também existe no Google Tasks (sincronização opcional, desligada por padrão). */
  inGoogle: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.int().positive(),
});

export const taskListOutputSchema = z.object({ items: z.array(taskOutputSchema), nextCursor: z.string().nullable() });

export type TaskOutput = z.infer<typeof taskOutputSchema>;
export type TaskListOutput = z.infer<typeof taskListOutputSchema>;
