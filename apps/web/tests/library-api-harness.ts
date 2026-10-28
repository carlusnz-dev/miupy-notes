// Servidor sintético exclusivo de validação. Não é importado pelo app nem pelo servidor de produção.
import { randomUUID } from "node:crypto";
import express from "express";
import { createApp } from "../../api/src/app.js";
import { AppError } from "../../api/src/core/domain/app-error.js";
import { LibraryItem } from "../../api/src/modules/library/domain/library-item.js";
import { LibraryController } from "../../api/src/modules/library/controllers/library.controller.js";
import { createLibraryInputSchema } from "../../api/src/modules/library/dto/input.js";
import { MemoryLibraryRepository } from "../../api/src/modules/library/repository/memory-library.repository.js";
import { LibraryServiceImpl } from "../../api/src/modules/library/services/library.service.impl.js";
import { createLibraryRouter } from "../../api/src/modules/library/routes/library.routes.js";

const repo = new MemoryLibraryRepository();
const samples = [
  { kind: "book", title: "O jardim das horas", creator: "Clara Andrade", year: 2024, status: "in_progress", tags: ["ficção"], comment: "Uma casa, muitas histórias para descobrir.", rating: 4.5 },
  { kind: "film", title: "Depois da chuva", creator: "Luís Monteiro", year: 2023, status: "completed", rating: 5, tags: ["favoritos"] },
  { kind: "music", title: "Entre marés", creator: "Marina Luz", year: 2025, status: "completed", rating: 4, tags: ["para ouvir de novo"] },
  { kind: "book", title: "Atlas dos lugares possíveis", creator: "Rafael Costa", status: "wanted", tags: ["viagens"] },
  { kind: "film", title: "Uma cidade em silêncio", creator: "Ana Ribeiro", status: "wanted", year: 2026 },
  { kind: "music", title: "Pequenos universos", creator: "Duo Horizonte", status: "abandoned", rating: 0 },
];
const stamp = "2026-10-23T12:00:00.000Z";
for (let index = 0; index < 28; index++) {
  const input = createLibraryInputSchema.parse(index < samples.length ? samples[index] : { kind: "book", title: `Caderno de viagens ${index - 5}`, creator: "Acervo sintético", status: "wanted" });
  await repo.create(new LibraryItem("synthetic-owner", { ...input, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, createdAt: stamp, updatedAt: stamp, version: 1 }));
}
const app = createApp({
  authenticate(req, res, next) {
    if (req.header("authorization") !== "Bearer synthetic-library-token") return next(new AppError(401, "UNAUTHORIZED", "Sessão sintética ausente."));
    res.locals.principal = { ownerId: "synthetic-owner" }; next();
  },
  notesRouter: express.Router(), libraryRouter: createLibraryRouter(new LibraryController(new LibraryServiceImpl(repo))),
});
// Identidade é fixa neste processo de testes; nunca use este servidor para dados reais.
app.listen(3183, "127.0.0.1", () => process.stdout.write(`Biblioteca sintética: 3183 (${randomUUID()})\n`));
