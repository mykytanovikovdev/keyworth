import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent/90",
  secondary: "border border-line bg-raised text-fg hover:bg-hover",
  ghost: "text-fg-muted hover:bg-hover hover:text-fg",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className = "",
  children,
  ...props
}: ButtonProps) {
  const sizing =
    size === "sm" ? "h-8 gap-1.5 px-3 text-sm" : "h-10 gap-2 px-4 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 ${sizing} ${variants[variant]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function IconButton({
  label,
  className = "",
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-9 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
