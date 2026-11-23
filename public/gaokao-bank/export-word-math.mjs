import { mathMarkup } from './export-content.mjs';

export const xml = (value) => String(value)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);

const mathElement = (tag, children) => `<m:${tag}>${children}</m:${tag}>`;
const mathProperty = (tag, value) => `<m:${tag} m:val="${xml(value)}"/>`;
const mathBase = (contents) => mathElement('e', contents);

const accentCharacters = {
  '→': '⃗', '⃗': '⃗', '¯': '̅', '‾': '̅', '^': '̂', 'ˆ': '̂',
  '˜': '̃', '~': '̃', '˙': '̇', '¨': '̈', 'ˇ': '̌', '˘': '̆',
};

const scriptStyles = {
  'double-struck': 'double-struck',
  fraktur: 'fraktur',
  'sans-serif': 'sans-serif',
  script: 'script',
  monospace: 'monospace',
};

function prescript(node) {
  const base = node.firstElementChild;
  return node.localName === 'msubsup' && base?.localName === 'mpadded'
    && base.getAttribute('width') === '0px' && base.firstElementChild?.localName === 'mphantom';
}

function mathRun(text, variant, defaultStyle = 'p', normal = false) {
  if (!text) return '';
  const bold = /\bbold\b/.test(variant);
  const italic = /\bitalic\b/.test(variant);
  const style = bold ? (italic ? 'bi' : 'b') : (italic ? 'i' : defaultStyle);
  const script = scriptStyles[variant.replace(/^(?:bold-)?(?:italic-)?/, '')];
  const properties = (normal ? '<m:nor/>' : '')
    + (script ? mathProperty('scr', script) : '')
    + mathProperty('sty', style);
  return mathElement('r', mathElement('rPr', properties)
    + '<m:t xml:space="preserve">' + xml(text) + '</m:t>');
}

function convertMath(node, inheritedVariant = '') {
  const tag = node.localName;
  const children = [...node.children];
  const variant = node.getAttribute('mathvariant') ?? inheritedVariant;
  const convert = (part) => part ? convertMath(part, variant) : '';
  const contents = () => children.map(convert).join('');
  const base = () => mathBase(convert(children[0]));

  switch (tag) {
    case 'math': case 'mstyle': case 'mpadded':
      return contents();
    case 'mrow': {
      const matrix = children.find((child) => child.localName === 'mtable');
      if (matrix && children.length < 4 && children.every((child) => child === matrix || child.getAttribute('fence') === 'true')) {
        const begin = children[0] === matrix ? '' : children[0].textContent;
        const end = children.at(-1) === matrix ? '' : children.at(-1).textContent;
        const properties = mathProperty('begChr', begin) + mathProperty('endChr', end);
        return mathElement('d', mathElement('dPr', properties) + mathBase(convert(matrix)));
      }
      const runs = [];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (!prescript(child)) {
          runs.push(convert(child));
          continue;
        }
        const sub = convert(child.children[1]);
        const sup = convert(child.children[2]);
        if (sub || sup) {
          runs.push(mathElement('sPre', mathElement('sub', sub) + mathElement('sup', sup)
            + mathBase(convert(children[++index]))));
        }
      }
      return runs.join('');
    }
    case 'semantics':
      return convert(children[0]);
    case 'annotation': case 'annotation-xml': case 'mphantom':
      return '';
    case 'mi':
      return mathRun(node.textContent, variant, !variant && [...node.textContent].length === 1 ? 'i' : 'p');
    case 'mo': case 'mn': case 'mtext': case 'ms':
      return mathRun(node.textContent, variant, 'p', tag === 'mtext');
    case 'mspace':
      return Number.parseFloat(node.getAttribute('width')) > 0 ? mathRun(' ', variant) : '';
    case 'mfrac': {
      const noRule = node.getAttribute('linethickness')?.startsWith('0');
      const properties = noRule ? mathElement('fPr', mathProperty('type', 'noBar')) : '';
      return mathElement('f', properties
        + mathElement('num', convert(children[0]))
        + mathElement('den', convert(children[1])));
    }
    case 'msub':
      return mathElement('sSub', base() + mathElement('sub', convert(children[1])));
    case 'msup':
      return mathElement('sSup', base() + mathElement('sup', convert(children[1])));
    case 'msubsup':
      return mathElement('sSubSup', base()
        + mathElement('sub', convert(children[1]))
        + mathElement('sup', convert(children[2])));
    case 'msqrt': case 'mroot': {
      const hidden = tag === 'msqrt';
      return mathElement('rad', (hidden ? mathElement('radPr', mathProperty('degHide', '1')) : '')
        + mathElement('deg', hidden ? '' : convert(children[1]))
        + (hidden ? mathBase(contents()) : base()));
    }
    case 'mover': case 'munder': case 'munderover': {
      const annotation = children[1]?.textContent.trim();
      if ((annotation === '‾' || annotation === '¯') && children[1]?.getAttribute('stretchy') === 'true') {
        const position = tag === 'mover' ? 'top' : 'bot';
        return mathElement('bar', mathElement('barPr', mathProperty('pos', position)) + base());
      }
      if (tag === 'mover' && accentCharacters[annotation]) {
        return mathElement('acc', mathElement('accPr', mathProperty('chr', accentCharacters[annotation])) + base());
      }
      const lower = tag === 'mover' ? '' : mathElement('limLow', base() + mathElement('lim', convert(children[1])));
      if (tag === 'munder') return lower;
      return mathElement('limUpp', (lower ? mathBase(lower) : base())
        + mathElement('lim', convert(children[tag === 'mover' ? 1 : 2])));
    }
    case 'mtable':
      return mathElement('m', children.map(convert).join(''));
    case 'mtr': case 'mlabeledtr':
      return mathElement('mr', children.map(convert).join(''));
    case 'mtd':
      return mathBase(contents());
    case 'menclose': {
      const notation = node.getAttribute('notation');
      if (notation === 'box' || notation === 'roundedbox') return mathElement('borderBox', mathBase(contents()));
      if (notation === 'horizontalstrike') {
        return mathElement('borderBox', mathElement('borderBoxPr', ['hideTop', 'hideBot', 'hideLeft', 'hideRight', 'strikeH']
          .map((property) => mathProperty(property, '1')).join('')) + mathBase(contents()));
      }
      return contents();
    }
    default:
      return children.length ? contents() : mathRun(node.textContent, variant);
  }
}

export function officeMath(element, macros) {
  try {
    const document = new DOMParser().parseFromString(mathMarkup(element, macros, 'mathml'), 'text/html');
    const math = document.querySelector('math');
    if (math) return mathElement('oMath', convertMath(math));
  } catch {
    // Retain TeX where the archive uses syntax that KaTeX cannot render.
  }
  return mathElement('oMath', mathRun(element.dataset.tex || element.textContent, '', 'p', true));
}
