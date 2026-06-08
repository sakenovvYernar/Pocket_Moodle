require('dotenv').config();

const fs = require('fs');
const duCache = require('../services/duCacheService');

const DEFAULT_PREFIXES = [
  'SE', 'CS', 'IT', 'IS', 'AI', 'DS', 'BD', 'BDA', 'EE', 'RET', 'RE',
  'MT', 'MCS', 'SCE', 'CSE', 'CYB', 'ISE', 'FIN', 'AC'
];
const DEFAULT_YEARS = ['19', '20', '21', '22', '23', '24', '25', '26'];
const DEFAULT_NUMBERS = Array.from({ length: 30 }, (_, index) => String(index + 1).padStart(2, '0'));

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function groupsFromFile(filePath) {
  if (!filePath) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  return text
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function generatedGroups() {
  const prefixes = splitList(argValue('prefixes') || process.env.DU_GROUP_PREFIXES).length
    ? splitList(argValue('prefixes') || process.env.DU_GROUP_PREFIXES)
    : DEFAULT_PREFIXES;
  const years = splitList(argValue('years') || process.env.DU_GROUP_YEARS).length
    ? splitList(argValue('years') || process.env.DU_GROUP_YEARS)
    : DEFAULT_YEARS;
  const numbers = splitList(argValue('numbers') || process.env.DU_GROUP_NUMBERS).length
    ? splitList(argValue('numbers') || process.env.DU_GROUP_NUMBERS)
    : DEFAULT_NUMBERS;

  const groups = [];
  for (const prefix of prefixes) {
    for (const year of years) {
      for (const number of numbers) {
        groups.push(`${prefix}-${year}${number}`);
      }
    }
  }
  return groups;
}

function allGroups() {
  const explicit = splitList(argValue('groups'));
  const fromFile = groupsFromFile(argValue('file'));
  const generated = process.argv.includes('--generated') ? generatedGroups() : [];
  return [...new Set([...explicit, ...fromFile, ...generated].map((item) => item.toUpperCase()))].sort();
}

async function main() {
  const groups = allGroups();
  if (!groups.length) {
    console.error('Pass --groups=SE-2309,EE-2502, --file=groups.txt, or --generated');
    process.exit(1);
  }

  const saveEmpty = process.argv.includes('--save-empty');
  const chunkSize = Number(argValue('chunk') || 25);
  const results = [];

  console.log(`Syncing ${groups.length} DU group candidates. saveEmpty=${saveEmpty}`);

  for (let index = 0; index < groups.length; index += chunkSize) {
    const chunk = groups.slice(index, index + chunkSize);
    const chunkResults = [];

    for (const group of chunk) {
      try {
        const data = await duCache.syncGroupSchedule(group);
        const itemCount = countItems(data.schedule);
        if (!saveEmpty && itemCount === 0) {
          await duCache.deleteCachedGroupSchedule(group).catch(() => {});
        }
        chunkResults.push({ group, ok: true, itemCount, saved: saveEmpty || itemCount > 0 });
      } catch (err) {
        chunkResults.push({ group, ok: false, status: err.status || 500, error: err.message });
      }
    }

    results.push(...chunkResults);
    const done = Math.min(index + chunk.length, groups.length);
    const nonEmpty = results.filter((item) => item.itemCount > 0).length;
    console.log(`Progress ${done}/${groups.length}; non-empty=${nonEmpty}`);
  }

  const summary = {
    total: results.length,
    ok: results.filter((item) => item.ok).length,
    nonEmpty: results.filter((item) => item.itemCount > 0).length,
    saved: results.filter((item) => item.saved).length,
    failed: results.filter((item) => !item.ok).length
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(results.filter((item) => item.itemCount > 0), null, 2));
}

function countItems(value) {
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.list)) return value.list.length;
  if (Array.isArray(value?.content)) return value.content.length;
  if (Array.isArray(value?.data)) return value.data.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return value ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
