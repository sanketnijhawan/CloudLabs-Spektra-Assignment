import { rm } from "node:fs/promises";

/** Wait for OS process exit before deleting files that SQLite may still lock. */
export async function stopChild(proc, timeoutMs = 4000) {
  if (!proc?.pid || proc.exitCode !== null || proc.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      proc.off("exit", onExit);
      proc.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onExit = () => finish();
    const onError = (error) => finish(error);
    // Subscribe before sending the signal: Windows can terminate immediately.
    proc.once("exit", onExit);
    proc.once("error", onError);
    timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch (error) {
        finish(error);
        return;
      }
      timer = setTimeout(
        () =>
          finish(
            new Error(
              "Child process did not exit; temporary files were retained",
            ),
          ),
        timeoutMs,
      );
    }, timeoutMs);
    try {
      proc.kill();
    } catch (error) {
      finish(error);
    }
  });
}

export async function cleanupTempServer(proc, directory) {
  await stopChild(proc);
  // Windows file scanners can briefly retain a handle after process exit.
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 100,
  });
}
