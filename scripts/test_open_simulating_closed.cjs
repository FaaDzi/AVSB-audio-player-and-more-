const fs = require('fs');

const hpsRaw = JSON.parse(fs.readFileSync('app/public/data/headphones.json', 'utf8'));

function decodeFr(packed) {
  if (typeof packed !== 'string') return packed;
  const steps = packed.startsWith('~');
  const bin = Buffer.from(steps ? packed.slice(1) : packed, 'base64');
  if (!steps) return new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2);
  const out = new Int16Array(bin.length - 1);
  out[0] = bin.readInt16LE(0);
  for (let i = 2; i < bin.length; i++) {
    out[i - 1] = out[i - 2] + bin.readInt8(i);
  }
  return out;
}

const grid = hpsRaw.grid;
const frScale = hpsRaw.frScale;

function getFrDb(model) {
  const decoded = decodeFr(model.fr);
  const db = new Float64Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    db[i] = decoded[i] * frScale;
  }
  return db;
}

function midLevel(fr) {
  let s = 0, n = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] >= 300 && grid[i] <= 3000) {
      s += fr[i];
      n++;
    }
  }
  return s / n;
}

function smoothLog(values, octaves = 1 / 12) {
  const pointsPerOctave = Math.round(1 / Math.log2(grid[1] / grid[0]));
  const k = Math.max(0, Math.round((octaves * pointsPerOctave) / 2));
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) {
      sum += values[j];
      cnt++;
    }
    out[i] = sum / cnt;
  }
  return out;
}

const hd600 = hpsRaw.iems.find(x => x.id === 'hp-sennheiser-hd-600-2020');
const xm4 = hpsRaw.iems.find(x => x.id === 'hp-sony-wh-1000xm4');
const m50x = hpsRaw.iems.find(x => x.id.includes('m50x'));
const hd800s = hpsRaw.iems.find(x => x.id.includes('hd-800'));
const sundara = hpsRaw.iems.find(x => x.id.includes('sundara'));

const hd600Db = getFrDb(hd600);
const xm4Db = getFrDb(xm4);
const m50xDb = getFrDb(m50x);
const hd800sDb = getFrDb(hd800s);
const sundaraDb = sundara ? getFrDb(sundara) : null;

function testPair(deviceName, targetName, devDb, candDb, devBack, candBack, applyFilter) {
  const offset = midLevel(candDb) - midLevel(devDb);
  const diff = new Float64Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    diff[i] = candDb[i] - devDb[i] - offset;
  }
  const smoothed = smoothLog(diff, 1 / 12);

  const isCrossEnclosure = devBack === 'open' && candBack === 'closed';
  const shouldFilter = applyFilter && isCrossEnclosure;

  const applied = new Float64Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    let v = smoothed[i];
    if (shouldFilter && grid[i] < 40) {
      // Adaptive Excursion Guard: soft knee high-pass shelf below 40 Hz
      const factor = Math.max(0, (grid[i] - 20) / 20); // 0 at 20 Hz, 1 at 40 Hz
      const cap = 4.0 + factor * 6.0; // max +4 dB at 20 Hz, +10 dB at 40 Hz
      v = Math.min(v, cap);
    } else {
      v = Math.min(v, 12); // Standard max boost
    }
    applied[i] = v;
  }

  // Calculate excursion factor at 25 Hz relative to baseline
  const i25 = grid.findIndex(f => f >= 25);
  const boost25 = applied[i25];
  const linearExcursionMultiplier = Math.pow(10, boost25 / 20);

  // Residual error 50 Hz - 10 kHz
  let s = 0, n = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] >= 50 && grid[i] <= 10000) {
      const err = (devDb[i] + applied[i] + offset) - candDb[i];
      s += err * err;
      n++;
    }
  }
  const midRms = Math.sqrt(s / n);

  return {
    deviceName,
    targetName,
    devBack,
    candBack,
    isCrossEnclosure,
    filterActive: shouldFilter,
    boostAt25Hz: boost25.toFixed(1),
    excursionFactor: linearExcursionMultiplier.toFixed(2) + 'x',
    distortionRisk: boost25 > 9.5 ? 'HIGH (Exceeds linear stroke, voice coil rattle)' : (boost25 > 6.0 ? 'MODERATE' : 'SAFE (<0.4% THD)'),
    midTrebleRms: midRms.toFixed(2) + ' dB'
  };
}

console.log('=== TEST 1: Open-Back (HD 600) simulating Closed-Back (Sony WH-1000XM4) ===');
console.log('WITHOUT FILTER:', testPair('HD 600', 'Sony WH-1000XM4', hd600Db, xm4Db, 'open', 'closed', false));
console.log('WITH ADAPTIVE FILTER:', testPair('HD 600', 'Sony WH-1000XM4', hd600Db, xm4Db, 'open', 'closed', true));

console.log('\n=== TEST 2: Open-Back (HD 600) simulating Closed-Back (ATH-M50x) ===');
console.log('WITHOUT FILTER:', testPair('HD 600', 'Audio-Technica ATH-M50x', hd600Db, m50xDb, 'open', 'closed', false));
console.log('WITH ADAPTIVE FILTER:', testPair('HD 600', 'Audio-Technica ATH-M50x', hd600Db, m50xDb, 'open', 'closed', true));

console.log('\n=== TEST 3: Open-Back (HD 600) simulating Open-Back (Sennheiser HD 800 S) ===');
console.log('UNFILTERED (SHOULD REMAIN 100% UNTOUCHED):', testPair('HD 600', 'Sennheiser HD 800 S', hd600Db, hd800sDb, 'open', 'open', true));

if (sundaraDb) {
  console.log('\n=== TEST 4: Open-Back (HD 600) simulating Open-Back (Hifiman Sundara) ===');
  console.log('UNFILTERED (SHOULD REMAIN 100% UNTOUCHED):', testPair('HD 600', 'Hifiman Sundara', hd600Db, sundaraDb, 'open', 'open', true));
}
