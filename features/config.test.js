// Test validate cấu hình (TASK-046): các khoảng trống đã để lọt giá trị sai vào
// runtime (monitorExistingOrders không phải boolean, ovrPhoi/maxPriceEach sai
// định dạng) phải bị chặn ngay khi validateConfig(), không đợi tới giữa phiên.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  config,
  getUpgradeSpec,
  validateConfig,
  normalizeOvrSpec,
  normalizePriceSpec
} = require("./config");

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

test("config mẫu tồn tại và không còn block spendLimits/liveTrading", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const example = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../config.example.json"), "utf8")
  );
  assert.equal(example.upgrade.targetGrade, 7);
  assert.equal("spendLimits" in example, false);
  assert.equal("liveTrading" in example, false);
  assert.equal("spendLimits" in config, false);
  assert.equal("liveTrading" in config, false);
});

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
    "112-123",
    "118,119,120,121,122,123",
    "118-123",
    "118 - 123",
    " 117,118-123 "
  ]) {
    withTempValue(config.upgrade, "ovrPhoi", value, () => {
      assert.doesNotThrow(() => validateConfig(), `"${value}" phải hợp lệ`);
    });
  }
});

test("upgrade.ovrPhoi không còn bị bắt bao phủ dải mua (hai bên dùng OVR khác định nghĩa)", () => {
  // Auto Mua Phôi lọc theo OVR TTCN (đã cộng OVR boost); mini-app nâng cấp
  // lọc theo base OVR + grade (chưa cộng boost). Dải hẹp hơn ovrMin..ovrMax
  // vẫn hợp lệ nếu nó khớp phôi đã mua thật.
  withTempValue(config.upgrade, "ovrPhoi", "118,119,120", () => {
    assert.doesNotThrow(() => validateConfig());
  });
  withTempValue(config.upgrade, "ovrPhoi", "118", () => {
    assert.doesNotThrow(() => validateConfig());
  });
});

test("upgrade.targetGrade nằm trong dải combobox 2..13 của mini-app", () => {
  for (const value of [1, 14, 0, -1]) {
    withTempValue(config.upgrade, "targetGrade", value, () => {
      assert.throws(
        () => validateConfig(),
        /targetGrade/,
        `targetGrade ${value} phải bị từ chối`
      );
    });
  }
  for (const value of [2, 7, 13]) {
    withTempValue(config.upgrade, "targetGrade", value, () => {
      assert.doesNotThrow(() => validateConfig());
    });
  }
});

test("ovrPhoi và maxPriceEach được chuẩn hóa trước khi gõ vào mini-app", () => {
  assert.equal(normalizeOvrSpec(" 115, 118-120 "), "115,118-120");
  assert.equal(normalizeOvrSpec("115 - 120"), "115-120");
  assert.equal(normalizeOvrSpec("118,"), "118,", "không được nuốt dấu phẩy của giá trị sai");
  assert.equal(normalizePriceSpec(" 2,5M "), "2.5M");
  assert.equal(normalizePriceSpec("625,000"), "625,000");
  assert.equal(normalizePriceSpec("2.5M"), "2.5M");

  withTempValue(config.upgrade, "ovrPhoi", " 115, 118 - 120 ", () => {
    withTempValue(config.upgrade, "maxPriceEach", "2,5M", () => {
      assert.doesNotThrow(() => validateConfig());
      const spec = getUpgradeSpec();
      assert.equal(spec.ovrPhoi, "115,118-120");
      assert.equal(spec.maxPriceEach, "2.5M");
    });
  });
});

test("upgrade.ovrPhoi chỉ kiểm tra cú pháp, người dùng tự chọn dải phôi", () => {
  // Không còn cảnh báo/áp đặt dải: ovrPhoi hẹp hơn hay lệch ovrMin..ovrMax
  // vẫn hợp lệ, miễn đúng cú pháp. Config là nguồn duy nhất.
  withTempValue(config.upgrade, "ovrPhoi", "112", () => {
    assert.doesNotThrow(() => validateConfig());
  });
  withTempValue(config.upgrade, "ovrPhoi", "115-120", () => {
    assert.doesNotThrow(() => validateConfig());
  });
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
