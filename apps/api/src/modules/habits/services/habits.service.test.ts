import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../../../core/domain/app-error.js";
import { createHabitInputSchema } from "../dto/input.js";
import { MemoryHabitsRepository } from "../repository/memory-habits.repository.js";
import { HabitsServiceImpl, MAX_HABITS } from "./habits.service.impl.js";

function setup(start = "2026-10-26T12:00:00.000Z") {
  const clock = { now: new Date(start) };
  const repository = new MemoryHabitsRepository();
  return { clock, repository, service: new HabitsServiceImpl(repository, () => clock.now) };
}
const input = (patch: Record<string, unknown> = {}) => createHabitInputSchema.parse({ title: "Ler", recurrence: { type: "daily" }, startDate: "2026-10-01", ...patch });
const range = { from: "2026-10-26", to: "2026-10-28" };

test("conclusão é por ocorrência: concluir um dia não altera os outros nem o cadastro", async () => {
  const { service } = setup();
  const habit = await service.create("a", input());
  const done = await service.setOccurrence("a", habit.id, "2026-10-27", "completed");
  assert.equal(done.status, "completed");
  assert.deepEqual((await service.occurrences("a", range)).map(o => [o.date, o.status]), [["2026-10-26", "pending"], ["2026-10-27", "completed"], ["2026-10-28", "pending"]]);
  assert.equal((await service.findById("a", habit.id)).version, 1);
  const back = await service.setOccurrence("a", habit.id, "2026-10-27", "pending");
  assert.equal(back.status, "pending"); assert.equal(back.completedAt, null);
});

test("rejeita data sem ocorrência, futura distante, pausada ou de hábito na lixeira", async () => {
  const { service } = setup();
  const habit = await service.create("a", input({ recurrence: { type: "weekdays", days: [1] } })); // segundas
  await assert.rejects(service.setOccurrence("a", habit.id, "2026-10-27", "completed"), { status: 400 });
  await assert.rejects(service.setOccurrence("a", habit.id, "2026-11-02", "completed"), { status: 400 });
  await service.setOccurrence("a", habit.id, "2026-10-26", "completed");
  const paused = await service.pause("a", habit.id, { version: 1, from: "2026-10-19", until: "2026-10-20" });
  await assert.rejects(service.setOccurrence("a", habit.id, "2026-10-19", "completed"), { status: 400 });
  await service.remove("a", habit.id);
  await assert.rejects(service.setOccurrence("a", habit.id, "2026-10-26", "pending"), { status: 409 });
  assert.equal(paused.pauses.length, 1);
});

test("XP: concluir repetido não duplica; desmarcar compensa; remarcar reativa o mesmo evento", async () => {
  const { service, repository } = setup();
  const habit = await service.create("a", input({ priority: "high" }));
  await service.setOccurrence("a", habit.id, "2026-10-26", "completed");
  await service.setOccurrence("a", habit.id, "2026-10-26", "completed");
  assert.equal((await service.xp("a")).totalXp, 15);
  await service.setOccurrence("a", habit.id, "2026-10-26", "pending");
  await service.setOccurrence("a", habit.id, "2026-10-26", "pending");
  assert.equal((await service.xp("a")).totalXp, 0);
  await service.setOccurrence("a", habit.id, "2026-10-26", "completed");
  const xp = await service.xp("a");
  assert.equal(xp.totalXp, 15); assert.equal(xp.completions, 1); assert.equal(xp.level, 1);
  assert.equal((await repository.listXpEvents("a")).length, 1);
  assert.equal(xp.achievements.find(a => a.id === "first_completion")?.unlocked, true);
});

test("nível e conquistas derivam dos eventos; prioridades pontuam diferente", async () => {
  const { service } = setup();
  const high = await service.create("a", input({ priority: "high" }));
  const low = await service.create("a", input({ title: "Alongar", priority: "low" }));
  for (let day = 1; day <= 10; day++) await service.setOccurrence("a", high.id, `2026-10-${String(day).padStart(2, "0")}`, "completed");
  await service.setOccurrence("a", low.id, "2026-10-01", "completed");
  const xp = await service.xp("a");
  assert.equal(xp.totalXp, 155); assert.equal(xp.level, 2); assert.equal(xp.levelXp, 55); assert.equal(xp.completions, 11);
  assert.equal(xp.achievements.find(a => a.id === "ten_completions")?.unlocked, true);
  assert.equal(xp.achievements.find(a => a.id === "level_5")?.unlocked, false);
});

