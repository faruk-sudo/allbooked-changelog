import type { CSSProperties, HTMLAttributes } from "react";

type StackDirection = "vertical" | "horizontal";

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  direction?: StackDirection;
  gap?: string;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
}

export function Stack({
  align,
  className,
  direction = "vertical",
  gap = "4",
  justify,
  style,
  wrap = false,
  ...rest
}: StackProps) {
  const classes = ["ds-stack", `ds-stack--${direction}`, className].filter(Boolean).join(" ");

  const inlineStyle = {
    ...style,
    "--stack-gap": `var(--space-${gap})`,
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap ? "wrap" : undefined
  } as CSSProperties;

  return <div className={classes} style={inlineStyle} {...rest} />;
}
