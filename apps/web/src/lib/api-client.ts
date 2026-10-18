import axios from "axios";
import { z } from "zod";

const env = z.object({ VITE_API_BASE_URL: z.url().optional() }).parse(import.meta.env);

export const apiClient = axios.create({
  baseURL: env.VITE_API_BASE_URL,
  timeout: 10_000,
});
