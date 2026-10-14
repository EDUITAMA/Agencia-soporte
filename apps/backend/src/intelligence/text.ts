/** Shared deterministic text helpers (no model involved). */

const MARKUP = new Set(["var", "div", "span", "html", "body", "style", "class", "href", "contenido", "nbsp", "table", "color", "font", "width", "height", "border", "size", "text", "img", "png", "jpg", "image"]);
const STOPWORDS = new Set(
  (
    "a al algo ante asi aun aunque con como cual cuando de del desde donde el ella ellos en entre era es esta estan este esto estos fue ha han hay la las le les lo los mas me mi muy no nos o os para pero por que se si sin sobre su sus te tiene tienen un una uno unos y ya " +
    "the a an and are as at be but by for from has have in into is it its of on or that the their this to was were will with not no can could should would " +
    "caso casos favor buen buenas dias dia tardes noches saludos cordial cordiales cordialmente gracias solicito solicitud solicita requiere apoyo ayuda agradezco amablemente " +
    "hola estimados estimado equipo soporte revision revisar validar validacion por favor presenta presentando presento ocurre"
  ).split(/\s+/),
);

export const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Replaces volatile values (ids, dates, numbers, uuids, urls) so equal problems look equal. */
export function maskVolatile(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, " url ")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, " uuid ")
    .replace(/\b\d{4}-\d{2}-\d{2}([t ]\d{2}:\d{2}(:\d{2})?)?\b/gi, " fecha ")
    .replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, " jirakey ")
    .replace(/\b\d{5,}\b/g, " num ");
}

function stem(token: string): string {
  if (token.length > 5 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function tokenize(value: string): string[] {
  return fold(maskVolatile(value))
    .replace(/[^a-z0-9_.\s-]/g, " ")
    .split(/[\s]+/)
    .map((token) => token.replace(/^[-_.]+|[-_.]+$/g, ""))
    .filter((token) => token.length > 2 && !STOPWORDS.has(token) && !MARKUP.has(token) && !/^\d+$/.test(token) && token !== "num" && token !== "fecha" && token !== "url" && token !== "uuid" && token !== "jirakey")
    .map(stem);
}

export const truncate = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`);

export const normalizeSpaces = (value: string) => value.replace(/\s+/g, " ").trim();

/** Jaccard similarity of two token sets. */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared++;
  return shared / (left.size + right.size - shared);
}

export const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
