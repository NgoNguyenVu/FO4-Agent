// Test validator dùng chung (TASK-049): một nguồn luật cho config.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  requirePositiveInteger,
  requireNonNegativeInteger,
  requireBoolean,
  requireNonEmptyString,
  createValidators
} = require("./config-validators");

test("requirePositiveInteger chỉ nhận số nguyên dương", () => {
  for (const value of [1, 42, Number.MAX_SAFE_INTEGER]) {
    assert.doesNotThrow(() => requirePositiveInteger(value, "field"));
  }
  for (const value of [0, -1, 1.5, "1", NaN, Infinity, null, undefined]) {
    assert.throws(
      () => requirePositiveInteger(value, "field"),
      /field phải là số nguyên dương/
    );
  }
});

test("requireNonNegativeInteger nhận 0 nhưng từ chối số âm/thập phân", () => {
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
    assert.doesNotThrow(() => requireNonNegativeInteger(value, "field"));
  }
  for (const value of [-1, 0.5, "0", NaN, Infinity, null]) {
    assert.throws(
      () => requireNonNegativeInteger(value, "field"),
      /field phải là số nguyên >= 0/
    );
  }
});

test("requireBoolean chỉ nhận true/false thật", () => {
  assert.doesNotThrow(() => requireBoolean(true, "flag"));
  assert.doesNotThrow(() => requireBoolean(false, "flag"));
  for (const value of ["true", 1, 0, null, undefined, {}]) {
    assert.throws(() => requireBoolean(value, "flag"), /flag phải là true\/false/);
  }
});

test("requireNonEmptyString từ chối chuỗi rỗng/khoảng trắng và kiểu khác", () => {
  assert.doesNotThrow(() => requireNonEmptyString("x", "name"));
  assert.doesNotThrow(() => requireNonEmptyString("  x  ", "name"));
  for (const value of ["", "   ", null, undefined, 1, {}]) {
    assert.throws(
      () => requireNonEmptyString(value, "name"),
      /name phải là chuỗi không rỗng/
    );
  }
});

test("createValidators gắn prefix vào thông báo lỗi", () => {
  const configValidators = createValidators("Cấu hình ");
  assert.throws(
    () => configValidators.requirePositiveInteger(0, "ovrMin"),
    /^Error: Cấu hình ovrMin phải là số nguyên dương\.$/
  );
  assert.throws(
    () => configValidators.requireNonNegativeInteger(-1, "iconBuy.purchaseTimeoutSeconds"),
    /^Error: Cấu hình iconBuy\.purchaseTimeoutSeconds phải là số nguyên >= 0\.$/
  );
  assert.throws(
    () => configValidators.requireBoolean("true", "iconBuy.monitorExistingOrders"),
    /^Error: Cấu hình iconBuy\.monitorExistingOrders phải là true\/false\.$/
  );
});

test("validator không prefix dùng label nguyên văn", () => {
  assert.throws(
    () => requireNonNegativeInteger(-1, "Cấu hình tùy chỉnh"),
    /^Error: Cấu hình tùy chỉnh phải là số nguyên >= 0\.$/
  );
});
