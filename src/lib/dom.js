/** Tiny DOM helpers so views stay readable without a framework. */

/** HTML-escape untrusted text before interpolating into innerHTML. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** el('button.primary', { onclick }, 'Save') → configured element. */
export function el(spec, props, children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (props) {
    for (const k in props) {
      if (k === 'onclick') node.addEventListener('click', props[k]);
      else if (k === 'html') node.innerHTML = props[k];
      else if (k in node) node[k] = props[k];
      else node.setAttribute(k, props[k]);
    }
  }
  (Array.isArray(children) ? children : children != null ? [children] : []).forEach((c) => {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

/** Replaces a container's children with the given node(s). */
export function mount(container, ...nodes) {
  container.innerHTML = '';
  nodes.forEach((n) => container.appendChild(n));
}

/**
 * A data table from headers + rows of cells.
 *
 * A cell may be a NODE as well as a value, so a table can carry a control (a
 * checkbox, a dropdown) in a column instead of only text — which is what lets a
 * review screen be one table rather than a summary plus a list of widgets.
 */
export function tableEl(headers, rows) {
  const cell = (tag, c) => el(tag, {}, c && c.nodeType ? c : String(c == null ? '' : c));
  return el('table', { class: 'data-table' }, [
    el('thead', {}, el('tr', {}, headers.map((h) => cell('th', h)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => cell('td', c))))),
  ]);
}
