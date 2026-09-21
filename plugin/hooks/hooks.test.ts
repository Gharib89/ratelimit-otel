import { expect, test } from "claude-code/testing";

test("says it loaded on the debug log when a session starts", async ($, on) => {
  const logged: { text: string; to: string }[] = [];
  // Beneath the plugin: the bottom of each chain, since nothing else answers
  // these two events under `claude plugin test`.
  on("ui.log", (_$, e) => {
    logged.push({ text: e.text, to: e.to });
    return { value: undefined };
  });
  on("session.start", (_$, e) => ({ cwd: e.cwd }));

  await $.session.start({ cwd: "/tmp", surface: null, isInteractive: false });

  expect(logged).toEqual([{ text: "ratelimit-otel loaded", to: "debug" }]);
});
