/**
 * THE PROPERTY INDEX — a Court's register of the premises in its region.
 *
 * This is the screen where a Court is a MODERATOR rather than a landlord with
 * paperwork. Three things happen here, and they are the same thing seen from
 * three angles:
 *
 *   • letting premises — a property is added, and its code is what creates the
 *     shop that opens there;
 *   • naming what stands on them — a Court renames the company on its own land;
 *   • reading what they hold — the region's books for that shop, which is the
 *     view Court Tools already gives, reached from the place rather than a list
 *     of names.
 *
 * ONE TABLE, NOT A TILE PER PROPERTY. The same reasoning as the Master Item
 * Index: a Court comparing two premises should not have to open two menus, and
 * the answer to "who is where" is a list you read down. The per-property
 * actions open a focal menu, because each is a form.
 *
 * WHAT A MANAGER SEES. The Worker sends `canEdit` with the list, and every
 * button below is drawn from it rather than from the role — a manager reads the
 * index and the data behind it, and is never shown a control the server would
 * refuse. A Court's employees do not reach this page at all.
 */
import { el, mount, tableEl } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { money, regionWord } from '../lib/format.js';
import { openFocalMenu } from '../lib/tiles.js';
import { toast } from '../lib/toast.js';
import { emptyState } from '../lib/empty.js';
import { skeletonRows } from '../lib/skeleton.js';
import { guidePanel, guideUnseen, markGuideSeen } from '../lib/guide.js';
import { openCourtShop } from './court.js';

export function renderProperties(container) {
  const listHost = el('div', {}, skeletonRows(4));
  // Built once the server has said what this reader may do — help that explains
  // buttons a manager does not have is help that is wrong for them.
  const guideHost = el('div', {});
  const search = el('input', { type: 'search', placeholder: 'Search a property or the business on it…' });
  const addBtn = el('button.primary', { onclick: () => editorDialog(null, refresh) }, 'Add a property');
  const toolbar = el('div', { class: 'row-actions' }, [addBtn]);
  let all = [];
  let hold = '';
  let canEdit = false;
  search.addEventListener('input', draw);

  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Property Index'),
    el('p', { class: 'note' }, 'The premises in your ' + regionWord() + ', and who trades on each. A ' +
      'property’s code opens a NEW shop here — whoever redeems it names their own business, but it lands ' +
      'in your ' + regionWord() + ', on those premises.'),
    guideHost,
    toolbar,
    search,
    listHost,
  ]));

  load();

  function load() {
    return api.getProperties().then((d) => {
      all = d.properties || [];
      hold = d.hold || '';
      canEdit = !!d.canEdit;
      addBtn.hidden = !canEdit;
      mount(guideHost, guidePanel(guideLines(canEdit), guideUnseen('court-properties')));
      draw();
    }).catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = all.filter((p) => !q ||
      [p.name, p.business, p.notes].some((v) => String(v || '').toLowerCase().includes(q)));

    if (!rows.length) {
      mount(listHost, all.length
        ? el('p', { class: 'note' }, 'No matches.')
        : emptyState({
            glyph: '🏛️',
            title: 'No premises yet',
            hint: 'Add the places a shop can stand in ' + (hold || 'your ' + regionWord()) +
              '. Each one gets a code that opens a business there.',
            actionLabel: canEdit ? 'Add a property' : '',
            onAction: canEdit ? () => editorDialog(null, refresh) : null,
          }));
      return;
    }

    mount(listHost, tableEl(['Property', 'Business', 'Rent', 'Notes', ''], rows.map(row)));
  }

  function row(p) {
    return [
      p.name,
      // Vacant is the derived answer, not an empty column: a tenant that has
      // been archived leaves premises empty, and the Court needs to see that
      // the place can be let rather than a name that no longer trades.
      p.vacant ? el('span', { class: 'pill' }, 'Vacant') : el('b', {}, p.business),
      p.rent ? money(p.rent) : '—',
      el('span', { class: 'note' }, (p.notes || '').slice(0, 60) + ((p.notes || '').length > 60 ? '…' : '')),
      rowActions(p),
    ];
  }

  /**
   * What this reader may do to this row. Drawn from the server's `canEdit`
   * rather than from the role, so the screen can never offer a manager a button
   * the Worker will refuse.
   */
  function rowActions(p) {
    const buttons = [];
    if (!p.vacant) buttons.push(el('button.small', { onclick: () => openCourtShop(p.business) }, 'View data'));
    if (canEdit) {
      buttons.push(el('button.small', { onclick: () => editorDialog(p, refresh) }, 'Edit'));
      if (p.vacant) {
        buttons.push(el('button.small', { onclick: () => codeDialog(p, refresh) }, 'Code'));
        buttons.push(el('button.danger.small', { onclick: () => remove(p) }, 'Remove'));
      } else {
        buttons.push(el('button.small', { onclick: () => renameDialog(p, refresh) }, 'Rename business'));
      }
    }
    return el('div', { class: 'row-actions' }, buttons);
  }

  /** One place for "the server has told us the new list" — every form ends here. */
  function refresh(properties) {
    if (properties) all = properties;
    draw();
  }

  async function remove(p) {
    if (!window.confirm('Remove "' + p.name + '" from the Property Index?\n\n' +
      'The premises leave your books. Nothing else is affected — this does not touch any business.')) return;
    try {
      const res = await api.removeProperty(p.id);
      refresh(res.properties);
      toast('Removed ' + res.removed + '.', 'ok');
    } catch (e) {
      toast(e.message || String(e), 'danger');
    }
  }

}

