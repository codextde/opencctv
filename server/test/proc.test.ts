import { expect, test } from "bun:test";
import { Supervisor } from "../src/proc.ts";

test("supervisor restarts a process that stops making progress", async () => {
  let starts = 0;
  const sup = new Supervisor("stall-test", {
    command: () => ({ cmd: ["sleep", "30"] }),
    onStart: () => {
      starts++;
    },
    minBackoffMs: 50,
    stallMs: 1000,
  });
  sup.start();
  await Bun.sleep(2600);
  await sup.stop();
  expect(starts).toBeGreaterThanOrEqual(2);
  expect(sup.lastError).toContain("no progress");
});

test("progress() keeps a quiet but healthy process running", async () => {
  let starts = 0;
  const sup = new Supervisor("stall-test-ok", {
    command: () => ({ cmd: ["sleep", "30"] }),
    onStart: () => {
      starts++;
    },
    minBackoffMs: 50,
    stallMs: 1000,
  });
  sup.start();
  const t = setInterval(() => sup.progress(), 200);
  await Bun.sleep(2600);
  clearInterval(t);
  await sup.stop();
  expect(starts).toBe(1);
});

test("without stallMs a silent process is left alone", async () => {
  let starts = 0;
  const sup = new Supervisor("no-stall", {
    command: () => ({ cmd: ["sleep", "30"] }),
    onStart: () => {
      starts++;
    },
    minBackoffMs: 50,
  });
  sup.start();
  await Bun.sleep(1500);
  await sup.stop();
  expect(starts).toBe(1);
});
