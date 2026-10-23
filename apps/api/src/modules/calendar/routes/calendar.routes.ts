import { Router } from "express";
import { CalendarController } from "../controllers/calendar.controller.js";
import type { TaskController } from "../controllers/task.controller.js";

export function createCalendarRouter(controller: CalendarController, tasks?: TaskController): Router {
  const router = Router();
  controller.registerRoutes(router);
  tasks?.registerRoutes(router);
  return router;
}
