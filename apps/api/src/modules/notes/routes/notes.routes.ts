import { Router } from "express";
import { NotesController } from "../controllers/notes.controller.js";

export function createNotesRouter(controller: NotesController): Router {
  const router = Router();
  controller.registerRoutes(router);
  return router;
}
