// Test nguồn chuẩn duy nhất cho OVR (TASK-051, follow-up TASK-049).
//
// Trước đây parseOvrList (runtime) chấp nhận 0/số âm còn validateOvrSpec
// (config) thì không. Bộ test này khoá luật strict của lib/ovr-spec.js và kiểm
// tra cả config lẫn runtime đều đi qua cùng một parser.
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseOvrSpec, MAX_OVR_RANGE_SPAN } = require("./ovr-spec");
const { parseOvrList } = require("../features/upgrade/patterns");
const { config, validateConfig } = require("../features/config");

function withTempOvr(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(config.upgrade, "ovrPhoi");
  const original = config.upgrade.ovrPhoi;
  config.upgrade.ovrPhoi = value;
  try {
    fn();
  } finally {
    if (had) config.upgrade.ovrPhoi = original;
    else delete config.upgrade.ovrPhoi;
  }
}

test("parseOvrSpec trả mảng đã sắp xếp, loại trùng", () => {
  assert.deepEqual(parseOvrSpec("114,115,116,117"), [114, 115, 116, 117]);
  assert.deepEqual(parseOvrSpec("112-118"), [112, 113, 114, 115, 116, 117, 118]);
  assert.deepEqual(parseOvrSpec("114, 116-117"), [114, 116, 117]);
  assert.deepEqual(parseOvrSpec(" 118 , 120-122 "), [118, 120, 121, 122]);
  assert.deepEqual(parseOvrSpec("118,118,117"), [117, 118]);
  assert.deepEqual(parseOvrSpec("115-117,116"), [115, 116, 117]);
});

test("parseOvrSpec chỉ nhận số nguyên dương", () => {
  for (const value of [
    "0",
    "-118",
    "118.5",
    "1e3",
    "0x10",
    "abc",
    "118,",
    ",118",
    "118,,120",
    "118-",
    "-118-120"
  ]) {
    assert.throws(
      () => parseOvrSpec(value),
      (error) => /OVR không hợp lệ/.test(error.message),
      `"${value}" phải bị từ chối`
    );
  }
});

test("parseOvrSpec từ chối dải ngược, dải chứa 0 và dải quá rộng", () => {
  assert.throws(() => parseOvrSpec("118-112"), /Dải OVR không hợp lệ/);
  assert.throws(() => parseOvrSpec("0-5"), /Dải OVR không hợp lệ/);
  assert.throws(() => parseOvrSpec("1-52"), /Dải OVR không hợp lệ/);
  assert.throws(
    () => parseOvrSpec(`1-${MAX_OVR_RANGE_SPAN + 2}`),
    /Dải OVR không hợp lệ/
  );
  // Biên: đúng 51 giá trị vẫn hợp lệ.
  const max = parseOvrSpec(`1-${MAX_OVR_RANGE_SPAN + 1}`);
  assert.equal(max.length, MAX_OVR_RANGE_SPAN + 1);
  assert.equal(max[0], 1);
  assert.equal(max[max.length - 1], MAX_OVR_RANGE_SPAN + 1);
});

test("parseOvrList (runtime) delegate đúng parser chuẩn", () => {
  assert.deepEqual(parseOvrList("114,115,116,117"), [114, 115, 116, 117]);
  assert.deepEqual(parseOvrList("112-118"), [112, 113, 114, 115, 116, 117, 118]);
  assert.deepEqual(parseOvrList("114, 116-117"), [114, 116, 117]);
  assert.throws(() => parseOvrList("abc"), /OVR không hợp lệ/);
  assert.throws(() => parseOvrList("118-112"), /Dải OVR không hợp lệ/);
  // Hành vi thắt chặt mới: runtime không còn nhận 0/số âm.
  assert.throws(() => parseOvrList("0"), /OVR không hợp lệ/);
  assert.throws(() => parseOvrList("-118"), /OVR không hợp lệ/);
});

test("config và runtime chấp nhận/từ chối cùng một tập giá trị", () => {
  const valid = ["118", "114,115,116", "112-118", "112 - 118", " 118 , 120-122 "];
  for (const value of valid) {
    assert.doesNotThrow(() => parseOvrSpec(value), `parser phải nhận "${value}"`);
    withTempOvr(value, () => {
      assert.doesNotThrow(() => validateConfig(), `config phải nhận "${value}"`);
    });
  }

  const invalid = [
    "0",
    "-118",
    "118.5",
    "1e3",
    "118,",
    ",118",
    "118,,120",
    "120-110",
    "1-100",
    "118-",
    "abc"
  ];
  for (const value of invalid) {
    assert.throws(() => parseOvrSpec(value), `parser phải từ chối "${value}"`);
    withTempOvr(value, () => {
      assert.throws(
        () => validateConfig(),
        (error) => {
          assert.match(error.message, /ovrPhoi/);
          return true;
        },
        `config phải từ chối "${value}"`
      );
    });
  }
});

test("config báo lỗi có ngữ cảnh upgrade.ovrPhoi", () => {
  withTempOvr("118-112", () => {
    assert.throws(
      () => validateConfig(),
      (error) => {
        assert.match(error.message, /upgrade\.ovrPhoi/);
        assert.match(error.message, /Dải OVR không hợp lệ/);
        return true;
      }
    );
  });
});
