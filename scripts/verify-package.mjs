import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

function fail(message) {
  console.error(`package check failed: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

assert(pkg.main === "./dist/index.js", "package.json main must point at ./dist/index.js");
assert(pkg.types === "./dist/index.d.ts", "package.json types must point at ./dist/index.d.ts");
assert(!String(pkg.main ?? "").endsWith(".ts"), "package.json main must not point at TypeScript source");

const openclaw = pkg.openclaw ?? {};
assert(
  Array.isArray(openclaw.runtimeExtensions) && openclaw.runtimeExtensions.includes("./dist/index.js"),
  "openclaw.runtimeExtensions must include ./dist/index.js",
);
assert(openclaw.runtimeSetupEntry === "./dist/setup-entry.js", "openclaw.runtimeSetupEntry must be ./dist/setup-entry.js");

const output = execFileSync("npm", ["pack", "--json", "--dry-run", "--ignore-scripts"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const start = output.indexOf("[");
const end = output.lastIndexOf("]");
assert(start >= 0 && end >= start, "npm pack did not return JSON output");

const [pack] = JSON.parse(output.slice(start, end + 1));
const files = new Set((pack.files ?? []).map((file) => file.path));

for (const required of [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/setup-entry.js",
  "dist/setup-entry.d.ts",
  "dist/api.js",
  "dist/src/channel.js",
  "openclaw.plugin.json",
  "README.md",
  "LICENSE",
]) {
  assert(files.has(required), `npm package is missing ${required}`);
}

for (const forbidden of files) {
  assert(
    !forbidden.endsWith(".ts") || forbidden.endsWith(".d.ts"),
    `npm package must not include TypeScript source: ${forbidden}`,
  );
  assert(!forbidden.includes(".test."), `npm package must not include tests: ${forbidden}`);
  assert(!forbidden.startsWith("src/live/"), `npm package must not include live smoke files: ${forbidden}`);
}

console.log(`package check passed: ${pkg.name}@${pkg.version} includes compiled runtime output`);