test("lixeira: exclusão lógica por 30 dias, restauração e expiração por timestamp", async () => {
  const { service, clock } = setup();
  const habit = await service.create("a", input());
  const removed = await service.remove("a", habit.id);
  assert.equal(removed.deletedAt, "2026-10-26T12:00:00.000Z"); assert.equal(removed.purgeAfter, "2026-11-25T12:00:00.000Z");
  assert.equal((await service.list("a", false)).length, 0); assert.equal((await service.list("a", true)).length, 1);
  assert.deepEqual(await service.occurrences("a", range), []);
  await assert.rejects(service.update("a", habit.id, { version: 2, title: "x" }), { status: 409 });
  const restored = await service.restore("a", habit.id);
  assert.equal(restored.deletedAt, null); assert.equal(restored.purgeAfter, null);
  assert.equal((await service.occurrences("a", range)).length, 3);
  await service.remove("a", habit.id);
  clock.now = new Date("2026-11-25T11:59:59.999Z"); assert.equal((await service.list("a", true)).length, 1);
  clock.now = new Date("2026-11-25T12:00:00.000Z");
  assert.equal((await service.list("a", true)).length, 0);
  await assert.rejects(service.restore("a", habit.id), { status: 404 });
});

test("expurgo remove só o cadastro: histórico e XP permanecem legíveis", async () => {
  const { service, clock, repository } = setup();
  const habit = await service.create("a", input({ title: "Meditar" }));
  await service.setOccurrence("a", habit.id, "2026-10-26", "completed");
  await service.remove("a", habit.id);
  assert.equal(await service.purgeExpired("a"), 0);
  clock.now = new Date("2026-12-01T00:00:00.000Z");
  assert.equal(await service.purgeExpired("a"), 1);
  assert.equal(await repository.findById("a", habit.id), null);
  const history = await service.history("a", { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(history.map(h => [h.date, h.title, h.habitId]), [["2026-10-26", "Meditar", habit.id]]);
  assert.equal((await service.xp("a")).totalXp, 10);
});

test("pausa indefinida, com data e retomada; edição valida intervalo e versão", async () => {
  const { service } = setup();
  const habit = await service.create("a", input());
  const paused = await service.pause("a", habit.id, { version: 1, from: "2026-10-27", until: null });
  assert.deepEqual((await service.occurrences("a", range)).map(o => o.date), ["2026-10-26"]);
  await assert.rejects(service.pause("a", habit.id, { version: 1, from: "2026-11-01", until: null }), { status: 409 });
  const resumed = await service.resume("a", habit.id, { version: paused.version, on: "2026-10-28" });
  assert.deepEqual(resumed.pauses, [{ from: "2026-10-27", until: "2026-10-28" }]);
  assert.deepEqual((await service.occurrences("a", range)).map(o => o.date), ["2026-10-26", "2026-10-28"]);
  await assert.rejects(service.resume("a", habit.id, { version: resumed.version, on: "2026-10-29" }), { status: 409 });
  await assert.rejects(service.update("a", habit.id, { version: resumed.version, endDate: "2026-09-01" }), { status: 400 });
  const updated = await service.update("a", habit.id, { version: resumed.version, title: "Novo" });
  assert.equal(updated.version, resumed.version + 1);
});

test("exceções são AppError com códigos estáveis", async () => {
  const { service } = setup();
  await assert.rejects(service.findById("a", "00000000-0000-4000-8000-000000000000"), (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND");
});

/** Segura a primeira escrita de conclusão até `release()`, para forçar o entrelaçamento com outra chamada. */
function holdCompletion(repository: MemoryHabitsRepository) {
  const original = repository.completeOccurrence.bind(repository);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => entered = resolve);
  repository.completeOccurrence = async (...args) => { entered(); await gate; return original(...args); };
  return { release, started };
}
async function state(service: HabitsServiceImpl, date: string) {
  return { status: (await service.occurrences("a", { from: date, to: date }))[0].status, totalXp: (await service.xp("a")).totalXp };
}

test("concluir e desmarcar em paralelo nunca deixam ocorrência e XP em desacordo", async () => {
  const { service, repository } = setup();
  const habit = await service.create("a", input());
  const { release, started } = holdCompletion(repository);
  const completion = service.setOccurrence("a", habit.id, "2026-10-26", "completed");
  await started;
  await service.setOccurrence("a", habit.id, "2026-10-26", "pending");
  release(); await completion;
  const { status, totalXp } = await state(service, "2026-10-26");
  assert.equal(totalXp, status === "completed" ? 10 : 0);
  assert.equal((await service.history("a", range)).length, status === "completed" ? 1 : 0);
});

test("desmarcar durante uma conclusão em andamento também mantém o acordo", async () => {
  const { service } = setup();
  const habit = await service.create("a", input());
  await Promise.all([1, 2, 3].flatMap(() => [service.setOccurrence("a", habit.id, "2026-10-26", "completed"), service.setOccurrence("a", habit.id, "2026-10-26", "pending")]));
  const { status, totalXp } = await state(service, "2026-10-26");
  assert.equal(totalXp, status === "completed" ? 10 : 0);
});

test("falha ao gravar o XP não deixa a ocorrência concluída sem pontos", async () => {
  const { service, repository } = setup();
  const habit = await service.create("a", input());
  repository.completeOccurrence = async () => { throw new Error("dependência indisponível"); };
  await assert.rejects(service.setOccurrence("a", habit.id, "2026-10-26", "completed"), /indisponível/);
  assert.deepEqual(await state(service, "2026-10-26"), { status: "pending", totalXp: 0 });
  assert.equal((await service.history("a", range)).length, 0);
});

test("falha ao desmarcar não apaga a execução nem compensa o XP pela metade", async () => {
  const { service, repository } = setup();
  const habit = await service.create("a", input());
  await service.setOccurrence("a", habit.id, "2026-10-26", "completed");
  repository.reopenOccurrence = async () => { throw new Error("dependência indisponível"); };
  await assert.rejects(service.setOccurrence("a", habit.id, "2026-10-26", "pending"), /indisponível/);
  assert.deepEqual(await state(service, "2026-10-26"), { status: "completed", totalXp: 10 });
});

test("concluir de novo conserva o horário original e o XP; desmarcar sem conclusão não cria evento", async () => {
  const { service, repository, clock } = setup();
  const habit = await service.create("a", input());
  await service.setOccurrence("a", habit.id, "2026-10-26", "pending");
  assert.equal((await repository.listXpEvents("a")).length, 0);
  const first = await service.setOccurrence("a", habit.id, "2026-10-26", "completed");
  clock.now = new Date("2026-10-26T18:00:00.000Z");
  const again = await service.setOccurrence("a", habit.id, "2026-10-26", "completed");
  assert.equal(again.completedAt, first.completedAt);
  assert.equal((await service.history("a", range))[0].completedAt, first.completedAt);
  assert.equal((await service.xp("a")).totalXp, 10);
});

test("limite de 300: só conta hábitos fora da lixeira; excluir libera vaga e restaurar acima do limite é recusado", async () => {
  const { service } = setup();
  const created = [];
  for (let n = 0; n < MAX_HABITS; n++) created.push(await service.create("a", input({ title: `Hábito ${n}` })));
  await assert.rejects(service.create("a", input()), { status: 400, message: /Limite de 300/ });
  await service.create("outro", input());
  await service.remove("a", created[0].id);
  const replacement = await service.create("a", input({ title: "Substituto" }));
  await assert.rejects(service.restore("a", created[0].id), { status: 409, code: "CONFLICT", message: /Limite de 300/ });
  assert.equal((await service.list("a", true)).length, 1);
  await service.remove("a", replacement.id);
  assert.equal((await service.restore("a", created[0].id)).deletedAt, null);
  assert.equal((await service.list("a", false)).length, MAX_HABITS);
});
