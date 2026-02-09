import type { HTMLAttributes } from "react";

export type SurfaceVariant = "base" | "raised" | "sunken";

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant;
}

export function Surface({ className, variant = "base", ...rest }: SurfaceProps) {
  const variantClass = variant === "base" ? "" : `ds-surface--${variant}`;
  const classes = ["ds-surface", variantClass, className].filter(Boolean).join(" ");
  return <div className={classes} {...rest} />;
}
