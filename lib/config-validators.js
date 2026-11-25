// Validator nguyên thuỷ dùng chung cho config (TASK-049).
//
// Trước đây nhiều module mỗi nơi tự định nghĩa
// `requireNonNegativeInteger` (và config còn thêm positive/boolean/string), dễ
// lệch luật khi sửa một bên. Module này là nguồn duy nhất; caller truyền `label`
// đầy đủ để giữ ngữ cảnh lỗi (ví dụ "Cấu hình ovrMin").
"use strict";

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} phải là số nguyên dương.`);
  }
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} phải là số nguyên >= 0.`);
  }
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} phải là true/false.`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} phải là chuỗi không rỗng.`);
  }
}

// Tạo bộ validator đã gắn prefix, giữ nguyên chữ ký cũ `(value, name)` của các
// module đang dùng. Ví dụ createValidators("Cấu hình ") cho ra thông báo
// "Cấu hình ovrMin phải là số nguyên dương.".
function createValidators(prefix = "") {
  const label = (name) => `${prefix}${name}`;
  return {
    requirePositiveInteger: (value, name) =>
      requirePositiveInteger(value, label(name)),
    requireNonNegativeInteger: (value, name) =>
      requireNonNegativeInteger(value, label(name)),
    requireBoolean: (value, name) => requireBoolean(value, label(name)),
    requireNonEmptyString: (value, name) =>
      requireNonEmptyString(value, label(name))
  };
}

module.exports = {
  requirePositiveInteger,
  requireNonNegativeInteger,
  requireBoolean,
  requireNonEmptyString,
  createValidators
};
