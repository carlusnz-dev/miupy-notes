import { z } from "zod";

const title = z.string().trim().min(1).max(200);
const description = z.string().max(8_000);
const dueDate = z.string().min(10).max(10).nullable();
const dueTime = z.string().min(5).max(5).nullable();
const status = z.enum(["pending", "completed"]);

export const createTaskInputSchema = z.strictObject({
  /** UUID gerado pelo cliente: repetir o mesmo envio não cria outra tarefa. */
  id: z.uuid().optional(),
  title,
  description: description.default(""),
  dueDate: dueDate.default(null),
  dueTime: dueTime.default(null),
  status: status.default("pending"),
});

export const updateTaskInputSchema = z.strictObject({
  version: z.int().positive(),
  title: title.optional(),
  description: description.optional(),
  dueDate: dueDate.optional(),
  dueTime: dueTime.optional(),
  status: status.optional(),
}).refine((input) => Object.keys(input).some((key) => key !== "version"));

export const listTasksQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: status.optional(),
});

export const deleteTaskQuerySchema = z.strictObject({ version: z.coerce.number().int().positive() });

export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
