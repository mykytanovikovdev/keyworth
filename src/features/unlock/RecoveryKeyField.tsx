import type { KeyboardEvent } from "react";
import {
  FieldError,
  Label,
  Text,
  TextArea,
  TextField,
} from "react-aria-components";
import { fieldBoxClassName } from "../../ui/index.ts";

/**
 * The recovery key typed back from a saved copy. Two lines, so all nine groups
 * are in view at any width and can be compared one by one after a typo; shown
 * in capitals like the saved copy, whatever case is typed (parsing ignores
 * case, spaces, dashes and line breaks). It is a single value, so Enter
 * submits the form instead of starting a new line.
 */
export function RecoveryKeyField({
  name,
  errorMessage,
  defaultValue,
  onChange,
  isReadOnly = false,
}: {
  name?: string;
  /** Set when the key was refused; also marks the field invalid. */
  errorMessage?: string | undefined;
  defaultValue?: string;
  onChange?: () => void;
  isReadOnly?: boolean;
}) {
  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
  return (
    <TextField
      {...(name !== undefined && { name })}
      {...(defaultValue !== undefined && { defaultValue })}
      {...(onChange && { onChange })}
      isReadOnly={isReadOnly}
      isInvalid={errorMessage !== undefined}
      validationBehavior="aria"
      className="flex flex-col gap-1.5"
    >
      <Label className="text-sm font-medium text-fg">Recovery key</Label>
      <TextArea
        rows={2}
        lang="en"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        onKeyDown={submitOnEnter}
        className={`resize-none px-3 py-2 tracking-wide uppercase tabular-nums placeholder:normal-case ${fieldBoxClassName}`}
      />
      <Text slot="description" className="text-xs text-fg-muted">
        Type or paste it as saved. Dashes, spaces, line breaks and letter case
        don&apos;t matter.
      </Text>
      <FieldError className="text-xs font-medium text-loss">
        {errorMessage}
      </FieldError>
    </TextField>
  );
}
