/**
 * TRANSFERS — moving stock from one company to another.
 *
 * A transfer is a CRATE, not an item: a shop sending goods usually sends
 * several things at once, and doing that as five separate transfers meant the
 * receiver pressing Accept five times and both shops reading five lines of
 * history for one handover. So the form is a list of lines, and the crate is
 * sent, accepted, declined or cancelled whole. `worker/src/transfers.js` is the
 * other half of that rule, and the half that enforces it.
 *
 * Lifted out of inventory.js, which had grown to 700 lines holding this, the
 * two stock tables and the stocktake — three jobs whose only connection is the
 * page they are reached from.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { openModal } from '../lib/modal.js';
import { createItemPicker } from '../lib/item-picker.js';
import { newIdem } from '../lib/id.js';

/**
 * One crate in a list, CLOSED — a title, who it is with, how much is in it, and
 * a Show more that opens the contents.
 *
 * The contents used to sit open on every row. Two items read fine that way; ten
 * turn each row into a paragraph beside its Accept button, and a list of crates
 * into a wall of item names with the decisions buried in it. What a person
 * scanning this list needs first is which crate and how big — the names are
 * what they look at once they have found the one they mean.
 *
 * The disclosure is the app's existing one (`guide-toggle`), and the caret is
 * its own node so the label stays a whole text node: the translator matches
 * whole nodes, and "▸ Show more" is not a phrase any dictionary has a row for.
 */
function crateRow({ title, who, lines, units, actions }) {
  const list = el('div', { class: 'crate-lines' },
    (lines || []).map((l) => el('p', { class: 'note' }, l.item + ' ×' + l.qty)));
  const caret = el('span', { class: 'guide-caret', 'aria-hidden': 'true' }, '');
  const label = el('span', {}, 'Show more');
  let shown = false;
  const toggle = el('button', {
    type: 'button', class: 'guide-toggle', onclick: () => { shown = !shown; paint(); },
  }, [caret, label]);
  function paint() {
    caret.textContent = shown ? '▾' : '▸';
    label.textContent = shown ? 'Show less' : 'Show more';
    toggle.setAttribute('aria-expanded', shown ? 'true' : 'false');
    list.hidden = !shown;
  }
  paint();

  const count = units ? units + ' item' + (units === 1 ? '' : 's') : '';
  return el('div', { class: 'emp-row crate-row' }, [
    el('span', { class: 'emp-who' }, [
      el('p', { class: 'crate-head', html:
        '<b>' + esc(title) + '</b> <span class="note">' + esc([count, who].filter(Boolean).join(' · ')) + '</span>' }),
      toggle,
      list,
    ]),
    ...(actions ? [actions] : []),
  ]);
}

/**
 * The crates waiting on somebody: yours to accept, and theirs to accept from
 * you. `act` runs one of the accept / decline / cancel calls and hands back the
 * fresh lists, so this never fetches on its own behalf.
 */
function pendingPanel(act) {
  const host = el('div', {}, el('p', { class: 'note' }, 'Loading transfers…'));
  const draw = (t) => {
    const inc = t.incoming || [];
    const out = t.outgoing || [];
    // "Pending Transfer" rather than what is in it: every row in these two
    // lists is one, and the decision on it is the same whatever the crate holds.
    const nodes = [el('h3', {}, 'Incoming')];
    if (!inc.length) nodes.push(el('p', { class: 'note' }, 'No transfers waiting for you.'));
    else inc.forEach((x) => nodes.push(crateRow({
      title: 'Pending Transfer', who: 'from ' + x.other, lines: x.lines, units: x.units,
      actions: el('span', { class: 'row-actions' }, [
        el('button.primary.small', { onclick: () => act(() => api.acceptTransfer(x.id)) }, 'Accept'),
        el('button.danger.small', { onclick: () => act(() => api.declineTransfer(x.id)) }, 'Decline'),
      ]),
    })));
    nodes.push(el('h3', {}, 'Outgoing (awaiting acceptance)'));
    if (!out.length) nodes.push(el('p', { class: 'note' }, 'None pending.'));
    else out.forEach((x) => nodes.push(crateRow({
      title: 'Pending Transfer', who: 'to ' + x.other, lines: x.lines, units: x.units,
      actions: el('button.danger.small', { onclick: () => act(() => api.cancelTransfer(x.id)) }, 'Cancel'),
    })));
    mount(host, ...nodes);
  };
  const load = () => api.getTransfers().then(draw)
    .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
  return { el: host, draw, load };
}