/**
 * "How this works", written for the reader it is in front of.
 *
 * A manager cannot let premises, issue a code or rename anybody, so help that
 * explains those buttons is help about a page they are not on. What they get
 * instead is what the index IS and the one thing they can do with it.
 */
function guideLines(canEdit) {
  if (!canEdit) {
    return [
      'This is your Court’s register of the premises in its ' + regionWord() + ' — the place, not the ' +
        'shop, so a property keeps its name, its notes and its rent when a tenant leaves.',
      'Open a business from the property it stands on to read what it reports to its Court.',
      'Letting premises, issuing their codes and renaming a business are the Court owner’s.',
    ];
  }
  return [
    'Add a property for each place a shop can stand. It is the place, not the shop — it stays on your ' +
      'books when a tenant leaves, with its notes and its rent.',
    'Give someone the property’s code and they sign up straight onto it. A code only works while the ' +
      'premises are empty, so one code can never put two shops in one building.',
    'A business that opened on one of your properties can be renamed here. A shop set up with an ' +
      'admin’s code is on no property, and is beyond your ' + regionWord() + '’s reach by design.',
    'Rent is a figure you record, exactly like the levy — nothing moves coin on its own.',
  ];
}

/** The place's own record: what a Court keeps about the premises. */
function editorDialog(p, onSaved) {
  openFocalMenu(p ? 'Edit ' + p.name : 'Add a property', (host, modal) => {
    const name = el('input', { type: 'text', value: p ? p.name : '', placeholder: 'The Old Mill' });
    const rent = el('input', { type: 'number', min: '0', step: '1', value: p ? String(p.rent || 0) : '0' });
    const notes = el('textarea', { rows: '4', placeholder: 'Condition, history, terms — whatever your Court keeps on it.' });
    notes.value = p ? p.notes : '';
    const status = el('p', {});
    const save = el('button.primary', { onclick: doSave }, p ? 'Save' : 'Add property');

    async function doSave() {
      save.disabled = true;
      status.className = ''; status.textContent = 'Saving…';
      try {
        const res = await api.saveProperty({
          id: p ? p.id : '', name: name.value, notes: notes.value, rent: rent.value,
        });
        markGuideSeen('court-properties');
        onSaved(res.properties);
        toast(p ? 'Saved.' : 'Added ' + res.property.name + '.', 'ok');
        modal.close();
      } catch (e) {
        save.disabled = false;
        status.className = 'error'; status.textContent = e.message || String(e);
      }
    }

    mount(host,
      el('label', {}, 'Property name'),
      name,
      el('p', { class: 'note' }, 'What the place is called. It has to be unique in your ' + regionWord() + '.'),
      el('label', {}, 'Rent'),
      rent,
      el('p', { class: 'note' }, 'What you charge for it. This is a RECORD — like the levy, nothing here ' +
        'moves coin on its own, and 0 simply means you charge nothing.'),
      el('label', {}, 'Notes'),
      notes,
      el('div', { class: 'row-actions' }, [save]),
      status);
  });
}

