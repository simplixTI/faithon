const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('public/index.html', 'utf8');

// Extract i18n script (first inline script)
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error('No inline script found');
  process.exit(1);
}
const i18nCode = scriptMatch[1];

// Build a minimal fake DOM with all data-i18n elements and the lang switcher
const dataElements = [];
const keyRe = /data-i18n="([^"]+)"/g;
let m;
const seen = new Set();
while ((m = keyRe.exec(html)) !== null) {
  const key = m[1];
  if (seen.has(key)) continue;
  seen.add(key);
  const el = {
    dataset: { i18n: key },
    _text: '',
    _html: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this._text = v.replace(/<[^>]+>/g, ''); },
    setAttribute(name, val) { if (name === 'aria-pressed') this._pressed = val; if (name === 'placeholder') this._placeholder = val; },
    closest(sel) { return null; }
  };
  // capture data-i18n-attr for placeholder
  const attrMatch = html.slice(m.index - 40, m.index).match(/data-i18n-attr="([^"]+)"/);
  if (attrMatch) el.dataset.i18nAttr = attrMatch[1];
  dataElements.push(el);
}

const langButtons = [
  { dataset: { lang: 'en' }, _pressed: 'false', setAttribute(n, v) { if (n === 'aria-pressed') this._pressed = v; }, closest() { return this; } },
  { dataset: { lang: 'es' }, _pressed: 'false', setAttribute(n, v) { if (n === 'aria-pressed') this._pressed = v; }, closest() { return this; } }
];

function makeContext(navLang) {
  const docListeners = {};
  const winListeners = {};
  const storage = {};
  const root = { lang: 'en' };
  return {
    document: {
      documentElement: {
        get lang() { return root.lang; },
        setAttribute(n, v) { if (n === 'lang') root.lang = v; }
      },
      querySelectorAll(sel) {
        if (sel === '.lang-switch button') return langButtons;
        if (sel === '[data-i18n]') return dataElements;
        return [];
      },
      addEventListener(type, fn) {
        docListeners[type] = docListeners[type] || [];
        docListeners[type].push(fn);
      }
    },
    localStorage: {
      getItem(k) { return storage[k] || null; },
      setItem(k, v) { storage[k] = v; }
    },
    navigator: { language: navLang },
    window: {
      dispatchEvent(e) {
        const list = winListeners[e.type] || [];
        list.forEach(fn => fn(e));
      },
      addEventListener(type, fn) {
        winListeners[type] = winListeners[type] || [];
        winListeners[type].push(fn);
      }
    },
    CustomEvent: class CustomEvent { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } },
    console
  };
}

function runTest(navLang, expectedInitial) {
  const ctx = makeContext(navLang);
  vm.createContext(ctx);
  vm.runInContext(i18nCode, ctx);
  if (ctx.window.i18n.currentLang !== expectedInitial) {
    console.error(`Expected initial lang ${expectedInitial}, got ${ctx.window.i18n.currentLang} (navigator=${navLang})`);
    process.exit(1);
  }
  // Toggle to Spanish
  ctx.window.i18n.applyLang('es');
  const heroTitle = dataElements.find(e => e.dataset.i18n === 'hero.title.line1');
  const cta = dataElements.find(e => e.dataset.i18n === 'cta.textPrayStart');
  if (heroTitle.textContent !== 'Nunca enfrentes') {
    console.error('ES translation not applied to hero.title.line1:', heroTitle.textContent);
    process.exit(1);
  }
  if (cta.textContent !== 'Envía PRAY para empezar') {
    console.error('ES translation not applied to cta.textPrayStart:', cta.textContent);
    process.exit(1);
  }
  const esBtn = langButtons.find(b => b.dataset.lang === 'es');
  if (esBtn._pressed !== 'true') {
    console.error('ES button not marked pressed');
    process.exit(1);
  }
  console.log(`Initial lang detection OK for navigator=${navLang}: ${expectedInitial}`);
}

runTest('en-US', 'en');
runTest('es-ES', 'es');
runTest('es-MX', 'es');

// Test persistence simulation: after ES, storage should have es
const ctx = makeContext('en-US');
vm.createContext(ctx);
vm.runInContext(i18nCode, ctx);
ctx.window.i18n.applyLang('es');
if (ctx.localStorage.getItem('faithon-lang') !== 'es') {
  console.error('Language preference not persisted');
  process.exit(1);
}
console.log('localStorage persistence OK');

console.log('\nAll i18n toggle tests passed.');
