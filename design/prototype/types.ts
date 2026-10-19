export type Variant = "neutral" | "warm";
export type Theme = "light" | "dark";
export type Screen = "empty" | "chat" | "portfolio" | "unlock";
/** Screens that live inside the app shell (everything except unlock). */
export type ShellScreen = Exclude<Screen, "unlock">;
