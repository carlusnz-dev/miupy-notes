import type { Router } from "express";

export abstract class BaseController<TService> {
  protected constructor(protected readonly service: TService) {}
  abstract registerRoutes(router: Router): void;
}
