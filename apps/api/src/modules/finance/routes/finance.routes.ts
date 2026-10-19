import { Router } from "express";
import type { FinanceController } from "../controllers/finance.controller.js";
export function createFinanceRouter(controller: FinanceController) {
  const router = Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  controller.registerRoutes(router);
  return router;
}
