import type { Router } from "express";
import { z } from "zod";
import { BaseController } from "../../../core/controllers/base.controller.js";
import { requirePrincipal } from "../../../core/http/principal.js";
import { CalendarDtoAdapter } from "../dto/adapter.js";
import { authorizeGoogleInputSchema, connectGoogleInputSchema, createEventInputSchema, deleteEventQuerySchema, listEventsQuerySchema, updateEventInputSchema } from "../dto/input.js";
import { googleAuthorizationOutputSchema, googleStatusOutputSchema, googleSyncOutputSchema } from "../dto/output.js";
import { CalendarService } from "../services/calendar.service.js";
import type { GoogleIntegrationService } from "../services/google-integration.service.js";

const idParam = (value: unknown) => z.uuid().parse(value);
const reflectionQuerySchema = z.strictObject({ keepRemote: z.enum(["true", "false"]).default("false") });

export class CalendarController extends BaseController<CalendarService> {
  constructor(service: CalendarService, private readonly google: GoogleIntegrationService) { super(service); }

  registerRoutes(router: Router): void {
    const owner = (res: { locals: Record<string, unknown> }) => requirePrincipal(res.locals.principal).ownerId;

    router.get("/events", async (req, res) => {
      res.json(CalendarDtoAdapter.toListOutput(await this.service.list(owner(res), listEventsQuerySchema.parse(req.query))));
    });
    router.post("/events", async (req, res) => {
      const { event, created } = await this.service.create(owner(res), createEventInputSchema.parse(req.body));
      res.status(created ? 201 : 200).json(CalendarDtoAdapter.toOutput(event));
    });
    router.get("/events/:id", async (req, res) => {
      res.json(CalendarDtoAdapter.toOutput(await this.service.findById(owner(res), idParam(req.params.id))));
    });
    router.patch("/events/:id", async (req, res) => {
      res.json(CalendarDtoAdapter.toOutput(await this.service.update(owner(res), idParam(req.params.id), updateEventInputSchema.parse(req.body))));
    });
    router.delete("/events/:id", async (req, res) => {
      await this.service.delete(owner(res), idParam(req.params.id), deleteEventQuerySchema.parse(req.query).version);
      res.status(204).end();
    });

    router.post("/events/:id/google-reflection", async (req, res) => {
      z.strictObject({}).parse(req.body ?? {});
      res.json(CalendarDtoAdapter.toOutput(await this.google.reflect(owner(res), idParam(req.params.id))));
    });
    router.delete("/events/:id/google-reflection", async (req, res) => {
      const { keepRemote } = reflectionQuerySchema.parse(req.query);
      res.json(CalendarDtoAdapter.toOutput(await this.google.unreflect(owner(res), idParam(req.params.id), { keepRemote: keepRemote === "true" })));
    });

    router.get("/google", async (_req, res) => { res.json(googleStatusOutputSchema.parse(await this.google.status(owner(res)))); });
    router.post("/google/authorization", async (req, res) => {
      res.json(googleAuthorizationOutputSchema.parse(await this.google.authorize(owner(res), authorizeGoogleInputSchema.parse(req.body))));
    });
    router.post("/google/connection", async (req, res) => {
      res.json(googleStatusOutputSchema.parse(await this.google.connect(owner(res), connectGoogleInputSchema.parse(req.body))));
    });
    router.delete("/google/connection", async (_req, res) => { res.json(googleStatusOutputSchema.parse(await this.google.disconnect(owner(res)))); });
    router.post("/google/sync", async (req, res) => {
      z.strictObject({}).parse(req.body ?? {});
      res.json(googleSyncOutputSchema.parse(await this.google.sync(owner(res))));
    });
  }
}
