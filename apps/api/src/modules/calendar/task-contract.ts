// Contrato HTTP das tarefas da agenda, consumido pelo cliente web. Só pode depender de zod e de funções puras:
// tudo o que entrar aqui vai para o bundle do frontend.
export { taskListOutputSchema, taskOutputSchema, type TaskListOutput, type TaskOutput } from "./dto/task-output.js";
export { isTaskOverdue, type LocalNow } from "./domain/task-schedule.js";
