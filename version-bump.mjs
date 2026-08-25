/**
 * npm lifecycle: runs after `npm version <newver>` updates package.json.
 * Copies that version into the Obsidian plugin manifest + versions map.
 *
 *   npm version patch   # 1.4.0 → 1.4.1
 *   npm version minor   # 1.4.0 → 1.5.0
 *   npm version major   # 1.4.0 → 2.0.0
 *
 * Do not hand-edit only manifest.json — npm will keep printing package.json.
 */
import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	console.error("version-bump.mjs: npm_package_version is unset (run via npm version)");
	process.exit(1);
}

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");

console.log(`bumped manifest.json + versions.json → ${targetVersion} (minApp ${minAppVersion})`);
