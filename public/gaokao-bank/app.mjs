import { renderMath } from './export-content.mjs';

const PAGE_SIZE = 10;
const BASKET_KEY = 'physics-lab:gaokao-basket:v1';
const formatCount = new Intl.NumberFormat('zh-CN');
const get = (id) => document.getElementById(id);
const yearCache = new Map();
const yearButtons = new Map();
const mobileLayout = window.matchMedia('(max-width: 1070px)');

let index;
let activeYear;
let yearData;
let cards = new Map();
let page = 1;
let loadVersion = 0;
let exporting = false;
let basketItems = readBasket();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(text, className) {
  const node = element('button', className, text);
  node.type = 'button';
  return node;
}

function readBasket() {
  try {
    const saved = JSON.parse(localStorage.getItem(BASKET_KEY));
    if (!Array.isArray(saved)) return [];
    const seen = new Set();
    return saved.filter((item) => {
      const { id, year, title } = item ?? {};
      if (typeof id !== 'string' || !Number.isInteger(year) || typeof title !== 'string' || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } catch {
    return [];
  }
}

function saveBasket() {
  try {
    localStorage.setItem(BASKET_KEY, JSON.stringify(basketItems));
  } catch {
    // Selection remains available in memory when browser storage is unavailable.
  }
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}`);
  return response.json();
}

function loadYear(year) {
  const entry = index.years.find((item) => item.year === year);
  if (!entry) return Promise.reject(new Error(`Unknown year ${year}`));
  if (!yearCache.has(year)) {
    yearCache.set(year, loadJson(entry.path).catch((error) => {
      yearCache.delete(year);
      throw error;
    }));
  }
  return yearCache.get(year);
}

function showQuestionState(message, actionText, action) {
  const status = get('question-state');
  status.hidden = !message;
  status.replaceChildren();
  if (!message) return;
  status.append(element('p', '', message));
  if (action) {
    const control = button(actionText);
    control.addEventListener('click', action);
    status.append(control);
  }
}

function setBasketStatus(message, error = false) {
  const status = get('basket-status');
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

function renderYears() {
  yearButtons.clear();
  for (const entry of index.years) {
    const control = button('', 'year-button');
    control.dataset.year = entry.year;
    control.setAttribute('aria-label', `${entry.year} 年，${entry.questionCount} 题`);
    control.append(element('span', '', `${entry.year} 年`), element('span', 'year-count', entry.questionCount));
    control.addEventListener('click', () => {
      if (entry.year !== activeYear) selectYear(entry.year, true);
    });
    yearButtons.set(entry.year, control);
  }
  get('year-list').replaceChildren(...yearButtons.values());
}

function populateSelect(select, all, options, selected = '') {
  select.replaceChildren(new Option(all, ''), ...options.map(([value, label]) => new Option(label, value)));
  select.value = options.some(([value]) => value === selected) ? selected : '';
  select.disabled = options.length < 2;
}

function filterTypes() {
  const paper = get('paper-filter').value;
  const typeFilter = get('type-filter');
  const types = new Set();
  for (const question of yearData.questions) {
    if (question.type && (!paper || paper === question.paper)) types.add(question.type);
  }
  const options = [...types].map((type) => [type, type]);
  populateSelect(typeFilter, '全部题型', options, typeFilter.value);
}

function resetFilters() {
  get('paper-filter').value = '';
  get('type-filter').value = '';
  filterTypes();
  page = 1;
  renderQuestions();
  get('paper-filter').focus();
}

function makeCard(question, selectedIds) {
  const card = element('article', 'question-card');
  card.dataset.questionId = question.id;
  const header = element('header', 'question-heading');
  const label = element('div');
  const title = question.title || `${question.year} 年${question.region}第 ${question.number} 题`;
  label.append(element('h3', '', title));
  const meta = [question.type, question.chapter].filter(Boolean).join(' · ');
  if (meta) label.append(element('p', 'question-meta', meta));

  const add = button('', 'add-question');
  updateAddButton(add, selectedIds.has(question.id));
  add.addEventListener('click', () => toggleQuestion(question, title));
  cards.set(question.id, add);
  header.append(label, add);

  const body = element('div', 'question-content');
  // This HTML is sanitized by the archive importer and served as a static asset.
  body.innerHTML = question.body;
  for (const img of body.querySelectorAll('img')) {
    img.loading = 'lazy';
    img.decoding = 'async';
  }
  renderMath(body, index.macros);
  card.append(header, body);
  return card;
}

function updateAddButton(control, selected) {
  control.textContent = selected ? '已加入' : '加入题目栏';
  control.setAttribute('aria-pressed', String(selected));
  control.title = selected ? '从题目栏移除' : '加入题目栏';
}

function renderQuestions() {
  const paper = get('paper-filter').value;
  const type = get('type-filter').value;
  const matches = yearData.questions.filter((question) => (!paper || question.paper === paper) && (!type || question.type === type));
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  page = Math.min(page, pageCount);
  const first = (page - 1) * PAGE_SIZE;
  const pageQuestions = matches.slice(first, first + PAGE_SIZE);
  const count = formatCount.format(matches.length);
  get('result-count').textContent = pageCount > 1 ? `${count} 题 · 第 ${first + 1}–${first + pageQuestions.length} 题` : `${count} 题`;
  showQuestionState(matches.length ? '' : '当前筛选条件下没有试题。', '清除筛选', resetFilters);

  cards = new Map();
  const selectedIds = new Set(basketItems.map((item) => item.id));
  get('question-list').replaceChildren(...pageQuestions.map((question) => makeCard(question, selectedIds)));
  get('pagination').hidden = pageCount <= 1;
  get('previous-page').disabled = page <= 1;
  get('next-page').disabled = page >= pageCount;
  get('page-position').textContent = `第 ${page} / ${pageCount} 页`;
}

async function selectYear(year, updateLocation = false) {
  const version = ++loadVersion;
  activeYear = year;
  yearData = undefined;
  page = 1;
  for (const [value, control] of yearButtons) control.setAttribute('aria-pressed', String(value === year));

  if (updateLocation) {
    const url = new URL(window.location.href);
    url.searchParams.set('year', year);
    history.replaceState(null, '', url);
  }

  get('result-count').textContent = '';
  get('results-heading').textContent = `${year} 年真题`;
  get('filters').hidden = true;
  get('pagination').hidden = true;
  get('question-list').replaceChildren();
  cards = new Map();
  showQuestionState(`正在载入 ${year} 年试题…`);

  try {
    const data = await loadYear(year);
    if (version !== loadVersion) return;
    yearData = data;
    const papers = data.papers.map((paper) => [paper.id, `${paper.title} · ${paper.count} 题`]);
    populateSelect(get('paper-filter'), '全部试卷', papers);
    get('type-filter').value = '';
    filterTypes();
    get('filters').hidden = false;
    renderQuestions();
  } catch (error) {
    if (version !== loadVersion) return;
    console.error('Gaokao year load failed', error);
    showQuestionState(`${year} 年试题载入失败。`, '重试', () => selectYear(year));
  }
}

function basketAction(text, action, item, disabled = false) {
  const control = button(text);
  control.dataset.basketAction = action;
  control.setAttribute('aria-label', `${text} ${item.title}`);
  control.disabled = disabled;
  control.addEventListener('click', () => changeBasket(item.id, action));
  return control;
}

function renderBasket() {
  const count = basketItems.length;
  get('basket-count').textContent = count;
  get('basket-count').setAttribute('aria-label', `已选 ${count} 题`);
  get('open-basket').textContent = `题目栏 · ${count} 题`;
  get('basket-empty').hidden = count > 0;
  const list = get('basket-list');
  list.hidden = !count;
  list.replaceChildren(...basketItems.map((item, position) => {
    const row = element('li', 'basket-item');
    const actions = element('div', 'basket-item-actions');
    actions.append(
      basketAction('上移', 'up', item, position === 0),
      basketAction('下移', 'down', item, position === count - 1),
      basketAction('移除', 'remove', item),
    );
    row.append(element('p', 'basket-item-title', item.title), actions);
    return row;
  }));
  updateExportButtons();
  const selectedIds = new Set(basketItems.map((item) => item.id));
  for (const [id, control] of cards) updateAddButton(control, selectedIds.has(id));
}

function commitBasket(message) {
  saveBasket();
  renderBasket();
  if (!exporting) setBasketStatus(message);
}

function toggleQuestion(question, title) {
  if (basketItems.some((item) => item.id === question.id)) {
    basketItems = basketItems.filter((item) => item.id !== question.id);
    commitBasket(`已移除 ${title}。`);
    return;
  }
  basketItems.push({ id: question.id, year: question.year, title });
  commitBasket(`已加入 ${title}。`);
}

function changeBasket(id, action) {
  const position = basketItems.findIndex((item) => item.id === id);
  if (position === -1) return;
  const item = basketItems[position];
  let target = position;
  if (action === 'remove') {
    basketItems.splice(position, 1);
    target = Math.min(position, basketItems.length - 1);
    commitBasket(`已移除 ${item.title}。`);
  } else {
    target += action === 'up' ? -1 : 1;
    if (target < 0 || target >= basketItems.length) return;
    basketItems.splice(position, 1);
    basketItems.splice(target, 0, item);
    commitBasket(`${item.title} 已移至第 ${target + 1} 题。`);
  }
  const row = get('basket-list').children[target];
  const control = row?.querySelector(`[data-basket-action="${action}"]:not(:disabled)`) ?? row?.querySelector('button:not(:disabled)');
  (control ?? get('basket-heading')).focus();
}

function updateExportButtons() {
  const disabled = !basketItems.length || !index || exporting;
  get('export-word').disabled = disabled;
  get('export-pdf').disabled = disabled;
}

function openBasket() {
  const dialog = get('basket-dialog');
  if (dialog.open) return;
  dialog.append(get('basket'));
  get('close-basket').hidden = false;
  dialog.showModal();
}

function restoreBasket() {
  if (get('basket-dialog').open) return;
  get('close-basket').hidden = true;
  get('basket-location').append(get('basket'));
}

async function exportBasket(format) {
  const selection = basketItems.slice();
  if (!selection.length || exporting) return;
  exporting = true;
  updateExportButtons();
  setBasketStatus('正在准备导出…');
  let reopenBasket = false;
  try {
    const years = [...new Set(selection.map((item) => item.year))];
    const [exports, ...data] = await Promise.all([import('./export.mjs'), ...years.map(loadYear)]);
    const questions = new Map(data.flatMap(({ questions }) => questions.map((question) => [question.id, question])));
    const ordered = selection.map((item) => questions.get(item.id));
    if (ordered.some((question) => !question)) {
      setBasketStatus('部分已选题目在题库中找不到。请移除这些题目后重新选择。', true);
      return;
    }
    const options = { macros: index.macros };
    if (format === 'word') {
      await exports.exportWord(ordered, options);
      setBasketStatus(`已导出 ${ordered.length} 题。`);
    } else {
      const dialog = get('basket-dialog');
      if (dialog.open) {
        reopenBasket = true;
        dialog.close();
        restoreBasket();
      }
      await exports.exportPdf(ordered, options);
      setBasketStatus('已打开打印预览，可在打印设置中选择另存为 PDF。');
    }
  } catch (error) {
    console.error('Gaokao question export failed', error);
    if (reopenBasket && mobileLayout.matches) openBasket();
    setBasketStatus('导出失败。请确认网络连接后重试。', true);
  } finally {
    exporting = false;
    updateExportButtons();
  }
}

function changePage(step) {
  page += step;
  renderQuestions();
  get('results-heading').focus();
  get('results-heading').scrollIntoView({ block: 'start' });
}

async function init() {
  showQuestionState('正在载入题库…');
  try {
    index = await loadJson('./data/index.json');
    index.years.sort((first, next) => next.year - first.year);
    if (!index.years.length) throw new Error('Empty question bank');
    const { yearMin, yearMax, papers, questions } = index.stats;
    const summary = get('archive-summary');
    summary.textContent = `${yearMin}–${yearMax} 年 · ${formatCount.format(papers)} 份试卷 · ${formatCount.format(questions)} 道题`;
    summary.hidden = false;
    renderYears();
    updateExportButtons();
    const requested = Number(new URLSearchParams(window.location.search).get('year'));
    const year = index.years.some((entry) => entry.year === requested) ? requested : index.years[0].year;
    await selectYear(year);
    yearButtons.get(year)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } catch (error) {
    console.error('Gaokao index load failed', error);
    showQuestionState('题库目录载入失败。', '重试', init);
  }
}

get('paper-filter').addEventListener('change', () => {
  page = 1;
  filterTypes();
  renderQuestions();
});
get('type-filter').addEventListener('change', () => {
  page = 1;
  renderQuestions();
});
get('previous-page').addEventListener('click', () => changePage(-1));
get('next-page').addEventListener('click', () => changePage(1));
get('open-basket').addEventListener('click', openBasket);
get('close-basket').addEventListener('click', () => get('basket-dialog').close());
get('basket-dialog').addEventListener('close', restoreBasket);
mobileLayout.addEventListener('change', (event) => {
  if (!event.matches && get('basket-dialog').open) get('basket-dialog').close();
});
get('export-word').addEventListener('click', () => exportBasket('word'));
get('export-pdf').addEventListener('click', () => exportBasket('pdf'));

renderBasket();
init();
