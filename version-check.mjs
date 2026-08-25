/**
 * Fail if package.json and manifest.json disagree on version.
 * package.json is the npm source of truth; keep them aligned with:
 *   npm version patch|minor|major
 * which runs the "version" script (version-bump.mjs) to update
 * manifest.json + versions.json from process.env.npm_package_version.
 */
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

if (pkg.version !== manifest.version) {
	console.error(
		`Version mismatch: package.json is ${pkg.version}, manifest.json is ${manifest.version}.\n`
		+ `Release with:  npm version patch|minor|major\n`
		+ `Or align package.json to the plugin version if manifest was bumped by hand.`,
	);
	process.exit(1);
}

console.log(`version ok: ${pkg.version}`);
