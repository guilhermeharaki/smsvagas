(() => {
  'use strict';

  const TOTAL = 10_000;
  const codes = Array.from({ length: TOTAL }, (_, n) => `SMS${String(n).padStart(4, '0')}`);
  const els = {
    input: document.querySelector('#codes-input'),
    file: document.querySelector('#file-input'),
    fileName: document.querySelector('#file-name'),
    apply: document.querySelector('#apply-list'),
    clear: document.querySelector('#clear-list'),
    message: document.querySelector('#parse-message'),
    search: document.querySelector('#search-code'),
    grid: document.querySelector('#code-grid'),
    empty: document.querySelector('#empty-state'),
    filterButtons: [...document.querySelectorAll('.filter-tab')],
    size: document.querySelector('#page-size'),
    results: document.querySelector('#results-count'),
    pageIndicator: document.querySelector('#page-indicator'),
    prev: document.querySelector('#prev-page'),
    next: document.querySelector('#next-page'),
    total: document.querySelector('#total-count'),
    free: document.querySelector('#free-count'),
    used: document.querySelector('#used-count'),
    source: document.querySelector('.grid-title-group .section-kicker'),
    toast: document.querySelector('#toast'),
  };

  let usedCodes = new Set();
  let filter = 'free';
  let page = 0;
  let pageSize = Number(els.size.value);
  let hasLoadedList = false;
  let toastTimer;

  const number = value => new Intl.NumberFormat('pt-BR').format(value);

  function parseCodes(text) {
    const matches = [...text.matchAll(/\bSMS\s*[-:]?\s*(\d+)\b/gi)];
    const found = new Set();
    let rejected = 0;
    let validOccurrences = 0;
    for (const match of matches) {
      const digits = match[1];
      const numeric = Number(digits);
      if (digits.length > 4 || numeric > 9999) {
        rejected += 1;
        continue;
      }
      validOccurrences += 1;
      found.add(`SMS${String(numeric).padStart(4, '0')}`);
    }
    const smsMarkers = (text.match(/\bSMS\b/gi) || []).length;
    rejected += Math.max(0, smsMarkers - matches.length);
    return { found, rejected, duplicates: Math.max(0, validOccurrences - found.size) };
  }

  function announce(message, tone = '') {
    els.message.textContent = message;
    els.message.classList.remove('is-success', 'is-warning');
    if (tone) els.message.classList.add(tone);
  }

  function updateSummary() {
    const used = usedCodes.size;
    els.total.textContent = number(TOTAL);
    els.used.textContent = number(used);
    els.free.textContent = number(TOTAL - used);
    const usedList = document.querySelector('#used-code-list');
    const usedListCount = document.querySelector('#used-list-count');
    if (usedList) usedList.value = [...usedCodes].sort().join('\n');
    if (usedListCount) usedListCount.textContent = `${number(used)} código(s) na lista`;
    if (els.source) {
      els.source.textContent = hasLoadedList ? 'VISÃO GERAL · LISTA CARREGADA' : 'VISÃO GERAL · IMPORTE UMA LISTA';
    }
  }

  function normalizedQuery() {
    const raw = els.search.value.trim().toUpperCase();
    const compact = raw.replace(/[\s-]/g, '');
    if (/^\d{1,4}$/.test(compact)) return `SMS${compact.padStart(4, '0')}`;
    if (/^SMS\d{1,4}$/.test(compact)) return `SMS${compact.slice(3).padStart(4, '0')}`;
    return compact;
  }

  function visibleCodes() {
    const query = normalizedQuery();
    return codes.filter(code => {
      const isUsed = usedCodes.has(code);
      const matchesFilter = filter === 'all' || (filter === 'used' ? isUsed : !isUsed);
      return matchesFilter && (!query || code.startsWith(query));
    });
  }

  function render() {
    const matches = visibleCodes();
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    page = Math.min(page, pages - 1);
    const start = page * pageSize;
    const slice = matches.slice(start, start + pageSize);
    const fragment = document.createDocumentFragment();

    for (const code of slice) {
      const isUsed = usedCodes.has(code);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = `code-tile ${isUsed ? 'is-used' : 'is-free'}`;
      tile.setAttribute('aria-label', `${code}, ${isUsed ? 'usado' : 'livre'}. Clique para copiar.`);
      tile.title = `${code} · ${isUsed ? 'Usado' : 'Livre'} · Clique para copiar`;
      tile.textContent = code;
      tile.addEventListener('click', () => copyCode(code));
      fragment.appendChild(tile);
    }

    els.grid.replaceChildren(fragment);
    els.empty.hidden = matches.length > 0;
    els.grid.hidden = matches.length === 0;
    els.results.textContent = matches.length
      ? `Exibindo ${number(start + 1)}–${number(Math.min(start + pageSize, matches.length))} de ${number(matches.length)} códigos`
      : 'Nenhum resultado';
    els.pageIndicator.textContent = `Página ${number(page + 1)} de ${number(pages)}`;
    els.prev.disabled = page === 0;
    els.next.disabled = page >= pages - 1;
  }

  function applyList() {
    const parsed = parseCodes(els.input.value);
    usedCodes = parsed.found;
    hasLoadedList = true;
    page = 0;
    updateSummary();
    render();

    const parts = [`${number(parsed.found.size)} código(s) usado(s) reconhecido(s).`];
    if (parsed.duplicates) parts.push(`${number(parsed.duplicates)} duplicado(s) removido(s).`);
    if (parsed.rejected) parts.push(`${number(parsed.rejected)} entrada(s) SMS inválida(s) ignorada(s). Use SMS + 1 a 4 dígitos.`);
    announce(parts.join(' '), parsed.rejected ? 'is-warning' : 'is-success');
  }

  async function loadFile(file) {
    if (!file) return;
    const accepted = /\.(txt|csv)$/i.test(file.name) || ['text/plain', 'text/csv'].includes(file.type);
    if (!accepted) {
      announce('Formato não reconhecido. Escolha um arquivo .TXT ou .CSV.', 'is-warning');
      els.file.value = '';
      return;
    }
    try {
      els.input.value = await file.text();
      els.fileName.textContent = file.name;
      applyList();
    } catch {
      announce('Não foi possível ler esse arquivo. Tente novamente ou cole o conteúdo.', 'is-warning');
    }
  }

  async function loadQueryList() {
    try {
      const response = await fetch('/consulta-sms.txt', { cache: 'no-store' });
      if (!response.ok) throw new Error('Lista inicial indisponível');
      const text = await response.text();
      const parsed = parseCodes(text);
      if (!parsed.found.size) throw new Error('A lista não contém códigos válidos');
      els.input.value = text;
      els.fileName.textContent = 'Lista da consulta';
      usedCodes = parsed.found;
      hasLoadedList = true;
      updateSummary();
      render();
      const details = [`${number(parsed.found.size)} código(s) existente(s) na consulta destacados em vermelho.`];
      if (parsed.duplicates) details.push(`${number(parsed.duplicates)} duplicado(s) ignorado(s).`);
      if (parsed.rejected) details.push(`${number(parsed.rejected)} entrada(s) SMS inválida(s) ignorada(s).`);
      announce(details.join(' '), parsed.rejected ? 'is-warning' : 'is-success');
    } catch {
      hasLoadedList = false;
      updateSummary();
      render();
      announce('A lista da consulta não pôde ser carregada. Cole ou importe uma lista para identificar os códigos usados.', 'is-warning');
    }
  }

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      showToast(`${code} copiado`);
    } catch {
      showToast(code);
    }
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 1500);
  }

  els.apply.addEventListener('click', applyList);
  els.clear.addEventListener('click', () => {
    els.input.value = '';
    els.file.value = '';
    els.fileName.textContent = 'Nenhum arquivo';
    usedCodes = new Set();
    hasLoadedList = false;
    page = 0;
    updateSummary();
    render();
    announce('Lista removida. Nenhum código está marcado como usado. Carregue uma lista atualizada para consultar a disponibilidade.');
  });
  els.file.addEventListener('change', event => loadFile(event.target.files?.[0]));
  els.search.addEventListener('input', () => { page = 0; render(); });
  els.filterButtons.forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    page = 0;
    els.filterButtons.forEach(item => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    render();
  }));
  els.size.addEventListener('change', () => {
    pageSize = Number(els.size.value);
    page = 0;
    render();
  });
  els.prev.addEventListener('click', () => { if (page > 0) { page -= 1; render(); } });
  els.next.addEventListener('click', () => { page += 1; render(); });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      els.search.focus();
    }
    if (event.key === 'Enter' && document.activeElement === els.search) {
      page = 0;
      render();
    }
  });

  const copyListButton = document.querySelector('#copy-used-list');
  copyListButton?.addEventListener('click', async () => {
    const usedList = document.querySelector('#used-code-list');
    if (!usedList?.value) {
      showToast('Não há códigos usados para copiar');
      return;
    }
    try {
      await navigator.clipboard.writeText(usedList.value);
      showToast('Lista de códigos usados copiada');
    } catch {
      usedList.focus();
      usedList.select();
      showToast('Lista selecionada — use Ctrl+C para copiar');
    }
  });

  loadQueryList();
  updateSummary();
  render();
})();
