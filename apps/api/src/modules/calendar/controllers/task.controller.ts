import type { Router } from "express";
import { z } from "zod";
import { BaseController } from "../../../core/controllers/base.controller.js";
import { requirePrincipal } from "../../../core/http/principal.js";
import { TaskDtoAdapter } from "../dto/task-adapter.js";
import { createTaskInputSchema, deleteTaskQuerySchema, listTasksQuerySchema, updateTaskInputSchema } from "../dto/task-input.js";
import { TaskService } from "../services/task.service.js";

const idParam = (value: unknown) => z.uuid().parse(value);

export class TaskController extends BaseController<TaskService> {
  constructor(service: TaskService) { super(service); }

  registerRoutes(router: Router): void {
    const owner = (res: { locals: Record<string, unknown> }) => requirePrincipal(res.locals.principal).ownerId;

    router.get("/tasks", async (req, res) => {
      res.json(TaskDtoAdapter.toListOutput(await this.service.list(owner(res), listTasksQuerySchema.parse(req.query))));
    });
    router.post("/tasks", async (req, res) => {
      const { task, created } = await this.service.create(owner(res), createTaskInputSchema.parse(req.body));
      res.status(created ? 201 : 200).json(TaskDtoAdapter.toOutput(task));
    });
    router.get("/tasks/:id", async (req, res) => {
      res.json(TaskDtoAdapter.toOutput(await this.service.findById(owner(res), idParam(req.params.id))));
    });
    router.patch("/tasks/:id", async (req, res) => {
      res.json(TaskDtoAdapter.toOutput(await this.service.update(owner(res), idParam(req.params.id), updateTaskInputSchema.parse(req.body))));
    });
    router.delete("/tasks/:id", async (req, res) => {
      await this.service.delete(owner(res), idParam(req.params.id), deleteTaskQuerySchema.parse(req.query).version);
      res.status(204).end();
    });
  }
}
