const test = require("node:test");
const assert = require("node:assert/strict");
const { groupByPrice, smartFloorPrice, probeMarket } = require("./market-probe");

test("smart floor pricing skips thin ticks", () => {
  const listings = [
    { priceBP: 100, count: 1 },
    { priceBP: 150, count: 2 },
    { priceBP: 200, count: 3 },
    { priceBP: 300, count: 10 }
  ];
  const floor = smartFloorPrice(listings, { minLiquidity: 3 });
  assert.equal(floor.priceBP, 200);
  assert.equal(floor.liquidity, 3);
  assert.deepEqual(floor.skippedTicks.map((t) => t.priceBP), [100, 150]);
});

test("no tick with enough liquidity yields null floor (HOLD)", () => {
  const floor = smartFloorPrice([{ priceBP: 100, count: 2 }], { minLiquidity: 3 });
  assert.equal(floor.priceBP, null);
  assert.equal(floor.liquidity, 0);
  assert.equal(floor.skippedTicks.length, 1);
});

test("probeMarket filters bands and price cap", async () => {
  const orders = [
    { ovr: 110, priceBP: 100, count: 5 },
    { ovr: 114, priceBP: 90, count: 2 },
    { ovr: 119, priceBP: 400, count: 4 }
  ];
  const rows = await probeMarket({
    readOrders: async () => orders,
    bands: ["108-112", "113-114", "115-120"],
    minLiquidity: 3,
    maxPriceBP: 200
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].band, "108-112");
  assert.equal(rows[0].priceBP, 100);
  assert.equal(groupByPrice(orders).length, 3);
});
