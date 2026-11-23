const displayMath = (element) => element.dataset.display === '1';

export function mathMarkup(element, macros, output = 'htmlAndMathml') {
  return window.katex.renderToString(element.dataset.tex ?? element.textContent, {
    displayMode: displayMath(element),
    macros: { ...macros },
    maxExpand: 1000,
    output,
    strict: 'ignore',
    throwOnError: true,
    trust: false,
  });
}

export function renderMath(root, macros = {}) {
  for (const element of root.querySelectorAll('.math-tex[data-tex]')) {
    try {
      element.innerHTML = mathMarkup(element, macros);
    } catch {
      element.textContent = element.dataset.tex;
      element.classList.add('gaokao-math-source');
    }
  }
  return root;
}

export function exportHeading(question, index) {
  const source = question.title || `${question.year}年${question.region}第 ${question.number} 题`;
  return `${index + 1}. ${source}`;
}

export function exportBody(question) {
  const body = document.createElement('div');
  body.innerHTML = question.body;
  for (const answer of body.querySelectorAll('.inline-answer')) {
    answer.textContent = '________';
    answer.className = 'answer-blank';
  }
  for (const image of body.querySelectorAll('img')) image.loading = 'eager';
  return body;
}
