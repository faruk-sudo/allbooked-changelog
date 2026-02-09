import { createElement, type HTMLAttributes } from "react";

export type TextVariant = "body" | "muted" | "heading";
type TextTag = "p" | "span" | "h1" | "h2" | "h3" | "label" | "div";

const DEFAULT_TAG_BY_VARIANT: Record<TextVariant, TextTag> = {
  body: "p",
  muted: "p",
  heading: "h2"
};

export interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: TextTag;
  variant?: TextVariant;
}

export function Text({ as, className, variant = "body", ...rest }: TextProps) {
  const tag = as ?? DEFAULT_TAG_BY_VARIANT[variant];
  const classes = ["ds-text", `ds-text--${variant}`, className].filter(Boolean).join(" ");
  return createElement(tag, { className: classes, ...rest });
}