/** What has already been handed over, either way, with what became of it. */
function historyPanel() {
  const host = el('div', {}, el('p', { class: 'note' }, 'Loading history…'));
  const load = () => api.getTransferHistory().then((r) => {
    const h = r.history || [];
    if (!h.length) { mount(host, el('p', { class: 'note' }, 'No transfer history yet.')); return; }
    // Closed the same way, since the crowding is the same — but a finished
    // handover is a log line, so it keeps its summary as its name rather than
    // becoming a row of identical words.
    mount(host, ...h.map((x) => crateRow({
      title: (x.dir === 'out' ? '→ ' : '← ') + (x.summary || ''),
      who: (x.dir === 'out' ? 'to ' + x.to : 'from ' + x.from) + ' · ' + x.status,
      lines: x.lines, units: x.units,
    })));
  }).catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
  return { el: host, load };
}

/**
 * Transfer goods to another company — a CRATE, not an item.
 *
 * A shop sending goods to another usually sends several things at once, and
 * doing that as five separate transfers meant the receiver accepting five
 * times and either shop reading five lines of history for one handover. So the
 * form is a list of lines, exactly like a delivery on the register's Buying
 * side, and the whole crate is sent, accepted, declined or cancelled as one.
 *
 * Sending debits your stock immediately; the goods only appear in the
 * receiver's inventory once they accept, from the incoming list here.
 */
/**
 * The crate: a list of lines, each an item off your own shelf and how much.
 *
 * `onChange` is handed the folded figures whenever anything is typed, so the
 * screen around this can word its total and refuse an impossible send without
 * this needing to know about either of them.
 */
function crateForm(onChange) {
  const host = el('div', {});
  const lines = [];
  /** What this shop can send: its own listings, with something on the shelf. */
  let stock = [];

  /**
   * What the lines ask for, FOLDED BY ITEM the way the Worker folds it — two
   * lines of the same thing spend the same shelf, which is the mistake a list
   * of lines makes possible and a single form never could.
   */
  function asked() {
    const by = new Map();
    lines.forEach((l) => {
      const picked = l.picker.selected();
      const n = Math.floor(Number(l.qty.value));
      if (!picked || !isFinite(n) || n < 1) return;
      const prev = by.get(picked.name);
      by.set(picked.name, { item: picked.name, qty: (prev ? prev.qty : 0) + n, stock: picked.stock });
    });
    return [...by.values()];
  }

  function sync() {
    // Remove only exists to undo a line, so it is not offered on the only one.
    lines.forEach((l) => { l.remove.hidden = lines.length < 2; });
    onChange(asked());
  }

  /**
   * The picker is bound to THIS shop's in-stock inventory rather than the master
   * index — you can only send what you actually hold, and those names are
   * already the ones the Worker will match on.
   */
  function add() {
    const picker = createItemPicker({
      placeholder: 'Search your stock…',
      items: stock,
      meta: (it) => it.stock + ' in stock',
    });
    const qty = el('input', { type: 'number', min: '1', step: '1', value: '1', 'aria-label': 'Amount' });
    const remove = el('button.secondary-btn.small', {
      type: 'button', title: 'Remove this line', 'aria-label': 'Remove this line',
      onclick: () => {
        const i = lines.indexOf(line);
        if (i < 0) return;
        lines.splice(i, 1);
        row.remove();
        sync();
      },
    }, '×');
    const row = el('div', { class: 'craft-row' }, [picker.el, qty, remove]);
    row.addEventListener('input', sync);
    const line = { row, picker, qty, remove };
    lines.push(line);
    host.appendChild(row);
    sync();
  }

  return {
    el: host,
    add,
    asked,
    setStock: (list) => { stock = list; lines.forEach((l) => l.picker.setItems(stock)); },
    /** Back to one empty line, so the next crate is not a copy of the last. */
    reset: () => { lines.splice(0, lines.length).forEach((l) => l.row.remove()); add(); },
  };
}

