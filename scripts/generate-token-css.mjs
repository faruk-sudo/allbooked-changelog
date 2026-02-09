import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const tokenPath = path.join(root, "tokens.json");
const outputPath = path.join(root, "src/styles/tokens.css");

const source = JSON.parse(await readFile(tokenPath, "utf8"));

const REFERENCE = /^\{(.+)\}$/;

function getByPath(object, tokenPathValue) {
  return tokenPathValue.split(".").reduce((current, key) => {
    if (current === undefined || current === null || !(key in current)) {
      throw new Error(`Unknown token reference "${tokenPathValue}"`);
    }
    return current[key];
  }, object);
}

function resolveToken(tokenValue, allTokens) {
  if (typeof tokenValue === "string") {
    const match = tokenValue.match(REFERENCE);
    if (!match) {
      return tokenValue;
    }
    return resolveToken(getByPath(allTokens, match[1]), allTokens);
  }

  if (typeof tokenValue === "number") {
    return `${tokenValue}`;
  }

  throw new Error(`Unsupported token value "${JSON.stringify(tokenValue)}"`);
}

function flatten(object, prefix = []) {
  const entries = [];
  for (const [key, value] of Object.entries(object)) {
    const nextPrefix = [...prefix, key];
    if (typeof value === "string" || typeof value === "number") {
      entries.push([nextPrefix.join("-"), value]);
      continue;
    }
    entries.push(...flatten(value, nextPrefix));
  }
  return entries;
}

function toCssVars(entries, allTokens, prefix) {
  return entries
    .map(([name, value]) => `  --${prefix}-${name}: ${resolveToken(value, allTokens)};`)
    .join("\n");
}

const primitive = source.primitive;
const semantic = source.semantic;

const rootSections = [
  toCssVars(flatten(primitive.typography.fontFamily), source, "font-family"),
  toCssVars(flatten(primitive.typography.fontSize), source, "font-size"),
  toCssVars(flatten(primitive.typography.fontWeight), source, "font-weight"),
  toCssVars(flatten(primitive.typography.lineHeight), source, "line-height"),
  toCssVars(flatten(primitive.spacing), source, "space"),
  toCssVars(flatten(primitive.radius), source, "radius"),
  toCssVars(flatten(primitive.shadow), source, "shadow"),
  toCssVars(flatten(primitive.zIndex), source, "z"),
  toCssVars(flatten(semantic.light), source, "color")
];

const darkSection = toCssVars(flatten(semantic.dark), source, "color");

const css = `/* Generated from tokens.json by scripts/generate-token-css.mjs */\n:root {\n${rootSections.join(
  "\n"
)}\n}\n\n[data-theme="dark"] {\n${darkSection}\n}\n`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, css, "utf8");

console.log(`Generated ${path.relative(root, outputPath)}`);
