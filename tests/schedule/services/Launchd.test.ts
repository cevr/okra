import { describe, expect, test } from "bun:test";
import { escapeXml, generatePlist } from "../../../src/schedule/services/Launchd.js";
import { Task } from "../../../src/schedule/services/Store.js";

describe("escapeXml", () => {
  test("escapes ampersand", () => {
    expect(escapeXml("a & b")).toBe("a &amp; b");
  });
  test("escapes angle brackets", () => {
    expect(escapeXml("<script>")).toBe("&lt;script&gt;");
  });
  test("escapes double quotes", () => {
    expect(escapeXml('say "hello"')).toBe("say &quot;hello&quot;");
  });
  test("escapes single quotes", () => {
    expect(escapeXml("it's")).toBe("it&apos;s");
  });
  test("passes through safe strings", () => {
    expect(escapeXml("hello world 123")).toBe("hello world 123");
  });
});

describe("generatePlist", () => {
  const task = new Task({
    id: "test-task",
    prompt: "do stuff",
    provider: "claude",
    schedule: {
      _tag: "Cron",
      minute: 0,
      hour: 9,
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
      raw: "every day at 9am",
    },
    cwd: "/Users/test/project",
    createdAt: "2026-01-01T00:00:00Z",
    status: "active",
    runCount: 0,
  });

  test("generates valid plist XML", () => {
    const plist = generatePlist(
      task,
      "/usr/local/bin/okra",
      "/Users/test",
      "/tmp/test.log",
      "/usr/bin:/usr/local/bin",
    );
    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain("com.cvr.okra.schedule-test-task");
    expect(plist).toContain("<string>/usr/local/bin/okra</string>");
    // Should have "schedule" "run" <id> as program arguments
    expect(plist).toContain("<string>schedule</string>");
    expect(plist).toContain("<string>run</string>");
    expect(plist).toContain("<string>test-task</string>");
    expect(plist).toContain("<key>WorkingDirectory</key>");
    expect(plist).toContain("/Users/test/project");
  });

  test("includes env vars", () => {
    const plist = generatePlist(task, "/bin/okra", "/Users/test", "/tmp/test.log", "/usr/bin");
    expect(plist).toContain("<key>HOME</key>");
    expect(plist).toContain("<key>PATH</key>");
  });

  test("escapes XML special characters in all fields", () => {
    const xmlTask = new Task({
      id: "a&b",
      prompt: "check <things>",
      provider: "claude",
      schedule: {
        _tag: "Cron",
        minute: 0,
        hour: 9,
        dayOfMonth: "*",
        month: "*",
        dayOfWeek: "*",
        raw: "every day at 9am",
      },
      cwd: '/path/with "quotes"',
      createdAt: "2026-01-01T00:00:00Z",
      status: "active",
      runCount: 0,
    });
    const plist = generatePlist(
      xmlTask,
      "/bin/agent&d",
      "/Users/te'st",
      "/logs/a&b.log",
      "/usr/bin",
    );

    expect(plist).toContain("okra.schedule-a&amp;b");
    expect(plist).toContain("/bin/agent&amp;d");
    expect(plist).toContain("/Users/te&apos;st");
    expect(plist).toContain("/logs/a&amp;b.log");
    expect(plist).toContain("/path/with &quot;quotes&quot;");
  });

  test("generates StartCalendarInterval dict for daily cron", () => {
    const dailyTask = new Task({
      id: "daily",
      prompt: "run",
      provider: "claude",
      schedule: {
        _tag: "Cron",
        minute: 30,
        hour: 14,
        dayOfMonth: "*",
        month: "*",
        dayOfWeek: "*",
        raw: "30 14 * * *",
      },
      cwd: "/tmp",
      createdAt: "2026-01-01T00:00:00Z",
      status: "active",
      runCount: 0,
    });
    const plist = generatePlist(dailyTask, "/bin/okra", "/Users/test", "/tmp/log", "/usr/bin");

    expect(plist).toContain("<key>StartCalendarInterval</key>");
    expect(plist).toContain("<key>Minute</key>");
    expect(plist).toContain("<integer>30</integer>");
    expect(plist).toContain("<key>Hour</key>");
    expect(plist).toContain("<integer>14</integer>");
  });

  test("generates StartCalendarInterval array for weekday range", () => {
    const weekdayTask = new Task({
      id: "weekday",
      prompt: "run",
      provider: "claude",
      schedule: {
        _tag: "Cron",
        minute: 0,
        hour: 9,
        dayOfMonth: "*",
        month: "*",
        dayOfWeek: "1-5",
        raw: "0 9 * * 1-5",
      },
      cwd: "/tmp",
      createdAt: "2026-01-01T00:00:00Z",
      status: "active",
      runCount: 0,
    });
    const plist = generatePlist(weekdayTask, "/bin/okra", "/Users/test", "/tmp/log", "/usr/bin");

    expect(plist).toContain("<key>StartCalendarInterval</key>");
    expect(plist).toContain("<array>");
    // Should have 5 dict entries (Mon-Fri)
    const dictCount = (plist.match(/<dict>/g) ?? []).length;
    // 1 root + 1 env + 5 intervals = 7
    expect(dictCount).toBe(7);
  });

  test("generates oneshot calendar interval with Month/Day/Hour/Minute", () => {
    const at = new Date("2024-06-15T10:30:00Z");
    const oneshotTask = new Task({
      id: "oneshot",
      prompt: "run",
      provider: "claude",
      schedule: { _tag: "Oneshot", at: at.toISOString(), raw: "in 30 minutes" },
      cwd: "/tmp",
      createdAt: "2026-01-01T00:00:00Z",
      status: "active",
      runCount: 0,
    });
    const plist = generatePlist(oneshotTask, "/bin/okra", "/Users/test", "/tmp/log", "/usr/bin");

    expect(plist).toContain("<key>StartCalendarInterval</key>");
    expect(plist).toContain("<key>Month</key>");
    expect(plist).toContain("<key>Day</key>");
    expect(plist).toContain("<key>Hour</key>");
    expect(plist).toContain("<key>Minute</key>");
  });

  test("sets KeepAlive to false", () => {
    const plist = generatePlist(task, "/bin/okra", "/Users/test", "/tmp/log", "/usr/bin");

    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<false/>");
  });
});
