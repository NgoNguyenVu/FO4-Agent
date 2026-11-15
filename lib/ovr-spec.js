// Một nguồn chuẩn duy nhất cho định dạng OVR (TASK-051, follow-up TASK-049).
//
// Trước đây features/config.validateOvrSpec() (lúc validate config) và
// features/upgrade/patterns.parseOvrList() (lúc chạy) là hai bản luật gần giống
// nhau nhưng lệch: parser runtime chấp nhận 0/số âm, validator config thì không.
// Từ nay cả hai gọi chung module này để lỗi cấu hình và lỗi runtime luôn khớp.
//
// Luật strict:
// - Danh sách phân tách bằng dấu phẩy: "114,115,116".
// - Mỗi phần tử là số nguyên dương, hoặc dải "a-b" với 1 <= a <= b.
// - Dải tối đa 51 giá trị (to - from <= 50).
// - Trả về mảng số nguyên đã sắp xếp, loại trùng.
"use strict";

const MAX_OVR_RANGE_SPAN = 50;

function parseOvrSpec(raw) {
  const out = new Set();
  const parts = String(raw).split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) throw new Error(`OVR không hợp lệ: "${part}"`);
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from < 1 ||
        to < 1 ||
        from > to ||
        to - from > MAX_OVR_RANGE_SPAN
      ) {
        throw new Error(`Dải OVR không hợp lệ: ${trimmed}`);
      }
      for (let ovr = from; ovr <= to; ovr += 1) out.add(ovr);
      continue;
    }
    if (!/^\d+$/.test(trimmed)) throw new Error(`OVR không hợp lệ: ${trimmed}`);
    const single = Number(trimmed);
    if (!Number.isSafeInteger(single) || single < 1) {
      throw new Error(`OVR không hợp lệ: ${trimmed}`);
    }
    out.add(single);
  }
  if (!out.size) throw new Error(`Danh sách OVR trống: ${raw}`);
  return [...out].sort((a, b) => a - b);
}

module.exports = {
  MAX_OVR_RANGE_SPAN,
  parseOvrSpec
};
