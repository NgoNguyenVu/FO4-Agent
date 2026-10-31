const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseStopTaskButton,
  parseStopTaskButtons,
  findNewPurchaseTasks,
  countRunningTaskSlots,
  getAvailableTaskSlots,
  isNoRunningTasksReply
} = require("./tasks");

test("stop-menu task buttons are parsed into code, grade, quantity and id", () => {
  assert.deepEqual(
    parseStopTaskButton("THƯỜNG • MUA | 101214101 +1 x1 #8849"),
    {
      kind: "MUA",
      code: "101214101",
      grade: 1,
      quantity: 1,
      taskId: "8849",
      text: "THƯỜNG • MUA | 101214101 +1 x1 #8849"
    }
  );
  assert.equal(
    parseStopTaskButton("THƯỜNG • BÁN | 101167135 +7 x1 #8974")?.kind,
    "BÁN"
  );
  assert.equal(parseStopTaskButton("Dừng tất cả"), null);
  assert.equal(parseStopTaskButton("THƯỜNG • MUA | 101214101 +1 #8849"), null);
  assert.deepEqual(
    parseStopTaskButtons([
      "Dừng tất cả",
      "THƯỜNG • MUA | 101214101 +1 x1 #8849"
    ]).map((task) => task.taskId),
    ["8849"]
  );
});

test("only new purchase tasks for the selected code/grade/quantity are cleanup targets", () => {
  const tasks = [
    { kind: "BÁN", code: "101167135", grade: 7, quantity: 1, taskId: "8974" },
    { kind: "MUA", code: "101214101", grade: 1, quantity: 1, taskId: "1000" },
    { kind: "MUA", code: "101214101", grade: 1, quantity: 1, taskId: "8849" },
    { kind: "MUA", code: "101214101", grade: 1, quantity: 2, taskId: "8850" },
    { kind: "MUA", code: "101214101", grade: 2, quantity: 1, taskId: "8851" },
    { kind: "MUA", code: "100003647", grade: 1, quantity: 1, taskId: "8852" }
  ];
  const baseline = new Set(["1000"]);
  const selected = [{ code: "101214101" }];
  assert.deepEqual(
    findNewPurchaseTasks(tasks, baseline, selected, 1, 1).map((task) => task.taskId),
    ["8849"]
  );
  // Không có baseline thì tuyệt đối không chọn task nào.
  assert.deepEqual(findNewPurchaseTasks(tasks, null, selected, 1, 1), []);
  // Mã không nằm trong danh sách chọn cũng không bị đụng.
  assert.deepEqual(findNewPurchaseTasks(tasks, baseline, [{ code: "100003647" }], 1, 1).map((t) => t.taskId), ["8852"]);
});

test("countRunningTaskSlots counts only MUA tasks and ignores other kinds", () => {
  const tasks = [
    { kind: "BÁN", taskId: "8974" },
    { kind: "MUA", taskId: "1000" },
    { kind: "MUA", taskId: "8849" },
    { kind: "MUA", taskId: "8849" },
    { kind: "MUA", taskId: "8850" }
  ];
  // BÁN không tính vào MUA; MUA trùng taskId chỉ tính 1 lần (1000, 8849, 8850 -> 3).
  assert.equal(countRunningTaskSlots(tasks, "MUA"), 3);
  assert.equal(countRunningTaskSlots(tasks, "BÁN"), 1);
  assert.equal(countRunningTaskSlots(null, "MUA"), 0);
});

test("available task slots fill the bot limit: 1/3 running means 2 more", () => {
  const oneRunning = [{ kind: "MUA", taskId: "1000" }];
  assert.equal(getAvailableTaskSlots(oneRunning, 3), 2);
  assert.equal(getAvailableTaskSlots([], 3), 3);
  assert.equal(
    getAvailableTaskSlots(
      [
        { kind: "MUA", taskId: "1000" },
        { kind: "MUA", taskId: "1001" },
        { kind: "MUA", taskId: "1002" }
      ],
      3
    ),
    0
  );
  // Task BÁN không chiếm slot mua.
  assert.equal(getAvailableTaskSlots([{ kind: "BÁN", taskId: "8974" }], 3), 3);
});

test("E003/no-running reply is a valid empty /stop baseline", () => {
  for (const reply of [
    "E003: Hiện không có lệnh nào đang chạy.",
    "E003: Không có worker nào đang chạy cho tài khoản này.",
    "E003: Không có lệnh nào đang chạy.",
    "Hiện không có lệnh nào đang chạy."
  ]) {
    assert.equal(isNoRunningTasksReply(reply), true);
  }
  assert.equal(
    isNoRunningTasksReply("THƯỜNG • MUA | 101214101 +1 x1 #8849"),
    false
  );
});
