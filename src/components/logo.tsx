import Image from "next/image";

/** Archivos vectoriales oficiales de la marca Cosme SpA. */
export function Logo({
  variant = "dark",
  className,
}: {
  variant?: "dark" | "light";
  className?: string;
}) {
  return (
    <Image
      src={variant === "light" ? "/brand/cosme-actual-blanco.svg" : "/brand/cosme-actual.svg"}
      width={228}
      height={41}
      className={className}
      alt="Cosme SpA"
      priority
    />
  );
}
