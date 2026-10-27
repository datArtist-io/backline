// Where a trip starts from: only a city the person gave, never one the model guessed.

/** Whether a starting city came from the person (named in their request, or their saved home city). Pure. */
export function saidOrigin(origin: string, goal: string, homeCity: string | null): boolean {
  const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const head = norm(origin.split(",")[0].trim());
  if (!head) return false;
  if (homeCity && norm(homeCity).includes(head)) return true;
  return norm(goal).includes(head);
}
