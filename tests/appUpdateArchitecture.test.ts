import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());

test("OTA updates require the visible restart prompt before reload", () => {
  const appSource = fs.readFileSync(path.join(rootPath, "App.tsx"), "utf8");
  const configSource = fs.readFileSync(path.join(rootPath, "app.config.js"), "utf8");
  const liveOpsSource = fs.readFileSync(
    path.join(rootPath, "src", "components", "common", "LiveOpsHost.tsx"),
    "utf8",
  );

  assert.equal(appSource.includes("applyAnyPendingOtaBeforeBoot"), false);
  assert.equal(appSource.includes("Updates.reloadAsync()"), false);
  assert.equal(configSource.includes('checkAutomatically: "NEVER"'), true);
  assert.equal(liveOpsSource.includes("checkForPendingAppUpdate"), true);
  assert.equal(liveOpsSource.includes("updateRestartNow"), true);
  assert.equal(liveOpsSource.includes("await applyFetchedAppUpdate()"), true);
});