export function openTransferModal(me, onChanged) {
  const toSel = el('select', {}, el('option', { value: '' }, 'Receiving company…'));
  const status = el('p', {});
  const send = el('button.primary', { onclick: doSend }, 'Confirm transfer');
  const pending = pendingPanel((fn) => act(fn));
  const history = historyPanel();
  const totalLine = el('p', { class: 'note' }, '');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  /**
   * The running total, and the one thing worth catching before the send: more
   * of something than the shop actually holds.
   */
  const crate = crateForm((want) => {
    const over = want.filter((w) => w.qty > w.stock);
    const units = want.reduce((n, w) => n + w.qty, 0);
    totalLine.className = over.length ? 'note warn' : 'note';
    totalLine.textContent = over.length
      ? 'More ' + over[0].item + ' than you hold — ' + over[0].qty + ' of ' + over[0].stock + '.'
      : (units ? units + ' item' + (units === 1 ? '' : 's') + ' in ' + want.length + ' line' + (want.length === 1 ? '' : 's') + '.' : '');
    send.disabled = !!over.length;
  });

  api.getInventory().then((inv) => {
    crate.setStock((inv.inventory || []).filter((it) => it.stock > 0).map((it) => ({ name: it.item, stock: it.stock })));
  }).catch(() => {});
  api.getBusinesses().then((res) => {
    (res.businesses || []).filter((b) => b.toLowerCase() !== String(me.business || '').toLowerCase())
      .forEach((b) => toSel.appendChild(el('option', { value: b }, b)));
  }).catch(() => {});

  let sendKey = null; // stable across a retry of the same send; cleared on success
  async function doSend() {
    const items = crate.asked();
    if (!items.length) { setStatus('Add at least one item from your stock.', 'error'); return; }
    if (!toSel.value) { setStatus('Pick a receiving company.', 'error'); return; }
    if (!sendKey) sendKey = newIdem();
    send.disabled = true;
    setStatus('Sending…', '');
    try {
      pending.draw(await api.createTransfer({
        toBusiness: toSel.value,
        items: items.map((i) => ({ item: i.item, qty: i.qty })),
        idempotencyKey: sendKey,
      }));
      sendKey = null; // next crate gets a fresh key
      setStatus('Transfer sent — awaiting acceptance.', 'ok');
      crate.reset();
      history.load();
      onChanged(); // stock left our inventory
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    } finally {
      send.disabled = false;
    }
  }

  // Accept / decline / cancel all move stock and refresh the same way.
  async function act(fn) {
    try {
      pending.draw(await fn());
      history.load();
      onChanged(); // inventory changed (goods arrived, or returned to sender)
      window.dispatchEvent(new Event('eec:banners')); // refresh the pending banner
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    }
  }

  crate.add();
  pending.load();
  history.load();
  openModal([
    el('h3', {}, 'Transfer goods'),
    el('p', { class: 'note' }, 'Send stock to another company — as many items as you like in one crate. ' +
      'It leaves your inventory now and appears in theirs once they accept, all of it together.'),
    el('label', {}, 'Items'),
    crate.el,
    el('button.secondary-btn', { onclick: crate.add }, 'Add another item'),
    totalLine,
    el('label', {}, 'Receiving company'), toSel,
    send,
    status,
    el('hr', {}),
    pending.el,
    el('hr', {}),
    el('h3', {}, 'Recent transfers'),
    history.el,
  ]);
}
