// The box every text control shares, so a field, a passphrase field and a
// multi-line field look and react the same: border, background, hover, focus,
// invalid and disabled states. Size and padding come from each control.
export const fieldBoxClassName =
  "w-full min-w-0 rounded-md border border-line-strong bg-raised text-md text-fg transition-colors duration-(--kw-duration-fast) outline-none placeholder:text-fg-muted data-disabled:cursor-not-allowed data-disabled:opacity-50 data-focused:border-focus data-focused:ring-1 data-focused:ring-focus data-hovered:border-fg-muted data-invalid:border-loss data-invalid:data-focused:ring-loss";
