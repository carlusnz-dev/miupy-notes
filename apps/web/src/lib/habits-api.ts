import {
  habitListOutputSchema, habitOutputSchema, historyOutputSchema, occurrenceListOutputSchema, occurrenceOutputSchema, xpOutputSchema,
  type CreateHabitInput, type HabitOutput, type OccurrenceOutput, type XpOutput,
} from "../../../api/src/modules/habits/contract";
import { apiClient, toApiError } from "./api-client";

export type Habit = HabitOutput;
export type HabitInput = CreateHabitInput;
export type Occurrence = OccurrenceOutput;
export type HabitsXp = XpOutput;

const base = "/v1/habits";
const guard = async <T,>(run: () => Promise<T>): Promise<T> => { try { return await run(); } catch (error) { throw toApiError(error); } };
const path = (id: string) => `${base}/${encodeURIComponent(id)}`;

export const listHabits = (trash = false, signal?: AbortSignal) =>
  guard(async () => habitListOutputSchema.parse((await apiClient.get(base, { params: { trash }, signal })).data).items);
export const saveHabit = (input: HabitInput, existing?: Habit) => guard(async () =>
  habitOutputSchema.parse((existing ? await apiClient.patch(path(existing.id), { ...input, version: existing.version }) : await apiClient.post(base, input)).data));
export const deleteHabit = (id: string) => guard(async () => habitOutputSchema.parse((await apiClient.delete(path(id))).data));
export const restoreHabit = (id: string) => guard(async () => habitOutputSchema.parse((await apiClient.post(`${path(id)}/restore`)).data));
export const pauseHabit = (habit: Habit, from: string, until: string | null) => guard(async () =>
  habitOutputSchema.parse((await apiClient.post(`${path(habit.id)}/pause`, { version: habit.version, from, until })).data));
export const resumeHabit = (habit: Habit, on: string) => guard(async () =>
  habitOutputSchema.parse((await apiClient.post(`${path(habit.id)}/resume`, { version: habit.version, on })).data));

/** Datas locais AAAA-MM-DD, inclusivas. */
export const listOccurrences = (from: string, to: string, signal?: AbortSignal) =>
  guard(async () => occurrenceListOutputSchema.parse((await apiClient.get(`${base}/occurrences`, { params: { from, to }, signal })).data).items);
export const setOccurrenceStatus = (habitId: string, date: string, status: "completed" | "pending") => guard(async () =>
  occurrenceOutputSchema.parse((await apiClient.put(`${path(habitId)}/occurrences/${date}`, { status })).data));
export const listHabitHistory = (from: string, to: string, signal?: AbortSignal) =>
  guard(async () => historyOutputSchema.parse((await apiClient.get(`${base}/history`, { params: { from, to }, signal })).data).items);
export const getHabitsXp = (signal?: AbortSignal) => guard(async () => xpOutputSchema.parse((await apiClient.get(`${base}/xp`, { signal })).data));
