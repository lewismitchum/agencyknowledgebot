const KEY = "louis:selected_bot_id";

export function getSelectedBotId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setSelectedBotId(botId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!botId) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, botId);
  } catch {
    // ignore
  }
}
