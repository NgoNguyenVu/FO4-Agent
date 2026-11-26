// Smart Floor Pricing: bỏ nấc giá mỏng, lấy nấc thấp nhất đủ thanh khoản.
"use strict";

function groupByPrice(listings) {
  const groups = new Map();
  for (const row of listings || []) {
    const price = Number(row?.priceBP ?? row?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const count = Math.max(1, Number(row?.count ?? row?.quantity ?? 1));
    groups.set(price, (groups.get(price) || 0) + count);
  }
  return [...groups.entries()]
    .map(([priceBP, count]) => ({ priceBP, count }))
    .sort((a, b) => a.priceBP - b.priceBP);
}

function smartFloorPrice(listings, { minLiquidity = 3 } = {}) {
  const ticks = groupByPrice(listings);
  const skipped = ticks.filter((tick) => tick.count < minLiquidity);
  const floor = ticks.find((tick) => tick.count >= minLiquidity) || null;
  return {
    priceBP: floor ? floor.priceBP : null,
    liquidity: floor ? floor.count : 0,
    skippedTicks: skipped,
    ticks
  };
}

// readOrders(): () => Promise<Array> đã được parse từ TTCN bởi features/icon-buy.
async function probeMarket({
  readOrders,
  bands = [],
  minLiquidity = 3,
  maxPriceBP = Infinity
} = {}) {
  const orders = typeof readOrders === "function" ? await readOrders() : readOrders || [];
  const result = [];
  for (const band of bands) {
    const [min, max] = String(band).split("-").map(Number);
    const listings = orders.filter((order) => {
      const ovr = Number(order?.ovr);
      return Number.isFinite(ovr) && ovr >= min && ovr <= max;
    });
    const floor = smartFloorPrice(listings, { minLiquidity });
    result.push({
      band: String(band),
      ...floor,
      eligible: floor.priceBP != null && floor.priceBP <= maxPriceBP
    });
  }
  return result
    .filter((row) => row.eligible)
    .sort((a, b) => a.priceBP - b.priceBP || b.liquidity - a.liquidity);
}

module.exports = { groupByPrice, smartFloorPrice, probeMarket };
