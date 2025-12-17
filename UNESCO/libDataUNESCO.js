/*!
 * libDataUNESCO.js
 * UNESCO ICH – vizualizace performativn\u00edho d\u011bdictv\u00ed (Plotly, bez jQuery)
 *
 * O\u010dek\u00e1v\u00e1 JSON pole objekt\u016f s kl\u00ed\u010di:
 *   r (rok), z (ISO2 zem\u011b), n (EN n\u00e1zev), p (EN popis), u (URL), t (tagy), k (RL/UL/Art18)
 *   voliteln\u011b n_cs, p_cs (lokalizace)
 *
 * Vlo\u017e do str\u00e1nky:
 *   <div data-unesco-ich data-json="URL_NA_JSON"> ... </div>
 * Uvnit\u0159 mus\u00ed b\u00fdt divy:
 *   #unescoScatter, #unescoBarKont, #unescoTop10, #unescoPieKon
 * a voliteln\u011b <select class="unesco-lang"> cs/en
 */
(function (w, d) {
  'use strict';

  const CDN_PLOTLY = 'https://cdn.plot.ly/plotly-2.35.2.min.js';

  // --- \u010cesk\u00e9 popisky koncept\u016f (fallback = p\u016fvodn\u00ed)
  const KON_CZ = {
    'Performing arts': 'Performativn\u00ed um\u011bn\u00ed',
    'Dance': 'Tanec',
    'Ritual dance': 'Ritu\u00e1ln\u00ed tanec',
    'Theatre': 'Divadlo',
    'Popular theatre': 'Lidov\u00e9 divadlo',
    'Travelling theatre': 'Ko\u010dovn\u00e9 divadlo',
    'Theatrical performances': 'Divadeln\u00ed performance',
    'Musical performances': 'Hudebn\u00ed performance',
    'Vocal music': 'Vok\u00e1ln\u00ed hudba',
    'Instrumental music': 'Instrument\u00e1ln\u00ed hudba',
    'Choir singing': 'Sborov\u00fd zp\u011bv',
    'Polyphonic singing': 'Polyfonn\u00ed zp\u011bv',
    'Throat singing': 'Hrdeln\u00ed zp\u011bv',
    'Opera': 'Opera',
    'Pantomime': 'Pantomima',
    'Acrobatics': 'Akrobacie',
    'Body percussion': 'Hra na tělo (body percussion)',
    'Puppets': 'Loutky',
    'Hand Puppet': 'Ma\u0148\u00e1sci',
    'jin\u00e9': 'Jin\u00e9'
  };

  const SYM = { 'RL': 'circle', 'UL': 'triangle-up', 'Art18': 'star' };

  // Priorita pro "hlavn\u00ed" koncept (barva + agregace)
  const PRI = [
    'Performing arts','Theatre','Theatrical performances','Popular theatre','Travelling theatre',
    'Dance','Ritual dance',
    'Vocal music','Choir singing','Polyphonic singing','Throat singing','Opera',
    'Instrumental music','Musical performances','Body percussion',
    'Pantomime','Acrobatics','Puppets','Hand Puppet'
  ];

  // --- util
  const $$ = (sel, root) => Array.from((root || d).querySelectorAll(sel));
  const $  = (sel, root) => (root || d).querySelector(sel);

  function esc(x) {
    return String(x ?? '')
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'","&#039;");
  }
  function trunc(txt, n=700) {
    const t = String(txt ?? '').replace(/\s+/g,' ').trim();
    return t.length > n ? t.slice(0, n-1) + '\u2026' : t;
  }
  function uniq(arr) {
    const s = new Set();
    const out = [];
    for (const x of arr) { if (!s.has(x)) { s.add(x); out.push(x); } }
    return out;
  }

function iso2Clean(v) {
  const s = String(v ?? '').toUpperCase().trim();
  const m = s.match(/[A-Z]{2}/);   // vezme první výskyt ISO2
  return m ? m[0] : '';
}

// --- Mobile scaling (inline, no <style>) ---
const ICH_MOBILE_MAX_W = 700;   // px
const ICH_MOBILE_SCALE = 0.85;  // 0.8–0.9 podle chuti
const ICH_LEGEND_Y_MOBILE = -0.10; // posun legendy pod graf na mobilech (víc do mínusu = níž)


function applyMobileLegendPlacement(plot, isMobile) {
  // Přesun legendy pod graf jen na mobilech (Plotly relayout, bez zásahu do CSS)
  if (!plot || !w.Plotly || typeof w.Plotly.relayout !== 'function') return;
  // ulož původní nastavení jen jednou, abychom ho uměli vrátit
  if (!plot.__ICH_ORIG_LEGEND) {
    const l = (plot.layout && plot.layout.legend) ? plot.layout.legend : null;
    const m = (plot.layout && plot.layout.margin) ? plot.layout.margin : null;
    plot.__ICH_ORIG_LEGEND = l ? JSON.parse(JSON.stringify(l)) : null;
    plot.__ICH_ORIG_MARGIN = m ? JSON.parse(JSON.stringify(m)) : null;
    // ulož původní výšku grafu (jen jednou), aby šla po mobile režimu vrátit
    if (plot.__ICH_ORIG_HEIGHT == null) {
      const h0 = (plot.layout && typeof plot.layout.height === 'number') ? plot.layout.height
        : ((plot._fullLayout && typeof plot._fullLayout.height === 'number') ? plot._fullLayout.height : 0);
      if (h0) plot.__ICH_ORIG_HEIGHT = h0;
    }
  }

  const mode = isMobile ? 'mobile' : 'desktop';

  // Plotly může při resize/resetu přepsat pozici legendy; proto nekončíme jen podle "módu",
  // ale ověřujeme, že legenda skutečně odpovídá požadovanému nastavení.
  const curL = (plot._fullLayout && plot._fullLayout.legend) ? plot._fullLayout.legend
    : ((plot.layout && plot.layout.legend) ? plot.layout.legend : {});
  const curM = (plot._fullLayout && plot._fullLayout.margin) ? plot._fullLayout.margin
    : ((plot.layout && plot.layout.margin) ? plot.layout.margin : {});
  const chartId = String(plot.getAttribute && plot.getAttribute('data-ich-chart') || '').trim();
  // na mobilech zmenšíme levý okraj, aby graf nebil úzký; podle typu grafu (scatter potřebuje víc pro popisky)
  const wantL = (chartId === 'podil-konceptu') ? 20
    : (chartId === 'scatter') ? 110
    : (chartId === 'top10') ? 110
    : (chartId === 'kontinenty') ? 90
    : 90;
  const nearly = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-6;

  let mismatch = false;
  if (isMobile) {
    mismatch = mismatch || curL.orientation !== 'h';
    mismatch = mismatch || curL.x !== 0;
    mismatch = mismatch || curL.xanchor !== 'left';
    mismatch = mismatch || !nearly(curL.y, ICH_LEGEND_Y_MOBILE);
    mismatch = mismatch || curL.yanchor !== 'top';
    mismatch = mismatch || (typeof curM.r === 'number' ? curM.r > 80 : false);
    // když Plotly resetne margin.l (nebo zůstane desktopová), graf je na mobilech úzký
    mismatch = mismatch || (typeof curM.l === 'number' ? Math.abs(curM.l - wantL) > 2 : true);
  }

  if (plot.__ICH_LEGEND_MODE === mode && !mismatch) return;
  plot.__ICH_LEGEND_MODE = mode;

  const upd = {};
  if (isMobile) {
    upd['legend.orientation'] = 'h';
    upd['legend.x'] = 0;
    upd['legend.xanchor'] = 'left';
    upd['legend.y'] = ICH_LEGEND_Y_MOBILE;
    upd['legend.yanchor'] = 'top';
    upd['legend.traceorder'] = 'normal';
    upd['margin.l'] = wantL;
    upd['margin.r'] = 20; // na mobilech nema legenda zabírat prostor vpravo
    // margin/height se dopočítá v fitLegendMargin() po vykreslení legendy
  } else {
    // návrat na původní layout (pokud byl)
    const l = plot.__ICH_ORIG_LEGEND;
    if (l) {
      if (l.orientation != null) upd['legend.orientation'] = l.orientation;
      if (l.x != null) upd['legend.x'] = l.x;
      if (l.xanchor != null) upd['legend.xanchor'] = l.xanchor;
      if (l.y != null) upd['legend.y'] = l.y;
      if (l.yanchor != null) upd['legend.yanchor'] = l.yanchor;
      if (l.traceorder != null) upd['legend.traceorder'] = l.traceorder;
    } else {
      // rozumný default: legenda vpravo
      upd['legend.orientation'] = 'v';
      upd['legend.x'] = 1.02;
      upd['legend.xanchor'] = 'left';
      upd['legend.y'] = 1;
      upd['legend.yanchor'] = 'top';
      upd['legend.traceorder'] = 'normal';
    }
    const m = plot.__ICH_ORIG_MARGIN;
    if (m && typeof m.b === 'number') upd['margin.b'] = m.b;
    if (m && typeof m.l === 'number') upd['margin.l'] = m.l;
    if (m && typeof m.r === 'number') upd['margin.r'] = m.r;
    const oh = plot && plot.__ICH_ORIG_HEIGHT;
    if (typeof oh === 'number' && isFinite(oh) && oh > 0) upd['height'] = oh;
  }

  try { w.Plotly.relayout(plot, upd); } catch (e) {}
}

function fitLegendMargin(plot) {
  // Přizpůsob margin.b skutečné výšce legendy (hlavně pro scatter s mnoha položkami).
  // Bez toho vznikají na mobilech zbytečné mezery nebo naopak překryvy.
  if (!plot || !w.Plotly || typeof w.Plotly.relayout !== 'function') return;
  const lg = plot.querySelector('.legend');
  if (!lg || typeof lg.getBBox !== 'function') return;

  let h = 0;
  try { h = lg.getBBox().height || 0; } catch(e) { h = 0; }
  if (!h) return;

  const ob = (plot.__ICH_ORIG_MARGIN && typeof plot.__ICH_ORIG_MARGIN.b === 'number') ? plot.__ICH_ORIG_MARGIN.b : 80;
  const wantB = Math.max(ob, 40) + Math.ceil(h) + 20;

  const curB = (plot._fullLayout && plot._fullLayout.margin && typeof plot._fullLayout.margin.b === 'number')
    ? plot._fullLayout.margin.b
    : ((plot.layout && plot.layout.margin && typeof plot.layout.margin.b === 'number') ? plot.layout.margin.b : 0);

  // udrž plot-area podobně velký: když zvětšíme margin.b kvůli legendě, navýšíme i height o stejný rozdíl
  if (!plot.__ICH_ORIG_HEIGHT) {
    const h0 = (plot.layout && typeof plot.layout.height === 'number') ? plot.layout.height
      : ((plot._fullLayout && typeof plot._fullLayout.height === 'number') ? plot._fullLayout.height : 0);
    if (h0) plot.__ICH_ORIG_HEIGHT = h0;
  }
  const origH = plot.__ICH_ORIG_HEIGHT || 0;
  const wantH = origH ? (origH + (wantB - ob)) : 0;

  const curH = (plot._fullLayout && typeof plot._fullLayout.height === 'number')
    ? plot._fullLayout.height
    : ((plot.layout && typeof plot.layout.height === 'number') ? plot.layout.height : 0);

  const okB = Math.abs(curB - wantB) < 2;
  const okH = (!wantH) || (Math.abs(curH - wantH) < 2);
  if (okB && okH) return;
  if (plot.__ICH_FIT_MARGIN_LOCK) return;

  const upd = { 'margin.b': wantB };
  if (wantH) upd['height'] = wantH;

  plot.__ICH_FIT_MARGIN_LOCK = true;
  const p = w.Plotly.relayout(plot, upd);
  if (p && typeof p.finally === 'function') p.finally(() => { plot.__ICH_FIT_MARGIN_LOCK = false; });
  else plot.__ICH_FIT_MARGIN_LOCK = false;
}


function applyMobileChartScale() {
  const isMobile = window.innerWidth <= ICH_MOBILE_MAX_W;

  // Plotly dává class js-plotly-plot přímo na target div (ten má u nás data-ich-chart)
  // takže bereme přímo tyto divy; kdyby někde byl Plotly vnořený, zkusíme i potomka.
  const holders = document.querySelectorAll('[data-ich-chart]');

  holders.forEach((holder) => {
    const chartId = String(holder.getAttribute('data-ich-chart') || '').trim();
    // Neškáluj malé grafy (pie + kontinenty); škálování je užitečné hlavně pro větší grafy.
    const noScale = (chartId === 'podil-konceptu' || chartId === 'kontinenty');
    const scaleHere = (isMobile && !noScale) ? ICH_MOBILE_SCALE : 1;
    const plot = holder.classList.contains('js-plotly-plot')
      ? holder
      : (holder.querySelector('.js-plotly-plot') || null);
    if (!plot) return;

    // legenda pod graf na mobilech (a znovu po každém Plotly překreslení)
    if (!plot.__ICH_AFTERPLOT_HOOK && typeof plot.on === 'function') {
      plot.__ICH_AFTERPLOT_HOOK = true;
      plot.on('plotly_afterplot', () => {
        if (!plot || !plot.querySelector || (typeof plot.isConnected === 'boolean' && !plot.isConnected)) return;
        const mob = window.innerWidth <= ICH_MOBILE_MAX_W;
        applyMobileLegendPlacement(plot, mob);
        if (mob) fitLegendMargin(plot);
      });
    }
    // Relayout (legenda + margin) dělej jen při změně režimu; jinak je to zbytečně drahé.
    const mobNow = !!isMobile;
    const mobPrev = !!plot.__ICH_WAS_MOBILE;
    if (mobNow !== mobPrev) {
      applyMobileLegendPlacement(plot, mobNow);
      if (mobNow) fitLegendMargin(plot);
      plot.__ICH_WAS_MOBILE = mobNow;
    }
    if (scaleHere === 1) {
      // reset
      plot.style.transform = '';
      plot.style.transformOrigin = '';
      plot.style.width = '';
      plot.style.height = '';
      plot.style.maxWidth = '';
      plot.style.marginLeft = '';
      holder.style.marginLeft = '';
      holder.style.marginRight = '';
      holder.style.paddingLeft = '';
      holder.style.paddingRight = '';
      if (plot.parentElement) plot.parentElement.style.overflow = '';
      return;
    }

    // aby to nebylo useknuté, dej parent overflow visible
    if (plot.parentElement) plot.parentElement.style.overflow = 'visible';

    // škáluj obsah
    if (scaleHere === 1) {
      plot.style.transform = '';
      plot.style.transformOrigin = '';
    } else {
    plot.style.transform = `scale(${scaleHere})`;
    plot.style.transformOrigin = 'top left';
    }

    // kompenzuj šířku (jinak by graf byl jen "menší" v rámci původní šířky)
    plot.style.width = '100%';
    plot.style.maxWidth = '100%';
    plot.style.marginLeft = '0';
    holder.style.marginLeft = '0';
    holder.style.marginRight = '0';
    holder.style.paddingLeft = '0';
    holder.style.paddingRight = '0';

    // výšku nech být (nebude to řezat, jen případně zůstane víc místa)
  });
}

// zavolej po prvním vykreslení a při změně velikosti/orientace
function setupMobileChartScale() {
  // nastav jen jednou (renderAll/doRender se může volat opakovaně)
  if (w.__ICH_SCALE_SETUP) return;
  w.__ICH_SCALE_SETUP = true;

  let resizeT = null;
  let pending = false;

  const run = () => {
    pending = false;
    applyMobileChartScale();
    // Plotly občas dopočítá legendu až po chvíli; jeden levný "druhý průchod" to srovná,
    // bez toho, abychom dělali 3× relayout při každém resize.
    setTimeout(applyMobileChartScale, 90);
  };

  const schedule = () => {
    if (pending) return;
    pending = true;
    w.requestAnimationFrame(run);
  };

  // initial
  schedule();

  const onResize = () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(schedule, 160);
  };

  w.addEventListener('resize', onResize, { passive: true });
  w.addEventListener('orientationchange', () => { clearTimeout(resizeT); schedule(); }, { passive: true });
}
function konCz(k) { return KON_CZ[k] || k || KON_CZ['jin\u00e9']; }
  function nazevZeme(kod) {
    try { return new Intl.DisplayNames(['cs'], { type: 'region' }).of(kod) || kod; }
    catch(e){ return kod; }
  }
  function hlavniKon(tagy) {
    const t = Array.isArray(tagy) ? tagy : [];
    for (const k of PRI) if (t.includes(k)) return k;
    return t[0] || 'jin\u00e9';
  }

  // Jazyk: cs/en (cs = preferuj n_cs/p_cs)
  function txtLang(o, key, lang) {
    if (lang === 'en') return String(o?.[key] ?? '');
    const v = o?.[`${key}_${lang}`];
    return (v && String(v).trim()) ? String(v) : String(o?.[key] ?? '');
  }

  // --- Styles injected via JS (WordPress-friendly)
  function injectStylesOnce() {
    if (d.getElementById('unescoIchStyles')) return;
    const st = d.createElement('style');
    st.id = 'unescoIchStyles';
    st.textContent = `
/* UNESCO ICH embed */
.unesco-ich-app{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.unesco-ich-toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:0 0 8px 0}
.unesco-ich-toolbar .lbl{display:flex;gap:8px;align-items:center;font-size:14px}
.unesco-ich-toolbar select{padding:6px 10px;border:1px solid #ccc;border-radius:10px}
.unesco-ich-section{margin:16px 0 26px 0}
.unesco-ich-chart{width:100%;min-height:420px}
@media (min-width: 980px){
  #unescoScatter.unesco-ich-chart{min-height:620px}
}
.unesco-ich-note{font-size:13px;opacity:.8;margin:6px 0 0 0}
.unesco-ich-drawer{
  position:fixed;left:0;right:0;bottom:0;height:34vh;max-height:40vh;
  background:rgba(250,250,250,.98);border-top:1px solid #ddd;box-shadow:0 -10px 30px rgba(0,0,0,.08);
  transform:translateY(110%);transition:transform 180ms ease;z-index:9999;display:flex;flex-direction:column
}
.unesco-ich-drawer.open{transform:translateY(0)}
.unesco-ich-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-bottom:1px solid #e6e6e6;background:rgba(255,255,255,.9)}
.unesco-ich-drawer-title{font-weight:650;font-size:14px;line-height:1.2;margin:0}
.unesco-ich-drawer-meta{font-size:12px;opacity:.75;margin-top:2px}
.unesco-ich-btn{border:1px solid #ccc;background:#fff;border-radius:10px;padding:6px 10px;cursor:pointer;font-size:13px}
.unesco-ich-drawer-body{padding:12px 14px;overflow:auto;font-size:13px;line-height:1.45;word-break:break-word;white-space:normal}
.unesco-ich-pill{display:inline-block;padding:2px 8px;border:1px solid #ddd;border-radius:999px;font-size:12px;opacity:.92;margin-right:6px;margin-bottom:6px}
`;
    d.head.appendChild(st);
  }

  // --- load Plotly if missing
  function loadScriptOnce(src, globalName) {
    return new Promise((resolve, reject) => {
      if (globalName && w[globalName]) return resolve();
      const existing = $$(`script[src="${src}"]`)[0];
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Script load error: ' + src)));
        return;
      }
      const s = d.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Script load error: ' + src));
      d.head.appendChild(s);
    });
  }

  // --- data
  async function getJSON(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error('Nelze na\u010d\u00edst JSON: ' + res.status);
    return await res.json();
  }

  // --- Continents: use REST Countries as robust mapping, cached in localStorage
  const KON_CONT = { 'Europe':'Evropa','Asia':'Asie','Africa':'Afrika','Americas':'Amerika','Oceania':'Oce\u00e1nie','Antarctic':'Antarktida' };

  async function loadContinentMap(iso2List) {
    const key = 'unescoIchContMapV1';
    try {
      const cached = JSON.parse(localStorage.getItem(key) || '{}');
      const need = iso2List.filter(z => !cached[z]);
      if (!need.length) return cached;

      // REST Countries supports codes in one request
      const url = 'https://restcountries.com/v3.1/alpha?codes=' + encodeURIComponent(need.join(','));
      const r = await fetch(url, { credentials:'omit' });
      if (r.ok) {
        const arr = await r.json();
        for (const it of arr) {
          const cca2 = (it.cca2 || '').toUpperCase();
          const cont = (it.region || '').trim();
          if (cca2) cached[cca2] = KON_CONT[cont] || cont || 'Neur\u010deno';
        }
      }
      localStorage.setItem(key, JSON.stringify(cached));
      return cached;
    } catch(e) {
      // fallback: no storage / fetch blocked
      const mp = {};
      iso2List.forEach(z => mp[z] = 'Neur\u010deno');
      return mp;
    }
  }

  // --- Drawer UI
  function ensureDrawer() {
    let dr = d.getElementById('unescoIchDrawer');
    if (dr) return dr;

    dr = d.createElement('div');
    dr.id = 'unescoIchDrawer';
    dr.className = 'unesco-ich-drawer';
    dr.setAttribute('aria-hidden','true');
    dr.innerHTML = `
<div class="unesco-ich-drawer-head">
  <div>
    <div class="unesco-ich-drawer-title" id="unescoIchDrawerTitle">Detail</div>
    <div class="unesco-ich-drawer-meta" id="unescoIchDrawerMeta"></div>
  </div>
  <button type="button" class="unesco-ich-btn" id="unescoIchDrawerClose">Zav\u0159\u00edt</button>
</div>
<div class="unesco-ich-drawer-body" id="unescoIchDrawerBody">\u017d\u00e1dn\u00fd z\u00e1znam nen\u00ed vybr\u00e1n.</div>
`;
    d.body.appendChild(dr);

    $('#unescoIchDrawerClose').addEventListener('click', () => closeDrawer());
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

    return dr;
  }

  function openDrawer() {
    const dr = ensureDrawer();
    dr.classList.add('open');
    dr.setAttribute('aria-hidden','false');
  }
  function closeDrawer() {
    const dr = ensureDrawer();
    dr.classList.remove('open');
    dr.setAttribute('aria-hidden','true');
  }

  // --- render charts
  function buildBody(raw, lang) {
    return raw
      .filter(r => Number.isFinite(Number(r.r)))
      .map(r => ({
        ...r,
        _kon: hlavniKon(r.t),
        _zlab: `${nazevZeme(r.z)} (${r.z})`,
        _n: txtLang(r, 'n', lang),
        _p: txtLang(r, 'p', lang)
      }));
  }

  function legendForWidth(width, kind) {
    // kind: 'scatter' | 'pie' | 'bar'
    if (kind === 'pie') {
      // Pie: on mobile, start with legend already under the chart (prevents tiny first render).
      if (width < ICH_MOBILE_MAX_W) {
        return { orientation:'h', x:0, y:ICH_LEGEND_Y_MOBILE, xanchor:'left', yanchor:'top', font:{ size: 10 } };
      }
      return { orientation:'v', x:1.02, y:1, xanchor:'left', yanchor:'top', font:{ size: 11 } };
    }
    // scatter has many items: on narrow, put legend at top-left inside to avoid drifting
    if (width < 720) {
      return { orientation:'h', x:0, y:1.02, xanchor:'left', yanchor:'bottom', font:{ size: 10 } };
    }
    // wide: right side, scrollable
    return { orientation:'v', x:1.02, y:1, xanchor:'left', yanchor:'top', font:{ size: 11 } };
  }

