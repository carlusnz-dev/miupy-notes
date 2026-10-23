import { Router } from "express";
import type { LibraryController } from "../controllers/library.controller.js";
export function createLibraryRouter(controller: LibraryController): Router {
  const router = Router(); controller.registerRoutes(router); return router;
}
