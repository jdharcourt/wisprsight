import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { type ComponentProps } from "react";

export function Button({ loading = false, variant = "primary", children, className, disabled, ...props }: ComponentProps<typeof ButtonPrimitive> & { loading?: boolean; variant?: "primary" | "outline" | "ghost" | "danger" }) {
  return (
    <ButtonPrimitive {...props} className={["button", variant, className].filter(Boolean).join(" ")} disabled={disabled || loading} focusableWhenDisabled={loading} aria-busy={loading || undefined}>
      {children}
      {loading && <span className="busy-label">Working…</span>}
    </ButtonPrimitive>
  );
}
