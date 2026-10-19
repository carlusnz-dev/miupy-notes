type ArrowIconProps = { direction?: "right" | "up-right"; size?: number };

// As fontes locais não incluem as setas; o SVG evita fallback para fonte do sistema.
export default function ArrowIcon({ direction = "up-right", size = 18 }: ArrowIconProps) {
  return (
    <svg className="arrow-icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path
        d={direction === "right" ? "M3 8h10m-4-4 4 4-4 4" : "M4 12 12 4M5.5 4H12v6.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}
