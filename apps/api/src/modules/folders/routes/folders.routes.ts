import { Router } from "express";
import { FoldersController } from "../controllers/folders.controller.js";

export function createFoldersRouter(controller: FoldersController): Router {
  const router = Router();
  controller.registerRoutes(router);
  return router;
}
