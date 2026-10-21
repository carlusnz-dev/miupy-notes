import type { Router } from "express";
import { z } from "zod";
import { BaseController } from "../../../core/controllers/base.controller.js";
import { requirePrincipal } from "../../../core/http/principal.js";
import { NoteDtoAdapter } from "../dto/adapter.js";
import { noteSummaryQuerySchema, createNoteInputSchema, listNotesQuerySchema, updateNoteInputSchema } from "../dto/input.js";
import { NotesService } from "../services/notes.service.js";
import { noteMetadataListOutputSchema, noteSummaryOutputSchema } from "../dto/output.js";

export class NotesController extends BaseController<NotesService> {
  constructor(service: NotesService) { super(service); }

  registerRoutes(router: Router): void {
    router.get("/", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      const page = await this.service.list(ownerId, listNotesQuerySchema.parse(req.query));
      res.json(NoteDtoAdapter.toListOutput(page));
    });

    router.get("/metadata", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      const page = await this.service.listMetadata(ownerId, listNotesQuerySchema.parse(req.query));
      res.json(noteMetadataListOutputSchema.parse(page));
    });

    router.get("/summary", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      res.json(noteSummaryOutputSchema.parse(await this.service.summary(ownerId, noteSummaryQuerySchema.parse(req.query))));
    });

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

    router.patch("/:id", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      const id = z.uuid().parse(req.params.id);
      const note = await this.service.update(ownerId, id, updateNoteInputSchema.parse(req.body));
      res.json(NoteDtoAdapter.toOutput(note));
    });

    router.delete("/:id", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      await this.service.delete(ownerId, z.uuid().parse(req.params.id));
      res.status(204).end();
    });
  }
}
