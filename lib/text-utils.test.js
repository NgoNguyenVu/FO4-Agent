const test = require("node:test");
const assert = require("node:assert/strict");
const { shorten, hasFreshSignal } = require("./text-utils");

test("shorten normalizes whitespace and caps length", () => {
  assert.equal(shorten("  a   b \n c "), "a b c");
  assert.equal(shorten("abcdef", 3), "abc");
  assert.equal(shorten(null), "");
});

test("hasFreshSignal only inspects the appended segment", () => {
  const baseline = "old line";
  assert.equal(
    hasFreshSignal(baseline, "old line\n/tn", (fresh) => fresh.includes("/tn")),
    true
  );
  assert.equal(
    hasFreshSignal(baseline, "old line", (fresh) => fresh.includes("/tn")),
    false
  );
  // Snapshot thay hẳn: getFreshSince trả null ->không suy luận.
  assert.equal(
    hasFreshSignal(baseline, "totally new /tn", (fresh) => fresh.includes("/tn")),
    false
  );
});
