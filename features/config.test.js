// Test validate cấu hình (TASK-046): các khoảng trống đã để lọt giá trị sai vào
// runtime (monitorExistingOrders không phải boolean, ovrPhoi/maxPriceEach sai
// định dạng) phải bị chặn ngay khi validateConfig(), không đợi tới giữa phiên.
const test = require("node:test");
const assert = require("node:assert/strict");

const { config, validateConfig } = require("./config");

function withTempValue(target, key, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(target, key);
  const original = target[key];
  target[key] = value;
  try {
    fn();
  } finally {
    if (had) target[key] = original;
    else delete target[key];
  }
}

test("config hiện tại hợp lệ", () => {
  assert.doesNotThrow(() => validateConfig());
});

test("iconBuy.monitorExistingOrders phải là boolean", () => {
  for (const value of ["true", 1, 0, null, undefined, {}]) {
    withTempValue(config.iconBuy, "monitorExistingOrders", value, () => {
      assert.throws(
        () => validateConfig(),
        (error) => {
          assert.match(error.message, /monitorExistingOrders/);
          return true;
        },
        `giá trị ${JSON.stringify(value)} phải bị từ chối`
      );
    });
  }
  withTempValue(config.iconBuy, "monitorExistingOrders", false, () => {
    assert.doesNotThrow(() => validateConfig());
  });
});

test("upgrade.ovrPhoi chấp nhận danh sách và dải hợp lệ", () => {
  for (const value of [
    "118",
    "114,115,116",
    "112-118",
    "112 - 118",
    " 118 , 120-122 "
  ]) {
    withTempValue(config.upgrade, "ovrPhoi", value, () => {
      assert.doesNotThrow(() => validateConfig(), `"${value}" phải hợp lệ`);
    });
  }
});

test("upgrade.ovrPhoi từ chối giá trị rỗng, sai định dạng hoặc dải ngược", () => {
  for (const value of [
    "",
    "   ",
    "abc",
    "118,",
    ",118",
    "118,,120",
    "120-110",
    "1-100",
    "0",
    "118.5",
    "118-",
    "-118",
    "1e3"
  ]) {
    withTempValue(config.upgrade, "ovrPhoi", value, () => {
      assert.throws(
        () => validateConfig(),
        (error) => {
          assert.match(error.message, /ovrPhoi/);
          return true;
        },
        `"${value}" phải bị từ chối`
      );
    });
  }
});

test("upgrade.maxPriceEach chấp nhận số + hậu tố K/M/B", () => {
  for (const value of ["2M", "500K", "1,5M", "1.5M", "2000000", "2m", " 2M "]) {
    withTempValue(config.upgrade, "maxPriceEach", value, () => {
      assert.doesNotThrow(() => validateConfig(), `"${value}" phải hợp lệ`);
    });
  }
});

test("upgrade.maxPriceEach từ chối chuỗi không phải giá", () => {
  for (const value of ["", "   ", "abc", "2M2", "-2M", "M", "2 M 2"]) {
    withTempValue(config.upgrade, "maxPriceEach", value, () => {
      assert.throws(
        () => validateConfig(),
        (error) => {
          assert.match(error.message, /maxPriceEach/);
          return true;
        },
        `"${value}" phải bị từ chối`
      );
    });
  }
});
