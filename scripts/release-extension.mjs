// Release the Chrome extension: package extension/ and submit it through the
// Chrome Web Store API v2 (upload → publish), so an update is one command
// instead of a Developer Dashboard visit.
//
// The API covers the package only. The store listing, screenshots and the
// Privacy tab are dashboard-only — update them there first whenever a release
// changes what the extension does with page content, or review may reject it.
//
// Usage: node scripts/release-extension.mjs [options]
//   --bump patch|minor|major  raise manifest.json's version and commit it first
//                             (the store refuses a version that isn't above the
//                             published one)
//   --staged                  once approved, hold the update until it is
//                             published from the dashboard
//   --skip-review             ask the store to skip review (refused unless the
//                             item qualifies)
//   --dry-run                 check, package and read the store status only
//   --status                  print the store status and exit
//
// Releases what is committed: extension/ and theme/v1/theme.css must be clean,
// and theme-live.js must already bundle the current theme.css (run
// build-extension-theme.mjs and commit first).
//
// Settings — each read from the environment, else from the macOS Keychain
// entry of the same name (security add-generic-password -a "$USER" -s NAME -w 'value' -U):
//   CWS_PUBLISHER_ID     Developer Dashboard → Publisher → Settings
//   CWS_EXTENSION_ID     the item's ID (in its store and dashboard URLs)
//   CWS_SERVICE_ACCOUNT  the service account added under Dashboard → Account.
//                        Tokens come from `gcloud auth print-access-token
//                        --impersonate-service-account`, so no key file exists.
//   CWS_ACCESS_TOKEN     optional: a ready token, used instead of gcloud

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const extDir = join(root, "extension");
const manifestPath = join(extDir, "manifest.json");
const API = "https://chromewebstore.googleapis.com";

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const bumpAt = args.indexOf("--bump");
const bump = bumpAt >= 0 ? args[bumpAt + 1] : null;
if (bumpAt >= 0 && !["patch", "minor", "major"].includes(bump)) {
  fail("--bump takes patch, minor or major.");
}
const dryRun = has("--dry-run");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function git(...a) {
  return execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
}

