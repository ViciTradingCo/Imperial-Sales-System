/**
 * FILLING A SPECIAL THAT ASKS FOR KINDS — "five food and five drink".
 *
 * Its own module rather than another hundred lines of the register: this is one
 * self-contained question asked in a modal, it closes over nothing on the page
 * that opened it, and the register is long enough without it.
 */
import { el, esc } from '../lib/dom.js';
import { openModal } from '../lib/modal.js';
import { money, tagLabel } from '../lib/format.js';
import { dealSpecial } from '../lib/specials.js';

/**
 * The till chooses WHAT and the Worker states the PRICE — each choice is handed
 * back with the kind it fills, because an item tagged both food and drink
 * cannot pay for both halves of one deal. The Worker re-checks all of it: the
 * tags, the counts, the price. Nothing here is trusted, only made easy.
 *
 * `count` is how many of the special are being rung up. The panels ask for the
 * whole amount at once and `dealSpecial` splits the answer into one filling
 * each — three of a deal is one question and three cart lines, never three
 * questions.
 */
export function openFillSpecial(b, inventory, count, onFilled) {
  const many = Math.max(1, Math.floor(Number(count)) || 1);
  const status = el('p', {});
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m || ''; };
  const sellable = (inventory || []).filter((it) => !it.ingredient);
  const panels = [];

  const body = b.needs.map((need) => {
    // The WHOLE amount, for all of them at once. Asking three times for the
    // same deal is the app being pedantic at somebody standing at a counter;
    // `dealSpecial` splits the answer back into one filling each.
    const want = need.qty * many;
    const options = sellable.filter((it) => (it.tags || []).includes(need.tag));
    const tally = el('p', { class: 'note' });
    const boxes = [];
    const paint = () => {
      const got = boxes.reduce((n, x) => n + (Math.floor(Number(x.input.value)) || 0), 0);
      tally.textContent = got + ' of ' + want + ' chosen';
      tally.className = got === want ? 'note ok' : 'note';
    };
    const rows = options.map((it) => {
      const input = el('input', {
        type: 'number', min: '0', step: '1', value: '0',
        'aria-label': 'How many ' + it.item,
      });
      input.addEventListener('input', paint);
      boxes.push({ input, item: it });
      return el('div', { class: 'need-row' }, [
        el('span', { class: 'emp-who', html: '<b>' + esc(it.item) + '</b> <span class="note">' +
          esc(it.stock + ' in stock') + '</span>' }),
        input,
      ]);
    });
    paint();
    panels.push({ need, boxes, want });
    return el('div', { class: 'fill-need' }, [
      el('h4', {}, want + ' × ' + tagLabel(need.tag) +
        (many > 1 ? ' (' + many + ' × ' + need.qty + ')' : '')),
      options.length
        ? el('div', {}, rows)
        : el('p', { class: 'note error' }, 'Nothing in stock is tagged ' + tagLabel(need.tag) +
          ' — tag it under Inventory → Kinds.'),
      tally,
    ]);
  });

  let modal;
  function confirm() {
    const parts = [];
    for (const panel of panels) {
      let got = 0;
      for (const box of panel.boxes) {
        const n = Math.floor(Number(box.input.value)) || 0;
        if (n < 0) { setStatus('A count cannot be negative.', 'error'); return; }
        if (!n) continue;
        // Stock is checked properly server-side; this is so the clerk is told
        // before the customer is, rather than after the whole order is rung up.
        if (n > box.item.stock) {
          setStatus('Only ' + box.item.stock + ' ' + box.item.item + ' in stock.', 'error');
          return;
        }
        got += n;
        parts.push({ item: box.item.item, qty: n, tag: panel.need.tag });
      }
      if (got !== panel.want) {
        setStatus(b.name + ' takes ' + panel.want + ' ' + tagLabel(panel.need.tag) + ' — ' + got + ' chosen.', 'error');
        return;
      }
    }
    let fillings;
    try {
      fillings = dealSpecial(parts, b.needs, many);
    } catch (e) {
      // The panels above have already checked every total, so this is a bug
      // rather than a mis-click — but a cart line built from a filling that
      // does not fill the deal is worse than a refusal nobody expected.
      setStatus(e.message || String(e), 'error');
      return;
    }
    onFilled(fillings);
    modal.close();
  }

  modal = openModal([
    el('h3', {}, (many > 1 ? many + ' × ' : '') + b.name + ' — ' +
      (b.percentOff ? b.percentOff + '% off' : money(b.price) + (many > 1 ? ' each' : ''))),
    el('p', { class: 'note' }, many > 1
      ? 'Choose for all ' + many + ' at once — they ring up as ' + many + ' separate lines, ' +
        'because each one is its own deal and they need not divide evenly.'
      : 'Choose what goes in it. One special at a time: the next customer picks their own, ' +
        'so add it again for another.'),
    b.percentOff
      ? el('p', { class: 'note' }, 'What it costs follows what you choose, less ' + b.percentOff + '%.')
      : null,
    ...body,
    el('div', { class: 'row-actions' }, [el('button.primary', { onclick: confirm }, 'Add to order')]),
    status,
  ].filter(Boolean));
}
