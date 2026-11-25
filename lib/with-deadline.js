// Promise.race với timeout KHÔNG để lại timer treo: clearTimeout + unref trong
// finally dù promise gốc resolve hay reject.
function withDeadline(
  promise,
  ms,
  fallback = undefined,
  { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}
) {
  let timer = null;
  const guard = new Promise((resolve) => {
    timer = setTimeoutFn(() => resolve(fallback), ms);
    if (typeof timer?.unref === "function") timer.unref();
  });
  return Promise.race([Promise.resolve(promise), guard]).finally(() => {
    if (timer !== null) clearTimeoutFn(timer);
  });
}

module.exports = { withDeadline };
