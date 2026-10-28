export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/** Classes do botão; separado de Button.tsx para ser testável sem CSS nem DOM. */
export const buttonClass = (variant: ButtonVariant, size: ButtonSize, className = "") =>
  `ui-button ui-button-${variant} ui-button-${size} ${className}`.trim();
