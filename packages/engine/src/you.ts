/** The summary speaks to the traveller: "the client's tastes" reads as "your tastes". */
export function toYou(text: string): string {
  return text
    .replace(/\bthe (client|user|traveller|traveler)['’]s\b/gi, "your")
    .replace(/\b(aligning|aligned|tailored|matched) (with|to) (the )?(client|user)\b/gi, "$1 $2 you")
    .replace(/\bthe (client|user)\b/gi, "you")
    .replace(/(^|[.!?]\s+)your\b/g, (_, a) => a + "Your")
    .replace(/(^|[.!?]\s+)you\b/g, (_, a) => a + "You");
}

