import { Router } from "express";
import type { HabitsController } from "../controllers/habits.controller.js";
export function createHabitsRouter(controller: HabitsController): Router {
  const router = Router(); controller.registerRoutes(router); return router;
}
