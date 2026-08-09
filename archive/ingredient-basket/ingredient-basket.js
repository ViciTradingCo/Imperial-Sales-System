/**
 * SHELVED — the ingredient basket, exactly as it shipped.
 *
 * Lifted out of `src/views/intake-form.js` unmodified. Its imports are written
 * for that file and do not resolve from here; see this directory's README for
 * what it needs and how to put it back.
 */
/**
 * BUYING INGREDIENTS — a shopping list that totals as you build it.
 *
 * The job this replaces: standing at a supplier working out what a basket comes
 * to, then going home and recording each line as a separate intake. It is the
 * register's arithmetic pointed the other way — add lines, watch the total, and
 * when you actually buy it, record the lot in one go.
 *
 * It defaults every price to what this shop has ACTUALLY PAID before, which is
 * the whole reason the cost is worth showing on the item line: you arrive
 * knowing what it should come to.
 */
function openIngredientBuyModal(onDone) {
  const idem = newIdem();
  let stock = [];
  const rows = [];              // [{ el, name, qty, price }]
  const rowsHost = el('div', {});
  const totalLine = el('p', { class: 'buy-total' }, '');
  const status = el('p', {});
  const save = el('button.primary', { onclick: doBuy }, 'Buy & add to stock');
  function setStatus(m, c) { status.className = c || ''; status.textContent = m; }

  const lineTotal = (r) => (Number(r.qty.value) || 0) * (Number(r.price.value) || 0);

  function retotal() {
    const n = rows.reduce((sum, r) => sum + lineTotal(r), 0);
    totalLine.textContent = 'Basket: ' + money(n);
    rows.forEach((r) => {
      r.sub.textContent = lineTotal(r) ? money(lineTotal(r)) : '';
    });
  }

  function addRow() {
    const picker = createItemPicker({
      allowFree: true,
      placeholder: 'Ingredient…',
      freeHint: 'Not in the index — it will be added for an admin to check.',
      // What you last paid, so the price fills itself in.
      meta: (it) => {
        const held = stock.find((s) => s.item.toLowerCase() === it.name.toLowerCase());
        return held && held.avgCost ? 'usually ' + money(held.avgCost) : '';
      },
      onPick: (it) => {
        const held = stock.find((s) => s.item.toLowerCase() === it.name.toLowerCase());
        if (held && held.avgCost && !row.price.value) row.price.value = String(held.avgCost);
        retotal();
      },
    });
    const qty = el('input', { type: 'number', step: '1', min: '1', value: '1' });
    const price = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Each' });
    const sub = el('span', { class: 'buy-sub' }, '');
    qty.addEventListener('input', retotal);
    price.addEventListener('input', retotal);
    const remove = el('button.secondary-btn.small', { onclick: () => {
      const i = rows.indexOf(row);
      if (i >= 0) { rows.splice(i, 1); wrap.remove(); retotal(); }
    } }, '×');
    const wrap = el('div', { class: 'craft-row' }, [picker.el, qty, price, sub, remove]);
    const row = { el: wrap, picker, qty, price, sub };
    rows.push(row);
    rowsHost.appendChild(wrap);
    retotal();
  }

  api.getInventory().then((r) => {
    stock = r.inventory || [];
    // Seed the picker of every row already on screen.
    const items = stock.map((s) => ({ name: s.item, avgCost: s.avgCost }));
    rows.forEach((r) => r.picker.setItems(items));
  }).catch(() => {});
  api.getItems().then((r) => {
    const idx = r.items || [];
    rows.forEach((row) => row.picker.setItems(idx));
    addRowSeeded = (row) => row.picker.setItems(idx);
  }).catch(() => {});
  let addRowSeeded = null;

  async function doBuy() {
    const lines = rows
      .map((r) => ({
        item: r.picker.selected() ? r.picker.selected().name : r.picker.value(),
        qty: Math.floor(Number(r.qty.value) || 0),
        price: Number(r.price.value),
      }))
      .filter((l) => l.item && l.qty > 0);
    if (!lines.length) { setStatus('Add at least one ingredient.', 'error'); return; }
    const bad = lines.find((l) => !isFinite(l.price) || l.price < 0);
    if (bad) { setStatus('What did "' + bad.item + '" cost each?', 'error'); return; }

    save.disabled = true;
    setStatus('Recording…', '');
    try {
      // One intake per line, sharing a key prefix so a retry cannot double any
      // of them. They are separate deliveries in the log because they are
      // separate items — the basket is a convenience, not a record.
      for (let i = 0; i < lines.length; i++) {
        await api.recordIntake({
          item: lines[i].item,
          numItems: lines[i].qty,
          pricePer: lines[i].price,
          ingredient: true,
          idempotencyKey: idem + '-' + i,
        });
      }
      onDone();
      modal.close();
      toast(lines.length + ' ingredient(s) added to stock.', 'ok');
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  addRow();
  const modal = openModal([
    el('h3', {}, 'Buy ingredients'),
    el('p', { class: 'note' }, 'Build the basket and watch it total. Prices start at what you have paid ' +
      'before. When you record it, each line becomes a delivery and the stock goes in — marked as ' +
      'ingredients, so they stay out of the register.'),
    rowsHost,
    el('button.secondary-btn.small', { onclick: () => { addRow(); if (addRowSeeded) addRowSeeded(rows[rows.length - 1]); } }, '+ Add another'),
    totalLine,
    save,
    status,
  ]);
  return modal;
}
