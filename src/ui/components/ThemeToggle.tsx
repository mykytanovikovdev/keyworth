import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import {
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from "react-aria-components";
import { useThemePreference, type ThemePreference } from "../theme.ts";
import { Tooltip } from "./Tooltip.tsx";

const options: { id: ThemePreference; label: string; icon: ReactNode }[] = [
  { id: "system", label: "System", icon: <Monitor aria-hidden="true" /> },
  { id: "light", label: "Light", icon: <Sun aria-hidden="true" /> },
  { id: "dark", label: "Dark", icon: <Moon aria-hidden="true" /> },
];

function isPreference(key: Key | undefined): key is ThemePreference {
  return options.some((option) => option.id === key);
}

interface ThemeToggleProps {
  /** Icons only (for the header) or icons with text (for settings). */
  showLabels?: boolean;
}

/** Follow the system theme, or always use light or dark. Saved on this device. */
export function ThemeToggle({ showLabels = false }: ThemeToggleProps) {
  const [preference, setPreference] = useThemePreference();

  return (
    <ToggleButtonGroup
      aria-label="Theme"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[preference]}
      onSelectionChange={(keys) => {
        const [key] = keys;
        if (isPreference(key)) setPreference(key);
      }}
      className="inline-flex rounded-md bg-surface p-0.5"
    >
      {options.map((option) => {
        const button = (
          <ToggleButton
            key={option.id}
            id={option.id}
            {...(!showLabels && { "aria-label": `${option.label} theme` })}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-sm text-sm text-fg-muted transition-colors duration-(--kw-duration-fast) data-hovered:text-fg data-selected:bg-raised data-selected:font-medium data-selected:text-fg data-selected:shadow-raised ${showLabels ? "px-3" : "w-8"}`}
          >
            {option.icon}
            {showLabels && option.label}
          </ToggleButton>
        );
        return showLabels ? (
          button
        ) : (
          <Tooltip key={option.id} content={`${option.label} theme`}>
            {button}
          </Tooltip>
        );
      })}
    </ToggleButtonGroup>
  );
}
