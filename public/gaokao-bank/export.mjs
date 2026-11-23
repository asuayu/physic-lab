import { exportBody, exportHeading, renderMath } from './export-content.mjs';

const sheetTitle = '高考物理选题';
let activePreview;

export async function exportWord(questions, { macros = {} } = {}) {
  if (!questions.length) return;
  const { createWordDocument } = await import('./export-word.mjs');
  const blob = await createWordDocument(questions, { macros, title: sheetTitle });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sheetTitle}.docx`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportPdf(questions, { macros = {} } = {}) {
  if (!questions.length) return;
  activePreview?.();

  const opener = document.activeElement;
  const previousTitle = document.title;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./export-print.css', import.meta.url);
  const stylesheetReady = new Promise((resolve, reject) => {
    stylesheet.onload = resolve;
    stylesheet.onerror = () => reject(new Error('无法读取打印版式，请重试。'));
  });
  document.head.append(stylesheet);
  await stylesheetReady.catch((error) => {
    stylesheet.remove();
    throw error;
  });

  const preview = document.createElement('div');
  preview.className = 'gaokao-print-preview';
  preview.setAttribute('role', 'dialog');
  preview.setAttribute('aria-modal', 'true');
  preview.setAttribute('aria-labelledby', 'gaokao-print-title');
  preview.innerHTML = `
    <div class="gaokao-print-toolbar">
      <p>在打印窗口选择「另存为 PDF」</p>
      <button class="gaokao-print-button" type="button" disabled>打印 / 另存为 PDF</button>
      <button class="gaokao-print-close" type="button">关闭预览</button>
    </div>
    <main class="gaokao-print-sheet">
      <h1 id="gaokao-print-title"></h1>
    </main>`;
  preview.querySelector('h1').textContent = sheetTitle;
  const sheet = preview.querySelector('main');
  questions.forEach((question, index) => {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = exportHeading(question, index);
    const body = renderMath(exportBody(question), macros);
    body.className = 'gaokao-print-question';
    section.append(heading, body);
    sheet.append(section);
  });

  const background = [...document.body.children].filter((element) => !element.inert);
  background.forEach((element) => { element.inert = true; });
  document.body.append(preview);
  preview.scrollTop = 0;
  document.title = sheetTitle;
  const printButton = preview.querySelector('.gaokao-print-button');
  const closeButton = preview.querySelector('.gaokao-print-close');
  const close = () => {
    preview.remove();
    stylesheet.remove();
    background.forEach((element) => { element.inert = false; });
    document.title = previousTitle;
    activePreview = undefined;
    opener?.focus();
  };
  activePreview = close;
  closeButton.addEventListener('click', close);
  printButton.addEventListener('click', () => window.print());
  preview.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  closeButton.focus();

  try {
    await Promise.all([...sheet.querySelectorAll('img')].map(async (image) => {
      try {
        await image.decode();
      } catch {
        throw new Error(`无法读取题图：${image.alt || '试题配图'}。`);
      }
    }));
    await document.fonts?.ready;
    if (activePreview === close) {
      printButton.disabled = false;
      window.print();
    }
  } catch (error) {
    if (activePreview === close) close();
    throw error;
  }
}
