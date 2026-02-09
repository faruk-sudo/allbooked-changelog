import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ className, type = "button", variant = "primary", ...rest }: ButtonProps) {
  const classes = ["ds-button", `ds-button--${variant}`, className].filter(Boolean).join(" ");
  return <button className={classes} type={type} {...rest} />;
}
