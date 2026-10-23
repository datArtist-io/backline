// What the agent remembers about this user, in their own browser only.
// Moves to the user's account once sign-in ships.
const KEY = "backline.artist";

export function rememberedArtist(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && v.trim() ? v.trim().slice(0, 120) : null;
  } catch {
    return null;
  }
}

export function rememberArtist(name: string | null): void {
  try {
    if (name && name.trim()) localStorage.setItem(KEY, name.trim().slice(0, 120));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the agent will just ask again */
  }
}
