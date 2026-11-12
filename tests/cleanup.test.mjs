import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanupTempServer, stopChild } from "../scripts/process-cleanup.mjs";

test("cleanup waits for a live SQLite child to exit; already-exited cleanup is safe", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cloudlabs-cleanup-"));
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync(process.env.CLEANUP_DB);
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('test');");
    process.on('SIGTERM',()=>setTimeout(()=>{db.close();process.exit(0);},200));
    setInterval(()=>{},1000);
    console.log('ready');
  `,
    ],
    {
      env: { ...process.env, CLEANUP_DB: path.join(directory, "locked.db") },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    await once(child.stdout, "data");
    assert.ok(existsSync(path.join(directory, "locked.db")));
    await cleanupTempServer(child, directory);
    assert.ok(
      child.exitCode !== null || child.signalCode !== null,
      "process must have exited before cleanup resolves",
    );
    assert.equal(existsSync(directory), false);
    await stopChild(child); // Must not wait for an exit event that already fired.
    await cleanupTempServer(child, directory); // Idempotent removal.
  } finally {
    await cleanupTempServer(child, directory);
  }
});
