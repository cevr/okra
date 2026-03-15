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
});
