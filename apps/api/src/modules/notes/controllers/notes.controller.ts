import type { Router } from "express";
import { z } from "zod";
import { BaseController } from "../../../core/controllers/base.controller.js";
import { requirePrincipal } from "../../../core/http/principal.js";
import { NoteDtoAdapter } from "../dto/adapter.js";
import { createNoteInputSchema } from "../dto/input.js";
import { NotesService } from "../services/notes.service.js";

export class NotesController extends BaseController<NotesService> {
  constructor(service: NotesService) { super(service); }

  registerRoutes(router: Router): void {
    router.post("/", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      const note = await this.service.create(ownerId, createNoteInputSchema.parse(req.body));
      res.status(201).json(NoteDtoAdapter.toOutput(note));
    });

    router.get("/:id", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      const id = z.uuid().parse(req.params.id);
      const note = await this.service.findById(ownerId, id);
      res.json(NoteDtoAdapter.toOutput(note));
    });
  }
}
