// Contrato público consumido pela web; dependências transitivas restritas a Zod.
export {
  habitOutputSchema, habitListOutputSchema, occurrenceOutputSchema, occurrenceListOutputSchema, historyOutputSchema, xpOutputSchema, settingsOutputSchema,
  type HabitOutput, type HabitListOutput, type OccurrenceOutput, type OccurrenceListOutput, type HistoryOutput, type XpOutput, type SettingsOutput,
} from "./dto/output.js";
export type { CreateHabitInput, UpdateHabitInput, PauseInput, ResumeInput } from "./dto/input.js";
