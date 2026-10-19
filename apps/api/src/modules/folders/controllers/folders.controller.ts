import type { Router } from "express";
import { z } from "zod";
import { BaseController } from "../../../core/controllers/base.controller.js";
import { requirePrincipal } from "../../../core/http/principal.js";
import { FolderDtoAdapter } from "../dto/adapter.js";
import { createFolderInputSchema, updateFolderInputSchema } from "../dto/input.js";
import { FoldersService } from "../services/folders.service.js";

export class FoldersController extends BaseController<FoldersService> {
  constructor(service: FoldersService) { super(service); }

  registerRoutes(router: Router): void {
    router.get("/", async (_req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      res.json(FolderDtoAdapter.toListOutput(await this.service.list(ownerId)));
    });

    router.post("/", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      const folder = await this.service.create(ownerId, createFolderInputSchema.parse(req.body));
      res.status(201).json(FolderDtoAdapter.toOutput(folder));
    });

    router.patch("/:id", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      const id = z.uuid().parse(req.params.id);
      const folder = await this.service.update(ownerId, id, updateFolderInputSchema.parse(req.body));
      res.json(FolderDtoAdapter.toOutput(folder));
    });

  }
}
