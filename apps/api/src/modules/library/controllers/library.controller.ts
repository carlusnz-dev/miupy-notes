import type { Router } from "express";
import { z } from "zod";
import { BaseController } from "../../../core/controllers/base.controller.js";
import { requirePrincipal } from "../../../core/http/principal.js";
import { LibraryDtoAdapter } from "../dto/adapter.js";
import { createLibraryInputSchema, updateLibraryInputSchema, listLibraryQuerySchema } from "../dto/input.js";
import { LibraryService } from "../services/library.service.js";

export class LibraryController extends BaseController<LibraryService> {
  constructor(service: LibraryService) { super(service); }
  registerRoutes(router: Router): void {
    router.get("/", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      res.json(LibraryDtoAdapter.toListOutput(await this.service.list(ownerId, listLibraryQuerySchema.parse(req.query))));
    });
    router.post("/", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      res.status(201).json(LibraryDtoAdapter.toOutput(await this.service.create(ownerId, createLibraryInputSchema.parse(req.body))));
    });
    router.get("/:id", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      res.json(LibraryDtoAdapter.toOutput(await this.service.findById(ownerId, z.uuid().parse(req.params.id))));
    });
    router.patch("/:id", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      res.json(LibraryDtoAdapter.toOutput(await this.service.update(ownerId, z.uuid().parse(req.params.id), updateLibraryInputSchema.parse(req.body))));
    });
    router.delete("/:id", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      await this.service.delete(ownerId, z.uuid().parse(req.params.id)); res.status(204).end();
    });
  }
}
