// Giải tổ hợp phôi rẻ nhất dựa trên FIFAaddict simulator (read-only oracle).
"use strict";

const FIFA_ORACLE = "https://fifaaddict.com/fco-upgrade-simulator/api_upgrade.php";
const FIFA_SEARCH = "https://fifaaddict.com/fo4db";
const GROWTH = 1.348;

const MAX_RATE_BY_GRADE = Object.freeze({
  1: 100, 2: 81, 3: 64, 4: 50, 5: 26, 6: 15, 7: 7, 8: 5,
  9: 4, 10: 3, 11: 2, 12: 1, 13: 1
});

function maxRateForGrade(grade) {
  return MAX_RATE_BY_GRADE[String(grade)] ?? 100;
}

function rateForGrade(grade) {
  const g = Number(grade);
  if (!Number.isFinite(g) || g < 1) return 0;
  if (g >= 13) return 0;
  return Math.max(20, Math.min(50, 100 / (g + 1)));
}

function probabilityForMaterial(materialOvr, curOvr, grade) {
  const rate = rateForGrade(grade);
  if (!rate) return 0;
  return Math.min(
    100,
    rate * Math.pow(GROWTH, Number(materialOvr) - Number(curOvr))
  );
}

function combineProbabilities(materials, curOvr, grade, maxRate) {
  const perSlot = materials.map((ovr) => probabilityForMaterial(ovr, curOvr, grade));
  const cap = Number.isFinite(Number(maxRate)) ? Number(maxRate) : 100;
  return {
    perSlot,
    realProb: Math.min(cap, perSlot.reduce((sum, value) => sum + value, 0))
  };
}

// Tìm tổ hợp <=5 phôi có tổng BP nhỏ nhất mà vẫn đạt ngưỡng tương đối.
function solveCheapestCombo({
  candidates = [],
  curOvr,
  grade,
  maxRate = 100,
  minFillRatio = 0.92,
  maxMaterials = 5
} = {}) {
  const target = Number(maxRate) * Math.min(1, Math.max(0, Number(minFillRatio)));
  if (!(target > 0)) return null;
  const pool = candidates
    .filter((c) => c && Number.isFinite(Number(c.priceBP)) && Number(c.priceBP) >= 0)
    .slice()
    .sort((a, b) => Number(a.priceBP) - Number(b.priceBP))
    .slice(0, 40);

  let best = null;
  const walk = (start, picked) => {
    if (picked.length) {
      const { realProb } = combineProbabilities(
        picked.map((c) => c.ovr),
        curOvr,
        grade,
        maxRate
      );
      const cost = picked.reduce((sum, c) => sum + Number(c.priceBP), 0);
      if (realProb >= target && (!best || cost < best.costBP)) {
        best = {
          phoi: picked.map((c) => ({ id: c.id, ovr: Number(c.ovr), priceBP: Number(c.priceBP) })),
          costBP: cost,
          realProb,
          requiredProb: target,
          maxRate: Number(maxRate)
        };
      }
    }
    if (picked.length >= Math.min(5, maxMaterials)) return;
    for (let i = start; i < pool.length; i += 1) {
      picked.push(pool[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return best;
}

async function oracleGet(fetchImpl, query) {
  const response = await fetchImpl(`${FIFA_ORACLE}?${query}`, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`FIFA_ORACLE_HTTP_${response.status}`);
  return response.json();
}

async function lookupPlayer(name, { fetchImpl = globalThis.fetch, seasons = [] } = {}) {
  if (!name) throw new Error("FIFA_NAME_REQUIRED");
  const url = `${FIFA_SEARCH}?playername=${encodeURIComponent(name)}`;
  const response = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`FIFA_SEARCH_HTTP_${response.status}`);
  const html = await response.text();
  const pattern = /<a href="\/fo4db\/(pid[a-z]+)"[^>]*>\s*<img[^>]*badgedss\s+y(\d+)[^>]*>\s*([^<]+)/g;
  const allowed = (seasons || []).map((s) => String(s).toLowerCase());
  const players = [];
  for (const match of html.matchAll(pattern)) {
    const season = String(match[2]);
    if (!allowed.length || allowed.includes(season.toLowerCase())) {
      players.push({
        id: match[1],
        season,
        name: match[3].trim(),
        simulatorUrl: `${FIFA_ORACLE.replace(/\/api_upgrade\.php$/, "")}/../vn/fco-upgrade-simulator/${match[1]}`
      });
    }
  }
  return players;
}

async function oracleInfo(base, grade, fetchImpl = globalThis.fetch) {
  const data = await oracleGet(fetchImpl, `action=info&base=${base}&grade=${grade}`);
  return { curOvr: Number(data.ovr), grade: Number(data.grade), maxRate: 100 };
}

async function oracleCalc(base, grade, materials, fetchImpl = globalThis.fetch) {
  const mats = (materials || []).map((ovr) => (ovr == null ? "" : ovr)).join(",");
  const data = await oracleGet(
    fetchImpl,
    `action=calc&base=${base}&grade=${grade}&mats=${mats}`
  );
  return {
    curOvr: Number(data.curOvr),
    maxRate: Number(data.maxRate),
    realProb: Number(data.realProb),
    barPct: Number(data.barPct),
    perSlot: data.perSlot || []
  };
}

module.exports = {
  FIFA_ORACLE,
  FIFA_SEARCH,
  GROWTH,
  MAX_RATE_BY_GRADE,
  maxRateForGrade,
  rateForGrade,
  probabilityForMaterial,
  combineProbabilities,
  solveCheapestCombo,
  lookupPlayer,
  oracleInfo,
  oracleCalc
};