/**
 * THE CODE THAT CREATES A SHOP.
 *
 * Shown rather than sent: it is a credential, and the Court hands it over in
 * whatever channel it uses. Reissuing kills the old one immediately, which is
 * the only fix for one that has gone somewhere it shouldn't.
 */
function codeDialog(p, onIssued) {
  openFocalMenu('Code for ' + p.name, (host) => {
    const codeHost = el('p', { class: 'buy-total' }, p.code || '—');
    const status = el('p', {});
    const issue = el('button.danger', { onclick: doIssue }, 'Issue a new code');

    async function doIssue() {
      if (!window.confirm('Issue a new code for "' + p.name + '"?\n\n' +
        'The current code stops working immediately. Anyone you already gave it to will need the new one.')) return;
      issue.disabled = true;
      status.className = ''; status.textContent = 'Issuing…';
      try {
        const res = await api.issuePropertyCode(p.id);
        p.code = res.code;
        codeHost.textContent = res.code;
        status.className = 'ok'; status.textContent = 'New code issued.';
        issue.disabled = false;
        onIssued(res.properties);
      } catch (e) {
        issue.disabled = false;
        status.className = 'error'; status.textContent = e.message || String(e);
      }
    }

    mount(host,
      el('p', { class: 'note' }, 'Give this to whoever is taking the premises. They sign up with it, name ' +
        'their own business, and it opens here — in your ' + regionWord() + ', on this property. They ' +
        'never see any other ' + regionWord() + ' or shop.'),
      codeHost,
      el('p', { class: 'note' }, 'It works only while the place is empty, so it cannot be used twice.'),
      el('div', { class: 'row-actions' }, [issue]),
      status);
  });
}

/** Renaming the shop standing on a Court's own land. */
function renameDialog(p, onRenamed) {
  openFocalMenu('Rename the business at ' + p.name, (host, modal) => {
    const name = el('input', { type: 'text', value: p.business, placeholder: p.business });
    const status = el('p', {});
    const save = el('button.primary', { onclick: doSave }, 'Rename');

    async function doSave() {
      const to = name.value.trim();
      if (!to || to === p.business) return;
      if (!window.confirm('Rename "' + p.business + '" to "' + to + '"?\n\n' +
        'The shop keeps everything — its people, stock, books and settings all follow the name. Its old ' +
        'name becomes free for someone else.')) return;
      save.disabled = true;
      status.className = ''; status.textContent = 'Renaming…';
      try {
        const res = await api.renameOccupant(p.id, to);
        onRenamed(res.properties);
        toast('Renamed to ' + res.renamed + '.', 'ok');
        modal.close();
      } catch (e) {
        save.disabled = false;
        status.className = 'error'; status.textContent = e.message || String(e);
      }
    }

    mount(host,
      el('p', { class: 'note' }, 'You may rename a business standing on your own property. Everything it ' +
        'owns follows the name — its roster, its stock, its books and its history.'),
      el('label', {}, 'Business name'),
      name,
      el('div', { class: 'row-actions' }, [save]),
      status);
  });
}

