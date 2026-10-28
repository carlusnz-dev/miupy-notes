import type { Router } from "express";
import { z } from "zod";
import { BaseController } from "../../../core/controllers/base.controller.js";
import { requirePrincipal } from "../../../core/http/principal.js";
import { HabitDtoAdapter } from "../dto/adapter.js";
import {
  createHabitInputSchema, historyQuerySchema, listHabitsQuerySchema, occurrenceDateSchema, occurrenceStatusInputSchema, occurrencesQuerySchema,
  pauseInputSchema, resumeInputSchema, updateHabitInputSchema,
} from "../dto/input.js";
import type { SettingsOutput } from "../dto/output.js";
import { HabitsService } from "../services/habits.service.js";

const id = (value: unknown) => z.uuid().parse(value);

export class HabitsController extends BaseController<HabitsService> {
  constructor(service: HabitsService, private readonly settings: SettingsOutput) { super(service); }
  registerRoutes(router: Router): void {
    const owner = (res: { locals: Record<string, unknown> }) => requirePrincipal(res.locals.principal).ownerId;
    // Rotas estáticas antes de `/:id`.
    router.get("/occurrences", async (req, res) => res.json(HabitDtoAdapter.toOccurrences(await this.service.occurrences(owner(res), occurrencesQuerySchema.parse(req.query)))));
    router.get("/history", async (req, res) => res.json(HabitDtoAdapter.toHistory(await this.service.history(owner(res), historyQuerySchema.parse(req.query)))));
    router.get("/xp", async (_req, res) => res.json(HabitDtoAdapter.toXp(await this.service.xp(owner(res)))));
    router.get("/settings", (_req, res) => { owner(res); res.json(this.settings); });
    router.get("/", async (req, res) => res.json(HabitDtoAdapter.toListOutput(await this.service.list(owner(res), listHabitsQuerySchema.parse(req.query).trash))));
    router.post("/", async (req, res) => res.status(201).json(HabitDtoAdapter.toOutput(await this.service.create(owner(res), createHabitInputSchema.parse(req.body)))));
    router.get("/:id", async (req, res) => res.json(HabitDtoAdapter.toOutput(await this.service.findById(owner(res), id(req.params.id)))));
    router.patch("/:id", async (req, res) => res.json(HabitDtoAdapter.toOutput(await this.service.update(owner(res), id(req.params.id), updateHabitInputSchema.parse(req.body)))));
    router.post("/:id/pause", async (req, res) => res.json(HabitDtoAdapter.toOutput(await this.service.pause(owner(res), id(req.params.id), pauseInputSchema.parse(req.body)))));
    router.post("/:id/resume", async (req, res) => res.json(HabitDtoAdapter.toOutput(await this.service.resume(owner(res), id(req.params.id), resumeInputSchema.parse(req.body)))));
    router.post("/:id/restore", async (req, res) => res.json(HabitDtoAdapter.toOutput(await this.service.restore(owner(res), id(req.params.id)))));
    router.delete("/:id", async (req, res) => res.json(HabitDtoAdapter.toOutput(await this.service.remove(owner(res), id(req.params.id)))));
    router.put("/:id/occurrences/:date", async (req, res) => {
      const { status } = occurrenceStatusInputSchema.parse(req.body);
      res.json(await this.service.setOccurrence(owner(res), id(req.params.id), occurrenceDateSchema.parse(req.params.date), status));
    });
  }
}
