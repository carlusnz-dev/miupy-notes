import type { Router } from "express";
import { z } from "zod";
import { BaseController } from "../../../core/controllers/base.controller.js";
import { requirePrincipal } from "../../../core/http/principal.js";
import { toOutput } from "../dto/adapter.js";
import { createAccountSchema, updateAccountSchema, createBankSchema, createTransactionSchema, pageQuerySchema, updateBankSchema, updateTransactionSchema, versionSchema } from "../dto/input.js";
import { FinanceService } from "../services/finance.service.js";
export class FinanceController extends BaseController<FinanceService> {
  constructor(service: FinanceService) { super(service); }
  registerRoutes(router: Router) {
    router.get("/balances", async (req, res) => { z.strictObject({}).parse(req.query); res.json(await this.service.balances(requirePrincipal(res.locals.principal).ownerId)); });
    router.get("/summary", async (req, res) => { z.strictObject({}).parse(req.query); res.json(await this.service.summary(requirePrincipal(res.locals.principal).ownerId)); });
    router.get("/export.csv", async (req, res) => {
      const { ownerId } = requirePrincipal(res.locals.principal);
      z.strictObject({}).parse(req.query);
      res.type("text/csv").set("Content-Disposition", 'attachment; filename="financas.csv"').set("Cache-Control", "no-store");
      try {
        for await (const chunk of this.service.csv(ownerId)) {
          if (res.destroyed) break;
          await new Promise<void>((resolve, reject) => res.write(chunk, error => error ? reject(error) : resolve()));
        }
        res.end();
      } catch (error) {
        if (res.headersSent) res.destroy();
        else throw error;
      }
    });
    for (const [path, kind, createSchema, updateSchema] of [
      ["/transactions", "transaction", createTransactionSchema, updateTransactionSchema],
      ["/banks", "bank", createBankSchema, updateBankSchema],
      ["/accounts", "account", createAccountSchema, updateAccountSchema],
    ] as const) {
      router.get(path, async (req, res) => {
        const page = await this.service.list(requirePrincipal(res.locals.principal).ownerId, kind, pageQuerySchema.parse(req.query));
        res.json({ items: page.items.map(toOutput), nextCursor: page.nextCursor });
      });
      router.post(path, async (req, res) => {
        res.status(201).json(toOutput(await this.service.create(requirePrincipal(res.locals.principal).ownerId, kind, createSchema.parse(req.body))));
      });
      router.get(path + "/:id", async (req, res) => {
        res.json(toOutput(await this.service.findById(requirePrincipal(res.locals.principal).ownerId, z.uuid().parse(req.params.id), kind)));
      });
      router.patch(path + "/:id", async (req, res) => {
        res.json(toOutput(await this.service.update(requirePrincipal(res.locals.principal).ownerId, z.uuid().parse(req.params.id), kind, updateSchema.parse(req.body))));
      });
      if (kind === "account") continue;
      router.delete(path + "/:id", async (req, res) => {
        await this.service.delete(requirePrincipal(res.locals.principal).ownerId, z.uuid().parse(req.params.id), kind, versionSchema.parse(req.body).version);
        res.status(204).end();
      });
    }
  }
}
