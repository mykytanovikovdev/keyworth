import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import {
  FieldError,
  Input,
  Label,
  Text,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";
import { IconButton } from "./Button.tsx";
import { fieldBoxClassName } from "./field-styles.ts";

interface PasswordFieldProps extends Omit<
  AriaTextFieldProps,
  | "className"
  | "style"
  | "children"
  | "validationBehavior"
  | "type"
  | "autoComplete"
> {
  label: string;
  description?: string;
  /** Shown, and announced, when `isInvalid` is true. */
  errorMessage?: string | undefined;
  placeholder?: string;
  /**
   * Shown in the clear at first. For a recovery key: long, typed from a saved
   * copy, and checked group by group when there is a typo.
   */
  defaultVisible?: boolean;
  /** Layout only (margins, width). */
  className?: string;
}

/**
 * A secret the user types: a passphrase or a recovery key. Hidden by default,
 * with a button to show it. Autocorrect, capitalization and spellcheck are
 * off, including while shown: they would change what was typed.
 *
 * Autocomplete is off too (the owner's decision, 2026-11-01): a passphrase
 * should not live in the browser's password manager, whose account is often
 * the same Google account the user signs in with. It is a request, not a
 * guarantee: Chrome ignores `autocomplete="off"` on password fields and may
 * still offer to save or fill, but no longer suggests generating one.
 */
export function PasswordField({
  label,
  description,
  errorMessage,
  placeholder,
  defaultVisible = false,
  className = "",
  ...props
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(defaultVisible);
  return (
    <AriaTextField
      {...props}
      type={visible ? "text" : "password"}
      validationBehavior="aria"
      className={`flex flex-col gap-1.5 ${className}`}
    >
      <Label className="text-sm font-medium text-fg">{label}</Label>
      <div className="relative">
        <Input
          {...(placeholder !== undefined && { placeholder })}
          lang="en"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={`h-10 pr-11 pl-3 ${fieldBoxClassName}`}
        />
        <IconButton
          label={
            visible
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          tooltip={false}
          onPress={() => {
            setVisible(!visible);
          }}
          className="absolute top-1/2 right-0.5 -translate-y-1/2"
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </IconButton>
      </div>
      {description && (
        <Text slot="description" className="text-xs text-fg-muted">
          {description}
        </Text>
      )}
      <FieldError className="text-xs font-medium text-loss">
        {errorMessage}
      </FieldError>
    </AriaTextField>
  );
}
