import type { Router } from "express";
import { z } from "zod";
import { BaseController } from "../../../core/controllers/base.controller.js";
import { requirePrincipal } from "../../../core/http/principal.js";
import { normalizeTimes } from "../domain/event-time.js";
import { AppError } from "../../../core/domain/app-error.js";
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
      const input = createEventInputSchema.parse(req.body);
      const { event, created } = await this.service.create(owner(res), input);
      const saved = input.sendToGoogle ? await this.google.reflect(owner(res), event.id) : event;
      res.status(created ? 201 : 200).json(CalendarDtoAdapter.toOutput(saved));
    });
    router.get("/events/:id", async (req, res) => {
      res.json(CalendarDtoAdapter.toOutput(await this.service.findById(owner(res), idParam(req.params.id))));
    });
    router.patch("/events/:id", async (req, res) => {
      const ownerId = owner(res), id = idParam(req.params.id), input = updateEventInputSchema.parse(req.body);
      const current = await this.service.findById(ownerId, id);
      let saved;
      if (current.source === "google") saved = await this.google.updateMirror(ownerId, id, input);
      else {
        const send = input.sendToGoogle === true || current.reflection !== null;
        // Reenvio de gravação local cujo envio ao Google falhou: não repete a edição nem perde a intenção.
        if (send && current.version !== input.version) {
          const times = normalizeTimes({ allDay: input.allDay ?? current.allDay, start: input.start ?? current.start, end: input.end ?? current.end, timeZone: input.timeZone === undefined ? current.timeZone : input.timeZone });
          const fields = { ...input, ...times };
          const same = (["title", "description", "location", "allDay", "start", "end", "timeZone", "links"] as const).every((key) => fields[key] === undefined || JSON.stringify(fields[key]) === JSON.stringify(current[key]));
          if (!same) throw new AppError(409, "CONFLICT", "O evento mudou. Recarregue antes de enviar.");
          saved = current.reflection?.reflectedVersion === current.version ? current : await this.google.reflect(ownerId, id);
        } else {
          saved = await this.service.update(ownerId, id, input);
          if (send) saved = await this.google.reflect(ownerId, id);
        }
      }
      res.json(CalendarDtoAdapter.toOutput(saved));
    });
    router.delete("/events/:id", async (req, res) => {
      const ownerId = owner(res), id = idParam(req.params.id), version = deleteEventQuerySchema.parse(req.query).version;
      const current = await this.service.findById(ownerId, id);
      if (current.source === "google") await this.google.deleteMirror(ownerId, id, version);
      else if (current.reflection) {
        if (current.version !== version) throw new AppError(409, "CONFLICT", "O evento mudou. Recarregue antes de excluir.");
        await this.google.deleteReflected(ownerId, id, version);
      } else await this.service.delete(ownerId, id, version);
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
