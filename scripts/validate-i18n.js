const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('public/index.html', 'utf8');

// 1. Syntax-check every inline script
const scripts = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html)) !== null) scripts.push(m[1]);
scripts.forEach((code, i) => {
  try {
    new vm.Script(code);
    console.log(`Script ${i + 1} syntax OK`);
  } catch (e) {
    console.error(`Script ${i + 1} syntax error:`, e.message);
    process.exit(1);
  }
});

// 2. Extract dictionary (flat keys)
const dictMatch = html.match(/const dict = ({[\s\S]*?});/);
if (!dictMatch) {
  console.error('Could not extract dictionary');
  process.exit(1);
}
const dict = new Function('return ' + dictMatch[1])();

// 3. Collect data-i18n keys
const keySet = new Set();
const keyRe = /data-i18n="([^"]+)"/g;
while ((m = keyRe.exec(html)) !== null) keySet.add(m[1]);

const missingEn = [];
const missingEs = [];
keySet.forEach(key => {
  if (dict.en[key] === undefined) missingEn.push(key);
  if (dict.es[key] === undefined) missingEs.push(key);
});
if (missingEn.length) {
  console.error('Missing EN keys:', missingEn);
  process.exit(1);
}
if (missingEs.length) {
  console.error('Missing ES keys:', missingEs);
  process.exit(1);
}
console.log(`Checked ${keySet.size} data-i18n keys — all present in EN and ES.`);
