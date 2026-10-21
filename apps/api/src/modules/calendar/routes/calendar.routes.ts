import { Router } from "express";
import { CalendarController } from "../controllers/calendar.controller.js";

export function createCalendarRouter(controller: CalendarController): Router {
  const router = Router();
  controller.registerRoutes(router);
  return router;
}
