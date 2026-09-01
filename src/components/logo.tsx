// Isologotipo de Cosme: el ícono (un hexágono abierto, forma de "C") funciona
// como la letra inicial de la palabra "COSME" — símbolo y texto son una sola
// pieza, no dos elementos separables. El hexágono abierto evoca red/tecnología
// y escudo/seguridad a la vez; el punto que se escapa del anillo (el "nodo")
// evoca señal, conexión y crecimiento — cubriendo en un solo trazo los
// distintos rubros de la sociedad (TI, seguridad electrónica, consultoría e
// inversiones) sin literalizar ninguno en particular.

const ACCENT = "#D9A24B";

export function Logo({
  variant = "dark",
  className,
}: {
  variant?: "dark" | "light";
  className?: string;
}) {
  const ink = variant === "light" ? "#FFFFFF" : "#0E1622";

  return (
    <svg
      viewBox="0 0 320 100"
      className={className}
      role="img"
      aria-label="Cosme"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M65,20.6 L31,20.6 L14,50 L31,79.4 L65,79.4"
        fill="none"
        stroke={ink}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="74" cy="34" r="7.5" fill={ACCENT} />
      <text
        x="112"
        y="52"
        dominantBaseline="central"
        fontSize="58"
        fontWeight="800"
        letterSpacing="0.5"
        fill={ink}
        fontFamily="ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
      >
        OSME
      </text>
    </svg>
  );
}