function sortZemeAZ(arr) {
  // arr = pole stringů typu "Česko (CZ)" apod.
  return arr.slice().sort((a, b) => {
    // vytáhni "název" bez "(XX)"
    const na = String(a).replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();
    const nb = String(b).replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();

    const c = na.localeCompare(nb, 'cs', { sensitivity: 'base' });
    if (c !== 0) return c;

    // tie-break: kód v závorkách
    const ka = (String(a).match(/\(([A-Z]{2})\)\s*$/) || [,''])[1];
    const kb = (String(b).match(/\(([A-Z]{2})\)\s*$/) || [,''])[1];
    return ka.localeCompare(kb, 'en');
  });
}

  function renderScatter(div, body, lang) {

// země pro osu Y: jen ty, které jsou v aktuálním body (už mají _zlab)
const VSE_ZEME = sortZemeAZ(uniq(body.map(r => r._zlab)));

const N = VSE_ZEME.length;
const priSorted = PRI.slice().sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

// POZOR: u kategorií je první položka dole → otočíme range,
// aby A bylo nahoře a Z dole
const yRange = [N - 0.5, -0.5];

    const skup = new Map();
    for (const b of body) {
      // Zápis může mít více tagů: do skupin ho přidáme do všech vybraných tagů (PRI).
      // Díky tomu legenda ve scatterboxu filtruje podle všech tagů, ne jen podle „hlavního“.
      const tags = Array.isArray(b?.t) ? b.t : [];
      const vybrane = tags.filter(t => priSorted.includes(t));
      const pouzite = (vybrane.length ? vybrane : ['jiné']);
      for (const kon of pouzite) {
        if (!skup.has(kon)) skup.set(kon, []);
        skup.get(kon).push(b);
      }
    }
    const klice = [...skup.keys()].sort((a,b) => {
      const ia = priSorted.indexOf(a), ib = priSorted.indexOf(b);
      if (ia === -1 && ib === -1) return konCz(a).localeCompare(konCz(b), 'cs');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const traces = [];
    for (const kon of klice) {
      const pts = skup.get(kon);
      const xs=[], ys=[], sy=[], cd=[], ht=[];
      for (const p of pts) {
        const rok = Number(p.r);
        xs.push(rok + (Math.random()-0.5)*0.44);
        ys.push(p._zlab);
        sy.push(SYM[p.k] || 'circle');
        cd.push(p);
	const nEN = (txtLang(p, 'n', 'en') || '').trim();
	const title = nEN || p._n || '(bez názvu)';

	ht.push(`<b>${esc(title)}</b><br>${esc(p._zlab)} • ${esc(rok)}<br><span style="opacity:.75">Pro oficiální popis položky klikněte.</span>`);
      }
      traces.push({
        type:'scatter', mode:'markers',
        name: konCz(kon),
        x: xs, y: ys, customdata: cd,
        hoverinfo:'text', text: ht, hovertemplate:'%{text}<extra></extra>',
        marker:{ size: 6, opacity: 0.85, symbol: sy }
      });
    }

    const pxNaZemi = 22;
    const minVyska = 650;
    const rezervaLegenda = 120;
    const vyska = Math.max(minVyska, VSE_ZEME.length*pxNaZemi) + rezervaLegenda;

    const w0 = div.clientWidth || 900;
    const leg = legendForWidth(w0, 'scatter');
    const marginR = (leg.orientation === 'v') ? 260 : 30;
    const marginB = (leg.orientation === 'h') ? 80 : 70;
    const isMobile = (w.innerWidth <= ICH_MOBILE_MAX_W);
    const marginL = isMobile ? 110 : 260;

    const layout = {
      title: { text: 'Z\u00e1pisy podle konceptů, zem\u00ed a let (klikni pro detail)', font:{ size: 16 } },
      height: vyska,
      margin: { l: marginL, r: marginR, t: 60, b: marginB },
      showlegend: true,
      legend: leg,
      xaxis: { title: 'Rok z\u00e1pisu', dtick: 1, zeroline: false },
      yaxis: {
        title: '',
        type:'category',
        categoryorder:'array',
        categoryarray: VSE_ZEME,
        range: yRange,
        autorange:false,
        tickfont:{ size: 10 },
        ticks:'outside',
        ticklen: 4,
        automargin:true,
        showgrid:false
      }
    };

    w.Plotly.react(div, traces, layout, { responsive:true, displaylogo:false })
      .then(() => {
        div.removeAllListeners?.('plotly_click');
        div.on('plotly_click', (ev) => {
const p = ev?.points?.[0]?.customdata;
if (!p) return;

const nEN = (txtLang(p, 'n', 'en') || '').trim();
const pEN = (txtLang(p, 'p', 'en') || '').trim();

// jen pro scatterbox: do draweru pošli kopii s EN texty
showDrawerFor({
  ...p,
  _n: nEN || p._n,
  _p: pEN || p._p
});
        });
      });
  }

  function renderTop10(div, body) {
    const mp = new Map();
    for (const b of body) mp.set(b._zlab, (mp.get(b._zlab)||0)+1);
    const top = [...mp.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
    const y = top.map(x=>x[0]).reverse();
    const x = top.map(x=>x[1]).reverse();

    const trace = { type:'bar', orientation:'h', x, y,
      hovertemplate: '%{y}<br>Po\u010det: %{x}<extra></extra>'
    };

    const isMobile = (w.innerWidth <= ICH_MOBILE_MAX_W);
    const layout = {
      title: { text: 'Top 10 zem\u00ed podle po\u010dtu z\u00e1pis\u016f', font:{ size: 16 } },
      margin: { l: (isMobile ? 110 : 260), r: 30, t: 60, b: 60 },
      height: 520,
      xaxis: { title: 'Po\u010det z\u00e1pis\u016f (z\u00e1znam\u00d7zem\u011b)' },
      yaxis: { title: '' },
      showlegend:false
    };

    w.Plotly.react(div, [trace], layout, { responsive:true, displaylogo:false });
  }

  function renderPie(div, body) {
    const mp = new Map();
    const priSet = new Set(PRI);

    for (const b of body) {
      const tags = Array.isArray(b?.t) ? b.t : [];
      const used = new Set();
      for (const t of tags) if (priSet.has(t)) used.add(t);

      if (used.size === 0) {
        const fallback = (b._kon || hlavniKon(tags) || 'jiné');
        mp.set(fallback, (mp.get(fallback) || 0) + 1);
      } else {
        for (const t of used) mp.set(t, (mp.get(t) || 0) + 1);
      }
    }
    const entries = [...mp.entries()].sort((a,b)=>b[1]-a[1]);
    const labels = entries.map(e=>konCz(e[0]));
    const values = entries.map(e=>e[1]);

    const w0 = div.clientWidth || w.innerWidth || 900;
    const isMobile = (w.innerWidth <= ICH_MOBILE_MAX_W);
    const leg = legendForWidth(w0, 'pie');

    const trace = {
      type:'pie',
      labels, values,
      textinfo: 'none', // žádné šipky/odváděné popisky mimo canvas
      hovertemplate: '<b>%{label}</b><br>Počet: %{value}<br>Podíl: %{percent}<extra></extra>'
    };

    const layout = {
      title: { text: 'Podíl konceptů v celku', font:{ size: 16 } },
      margin: { l: 20, r: (isMobile ? 20 : 260), t: 60, b: (isMobile ? 120 : 80) },
      height: (isMobile ? 620 : 540),
      showlegend: true,
      legend: leg
    };

    w.Plotly.react(div, [trace], layout, { responsive:true, displaylogo:false });
  }

  function renderContinents(div, body, contMap) {
    const kontPor = ['Afrika','Amerika','Asie','Evropa','Oce\u00e1nie','Antarktida','Neur\u010deno'];

    // agregace kontinent->koncept->count
    const agg = new Map();

    for (const k of kontPor) agg.set(k, new Map());

        const priSet = new Set(PRI);

    for (const b of body) {
      const z = iso2Clean(b?.z);
      const kontinent = contMap[z] || 'Neurčeno';
      const m = agg.get(kontinent) || new Map();

      const tags = Array.isArray(b?.t) ? b.t : [];
      const used = new Set();
      for (const t of tags) if (priSet.has(t)) used.add(t);

      if (used.size === 0) {
        const fallback = (b._kon || hlavniKon(tags) || 'jiné');
        m.set(fallback, (m.get(fallback) || 0) + 1);
      } else {
        for (const t of used) m.set(t, (m.get(t) || 0) + 1);
      }

      agg.set(kontinent, m);
    }

    const kontPorFiltered = kontPor.filter(k => (agg.get(k)?.size || 0) > 0);

    const konSet = new Set();
    for (const m of agg.values()) for (const k of m.keys()) konSet.add(k);
    const konList = [...konSet].sort((a,b) => {
      const ia = PRI.indexOf(a), ib = PRI.indexOf(b);
      if (ia === -1 && ib === -1) return konCz(a).localeCompare(konCz(b), 'cs');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const traces = konList.map(kon => {
      const x=[], y=[];
      for (const kontName of kontPorFiltered) {
        y.push(kontName);
        x.push(agg.get(kontName)?.get(kon) || 0);
      }
      return {
        type:'bar',
        name: konCz(kon),
        x, y, orientation:'h',
        hovertemplate: `<b>${esc(konCz(kon))}</b><br>%{y}: %{x}<extra></extra>`
      };
    });

    const w0 = div.clientWidth || 900;
    const isMobile = (w.innerWidth <= ICH_MOBILE_MAX_W);
    const leg = (w0 < 720)
      ? { orientation:'h', x:0, y:1.02, xanchor:'left', yanchor:'bottom', font:{size:10} }
      : { orientation:'v', x:1.02, y:1, xanchor:'left', yanchor:'top', font:{size:11} };

    const layout = {
      title: { text: 'Po\u010det z\u00e1pis\u016f a konceptů podle kontinent\u016f', font:{ size: 16 } },
      barmode: 'stack',
      height: 560,
      margin: { l: (isMobile ? 90 : 140), r: (leg.orientation==='v'?260:20), t: 60, b: (leg.orientation==='h'?90:70) },
      xaxis: { title: 'Po\u010det z\u00e1pis\u016f s daným štítkem' },
      yaxis: { title: '' },
      showlegend: true,
      legend: leg
    };

    w.Plotly.react(div, traces, layout, { responsive:true, displaylogo:false });
  }

  function showDrawerFor(p) {
    ensureDrawer();
    const title = $('#unescoIchDrawerTitle');
    const meta  = $('#unescoIchDrawerMeta');
    const body  = $('#unescoIchDrawerBody');

    const kon = konCz(p._kon || hlavniKon(p.t));
    const zlab = p._zlab || `${nazevZeme(p.z)} (${p.z})`;
    const rok = Number(p.r);

    title.textContent = p._n || '(bez n\u00e1zvu)';
    meta.innerHTML =
      `<span class="unesco-ich-pill">${esc(p.k || '')}</span>` +
      `<span class="unesco-ich-pill">${esc(kon)}</span>` +
      `<span class="unesco-ich-pill">${esc(zlab)}</span>` +
      `<span class="unesco-ich-pill">${esc(rok)}</span>`;

    const tagy = Array.isArray(p.t) ? p.t : [];
    const tagHtml = tagy.length
      ? `<div style="margin-top:10px;opacity:.85;"><b>Tagy:</b> ${tagy.map(x => `<span class="unesco-ich-pill">${esc(konCz(x))}</span>`).join(' ')}</div>`
      : '';

    const popis = p._p ? `<div style="margin-top:10px;">${esc(trunc(p._p))}</div>` : '';
    const odkaz = p.u ? `<div style="margin-top:10px;"><a href="${esc(p.u)}" target="_blank" rel="noopener noreferrer">${esc(p.u)}</a></div>` : '';

    body.innerHTML = `${popis}${odkaz}${tagHtml}`;
    openDrawer();
  }

  // --- main render for one root
  async function renderAll(root) {
    injectStylesOnce();
    await loadScriptOnce(CDN_PLOTLY, 'Plotly');
    ensureDrawer();

    const url = root.getAttribute('data-json');
    if (!url) throw new Error('Chyb\u00ed data-json.');

    const langSel = $('.unesco-lang', root);
    const getLang = () => (langSel && langSel.value) ? langSel.value : 'cs';

const elScatter = root.querySelector('[data-ich-chart="scatter"]');
const elKont = root.querySelector('[data-ich-chart="kontinenty"]');
const elTop10 = root.querySelector('[data-ich-chart="top10"]');
const elPie = root.querySelector('[data-ich-chart="podil-konceptu"]');

// PATCH: už nevyžadujeme všechny divy — renderujeme jen ty, které existují
if (!elScatter && !elKont && !elTop10 && !elPie) {
  throw new Error('V kontejneru chybí jakýkoli grafový div (data-ich-chart).');
}


    const raw = await getJSON(url);

    let contMap = null;

    const doRender = async () => {
      const lang = getLang();
      const body = buildBody(raw, lang);

      // continent map once
      if (!contMap) {
        const iso2 = uniq(body.map(b => String(b.z || '').toUpperCase()).filter(Boolean));
        contMap = await loadContinentMap(iso2);
      }

if (elPie) renderPie(elPie, body, lang);
if (elKont) renderContinents(elKont, body, contMap);
if (elTop10) renderTop10(elTop10, body, lang);
if (elScatter) renderScatter(elScatter, body, lang);
setupMobileChartScale();

    };

    await doRender();

    if (langSel) {
      langSel.addEventListener('change', () => {
        closeDrawer();
        doRender();
      });
    }

    // Re-layout on resize (legend positioning)
    const ro = new ResizeObserver(() => {
      // Debounce-ish: Plotly is heavy, so only rerender after user stops resizing
      if (root._unescoIchResizeT) clearTimeout(root._unescoIchResizeT);
      root._unescoIchResizeT = setTimeout(() => { doRender(); }, 200);
    });
    ro.observe(root);
  }

  function initAll() {
    const roots = $$('[data-unesco-ich]');
    roots.forEach((r) => {
      renderAll(r).catch((e) => {
        console.error(e);
        r.innerHTML = `<div class="unesco-ich-app"><b>Chyba:</b> ${esc(e?.message || e)}</div>`;
      });
    });
  }

  // public
  w.UNESCO_ICH = { initAll, renderAll, closeDrawer };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', initAll);
  else initAll();

})(window, document);
