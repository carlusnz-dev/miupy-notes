import { useSyncExternalStore } from "react";
import { z } from "zod";

const schema = z.object({
  width: z.enum(["narrow", "medium", "wide"]),
  padding: z.number().int().min(12).max(64),
  headingFont: z.enum(["serif", "sans"]),
  editorFont: z.enum(["mono", "sans", "serif"]),
  fontSize: z.number().int().min(12).max(24),
  colorTheme: z.enum(["mono", "contrast", "soft"]),
  showTags: z.boolean(),
  chipStyle: z.enum(["outline", "filled"]),
  toolbarExpanded: z.boolean(),
});
export type EditorPreferences = z.infer<typeof schema>;
export const defaultEditorPreferences: EditorPreferences = { width: "medium", padding: 24, headingFont: "serif", editorFont: "mono", fontSize: 15, colorTheme: "mono", showTags: true, chipStyle: "outline", toolbarExpanded: true };
const key = "miupy.editor-preferences.v1";
const listeners = new Set<() => void>();
function read(): EditorPreferences {
  try { return schema.parse({ ...defaultEditorPreferences, ...JSON.parse(localStorage.getItem(key) ?? "{}") }); }
  catch { return defaultEditorPreferences; }
}
let value = read();
export function getEditorPreferences() { return value; }
export function setEditorPreferences(patch: Partial<EditorPreferences>) {
  value = schema.parse({ ...value, ...patch });
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferência permanece nesta sessão. */ }
  listeners.forEach((listener) => listener());
}
export function useEditorPreferences() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => value); }
export function editorStyle(preferences: EditorPreferences): React.CSSProperties {
  return {
    "--editor-width": ({ narrow: "620px", medium: "820px", wide: "1100px" } as const)[preferences.width],
    "--editor-padding": `${preferences.padding}px`,
    "--heading-font": preferences.headingFont === "serif" ? '"Instrument Serif", Georgia, serif' : "Inter, system-ui, sans-serif",
    "--editor-font": ({ mono: "ui-monospace, SFMono-Regular, Menlo, monospace", sans: "Inter, system-ui, sans-serif", serif: '"Instrument Serif", Georgia, serif' } as const)[preferences.editorFont],
    "--editor-size": `${preferences.fontSize}px`,
  } as React.CSSProperties;
}