function setting(name) {
  if (process.env[name]) return process.env[name];
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-a", process.env.USER ?? "", "-s", name, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

const parseVersion = (v) => String(v).split(".").map(Number);
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 4; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
function bumped(version, part) {
  const [major = 0, minor = 0, patch = 0] = parseVersion(version);
  if (part === "major") return `${major + 1}.0.0`;
  if (part === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// --- settings and token ---------------------------------------------------

const publisher = setting("CWS_PUBLISHER_ID");
const item = setting("CWS_EXTENSION_ID");
const serviceAccount = setting("CWS_SERVICE_ACCOUNT");
let token = setting("CWS_ACCESS_TOKEN");
const missing = [
  !publisher && "CWS_PUBLISHER_ID",
  !item && "CWS_EXTENSION_ID",
  !token && !serviceAccount && "CWS_SERVICE_ACCOUNT",
].filter(Boolean);
if (missing.length) {
  fail(`Missing settings: ${missing.join(", ")} (env, or a Keychain entry of that name).`);
}
if (!token) {
  try {
    token = execFileSync(
      "gcloud",
      [
        "auth",
        "print-access-token",
        `--impersonate-service-account=${serviceAccount}`,
        "--scopes=https://www.googleapis.com/auth/chromewebstore",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (err) {
    fail(
      `Could not get a token for ${serviceAccount} via gcloud:\n${err.stderr ?? err.message}\n` +
        "Check `gcloud auth login`, and that your account holds Service Account Token Creator on it.",
    );
  }
}

async function api(method, verb, { body, headers = {}, upload = false } = {}) {
  const base = upload ? `${API}/upload/v2` : `${API}/v2`;
  const res = await fetch(`${base}/publishers/${publisher}/items/${item}:${verb}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body,
  });
  const text = await res.text();
  if (!res.ok) fail(`${verb} failed (HTTP ${res.status}):\n${text}`);
  return text ? JSON.parse(text) : {};
}

function versionsOf(revision) {
  return (revision?.distributionChannels ?? [])
    .map((c) => {
      const pct = c.deployPercentage;
      return pct != null && pct !== 100 ? `${c.crxVersion} (${pct}%)` : c.crxVersion;
    })
    .join(", ");
}

function printStatus(status) {
  const pub = status.publishedItemRevisionStatus;
  const sub = status.submittedItemRevisionStatus;
  console.log(`published: ${versionsOf(pub) || "-"} [${pub?.state ?? "-"}]`);
  console.log(`submitted: ${versionsOf(sub) || "-"} [${sub?.state ?? "-"}]`);
}

const status = await api("GET", "fetchStatus");
if (has("--status")) {
  printStatus(status);
  process.exit(0);
}

// --- preflight ------------------------------------------------------------

const dirty = git("status", "--porcelain", "--", "extension", "theme/v1/theme.css");
if (dirty) fail(`Uncommitted changes — commit them first:\n${dirty}`);

const css = readFileSync(join(root, "theme/v1/theme.css"), "utf8");
if (!readFileSync(join(extDir, "theme-live.js"), "utf8").includes(JSON.stringify(css))) {
  fail(
    "extension/theme-live.js does not bundle the current theme.css. " +
      "Run node scripts/build-extension-theme.mjs and commit it first.",
  );
}

const pending = status.submittedItemRevisionStatus?.state;
if (pending === "PENDING_REVIEW" || pending === "STAGED") {
  printStatus(status);
  fail(`A submission is already ${pending}. Wait for it, or cancel it in the dashboard.`);
}

const manifestText = readFileSync(manifestPath, "utf8");
const current = JSON.parse(manifestText).version;
const version = bump ? bumped(current, bump) : current;
const published = status.publishedItemRevisionStatus?.distributionChannels?.[0]?.crxVersion;
if (published && compareVersions(version, published) <= 0) {
  fail(
    `manifest.json is at ${current}, not above the published ${published}. ` +
      "Pass --bump patch|minor|major.",
  );
}
if (!published) console.warn("warning: could not read the published version from the store.");

if (bump && !dryRun) {
  writeFileSync(
    manifestPath,
    manifestText.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`),
  );
  execFileSync(
    "git",
    ["commit", "-q", "-m", `chore(extension): Release ${version}`, "--", "extension/manifest.json"],
    { cwd: root, stdio: "inherit" },
  );
  console.log(`bumped manifest.json ${current} → ${version} and committed it`);
}

// --- package --------------------------------------------------------------

// The extension's own files at the zip root, as the store expects. Left out:
// the developer README, the icon sources (source.png, *-square.png — the
// manifest uses the rounded ones) and macOS litter. dist/ is gitignored.
const zipPath = join(root, "dist", `chameleon-v${dryRun ? current : version}.zip`);
mkdirSync(join(root, "dist"), { recursive: true });
rmSync(zipPath, { force: true });
execFileSync(
  "zip",
  [
    ...["-q", "-r", "-X", zipPath, "."],
    ...["-x", "README.md", "icons/source.png", "icons/*-square.png", "*.DS_Store", ".*"],
  ],
  { cwd: extDir },
);
const zipKb = Math.round(statSync(zipPath).size / 1024);
console.log(`packaged ${zipPath} (${zipKb} KB)`);

if (dryRun) {
  printStatus(status);
  console.log(
    `dry run: would submit ${version}${bump ? ` (bumped from ${current})` : ""}; nothing uploaded.`,
  );
  process.exit(0);
}

// --- upload and publish ---------------------------------------------------

const uploaded = await api("POST", "upload", {
  upload: true,
  body: readFileSync(zipPath),
  headers: { "Content-Type": "application/zip" },
});
let uploadState = uploaded.uploadState;
for (let i = 0; i < 40 && (uploadState === "IN_PROGRESS" || uploadState === "UPLOAD_IN_PROGRESS"); i++) {
  await new Promise((r) => setTimeout(r, 3000));
  uploadState = (await api("GET", "fetchStatus")).lastAsyncUploadState;
}
if (uploadState !== "SUCCEEDED") {
  fail(`Upload did not succeed (state: ${uploadState}):\n${JSON.stringify(uploaded, null, 2)}`);
}
console.log(`uploaded ${uploaded.crxVersion ?? version}`);

const result = await api("POST", "publish", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    publishType: has("--staged") ? "STAGED_PUBLISH" : "DEFAULT_PUBLISH",
    skipReview: has("--skip-review"),
  }),
});
console.log(`submitted ${version}: ${result.state ?? "(no state returned)"}`);
for (const w of result.warningInfo?.warnings ?? []) {
  console.warn(`warning: ${w.reason ?? ""} ${w.description ?? ""}`.trim());
}
console.log("Check progress with: node scripts/release-extension.mjs --status");
