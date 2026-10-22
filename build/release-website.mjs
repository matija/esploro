import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { name: app, version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const product = "Esploro";
const website = fileURLToPath(new URL(`../../${app}.web/`, import.meta.url));
const tag = process.env.RELEASE_TAG || version;
const repo = process.env.GH_REPO || `matija/${app}`;
const git = (...args) => execFileSync("git", ["-C", website, ...args], { encoding: "utf8" }).trim();
const run = (command, args) => execFileSync(command, args, { cwd: website, stdio: "inherit" });

if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--check")) throw new Error("Usage: node build/release-website.mjs [--check]");
if (git("status", "--porcelain")) throw new Error(`Commit or stash changes in ${website} first.`);
const defaultBranch = git("ls-remote", "--symref", "origin", "HEAD").match(/^ref: refs\/heads\/(\S+)\s+HEAD/m)?.[1];
if (!defaultBranch || git("branch", "--show-current") !== defaultBranch) throw new Error(`Check out the website's default branch (${defaultBranch || "unknown"}) first.`);
git("fetch", "--quiet", "origin", defaultBranch);
if (git("rev-parse", "HEAD") !== git("rev-parse", "FETCH_HEAD")) throw new Error(`Sync ${website} with origin/${defaultBranch} first (git pull --ff-only or git push).`);
if (process.argv[2] === "--check") {
  console.log(`Website ready: ${website}`);
  process.exit(0);
}

const release = JSON.parse(execFileSync("gh", ["release", "view", tag, "--repo", repo, "--json", "tagName,isDraft,assets"], { encoding: "utf8" }));
if (release.isDraft || release.tagName !== tag) throw new Error(`Release ${tag} is not published.`);
const downloads = {};
for (const arch of ["aarch64", "x64"]) {
  const name = `${product}_${version}_${arch}.dmg`;
  const asset = release.assets.find(asset => asset.name === name);
  if (!asset) throw new Error(`Release ${tag} is missing ${name}.`);
  downloads[arch] = asset.url;
}

const base = `https://github.com/${repo}/releases/`;
const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const counts = { aarch64: 0, x64: 0 };
const changes = [];
for (const path of git("ls-files", "-z").split("\0").filter(path => /\.(html|md|txt|json)$/.test(path))) {
  const file = `${website}${path}`;
  const original = readFileSync(file, "utf8");
  let updated = original.replace(new RegExp(`${escapedBase}download/[^/\\s"'<>]+/[^/\\s"'<>]+_(aarch64|x64)\\.dmg`, "g"), (_, arch) => {
    counts[arch]++;
    return downloads[arch];
  });
  updated = updated.replace(new RegExp(`${escapedBase}tag/[^/\\s"'<>]+`, "g"), `${base}tag/${tag}`);
  updated = updated.replace(/(<span data-version>)[^<]*(<\/span>)/g, `$1v${version}$2`);
  updated = updated.replace(/(class="release-link"[^>]*>)[^<]*/g, `$1${product} ${version} `);
  if (updated !== original) changes.push({ path, file, updated });
}
if (!counts.aarch64 || !counts.x64) throw new Error("Website must have download links for both architectures.");
for (const { file, updated } of changes) writeFileSync(file, updated);
run("python3", ["build.py"]);
run("git", ["diff", "--check"]);
if (changes.length) {
  run("git", ["add", "--", ...changes.map(change => change.path)]);
  run("git", ["commit", "-m", `Update downloads to ${product} ${version}`]);
}
run("git", ["push", "origin", `HEAD:${defaultBranch}`]);
console.log(`Website pushed for ${product} ${version}; GitHub Actions deploys it.`);
