# AGENTS.md

## Versioning
- Use the version format `YY.MMDD.HHMM`.
- Generate the version in China Standard Time with `TZ=Asia/Shanghai date '+%y.%m%d.%H%M'`.
- `plugin/manifest.json` is the release source of truth. Keep `package.json` and `package-lock.json` in sync with it.
- After updating the version, run `node scripts/generate-update-json.js` to refresh `update.json`, `update-macos.json`, `update-windows.json`, and `update-linux.json`.
