const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseBp,
  parseCompactBp,
  parseMarketPrice
} = require("./price-utils");

test("parseBp reads Vietnamese BP separators", () => {
  assert.equal(parseBp("666.666"), 666666);
  assert.equal(parseBp("1,234,567"), 1234567);
  assert.throws(() => parseBp("abc"), /Không đọc được giá BP/);
});

test("parseCompactBp reads K/M/B and returns null on garbage", () => {
  assert.equal(parseCompactBp("26.9M"), 26_900_000);
  assert.equal(parseCompactBp("1.2B"), 1_200_000_000);
  assert.equal(parseCompactBp("573,000"), 573000);
  assert.equal(parseCompactBp("?"), null);
});

test("parseMarketPrice treats comma as decimal only with a unit suffix", () => {
  assert.equal(parseMarketPrice("2,5M"), 2_500_000);
  assert.equal(parseMarketPrice("2.5M"), 2_500_000);
  assert.equal(parseMarketPrice("625,000"), 625000);
  assert.equal(parseMarketPrice("54.3M"), 54_300_000);
});
