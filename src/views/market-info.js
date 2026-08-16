/**
 * Market Info — Item Performance for one shop's own region, one week behind.
 *
 * The SAME page an admin reads realm-wide, narrowed twice: to the shop's own
 * region, and to the week that has finished. It reuses Market Analysis's own
 * blocks rather than imitating them, so the two cannot drift apart — a column
 * added there appears here, and a shop and an admin discussing an item are
 * reading the same figure presented the same way.
 *
 * What a shop actually needs from a market is what things are WORTH there.
 * Not who took the most gold last week — that is a Court's business, or an
 * admin's. So this is the items and nothing else.
 *
 * WHY LAST WEEK. A Court governs its region and reads it live; everyone else
 * gets the week that has settled. A live feed of the neighbours' takings invites
 * pricing against their till by the hour, which is not knowing a market. The
 * figures change once, when the week turns over, and hold still for seven days.
 */
import { regionWord, regionsOn } from '../lib/format.js';
import { el, mount } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { backToHome } from '../lib/sections.js';
import { emptyState } from '../lib/empty.js';
import { createItemPicker } from '../lib/item-picker.js';
import { openFocalMenu } from '../lib/tiles.js';
import { itemBlock } from './market.js';

/** How many items lead the page, matching Item Performance. */
const TOP_ITEMS = 5;

/** Scoped to one region, so no "best region" column and a week-long graph. */
const BLOCK = { oneRegion: true, emptyMsg: 'No sales that week.' };

/** "27 Jul – 2 Aug" for a half-open [from, to) week, in the reader's locale. */
function weekLabel(week) {
  if (!week || !week.from || !week.to) return '';
  const from = new Date(week.from);
  // `to` is the start of the NEXT week, so the last day covered is the day before.
  const to = new Date(new Date(week.to).getTime() - 86400000);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return '';
  const dayMonth = { day: 'numeric', month: 'short' };
  // Drop the repeated month when the week does not straddle one.
  const left = from.getMonth() === to.getMonth()
    ? from.toLocaleDateString(undefined, { day: 'numeric' })
    : from.toLocaleDateString(undefined, dayMonth);
  return left + ' – ' + to.toLocaleDateString(undefined, dayMonth);
}

export function renderMarketInfo(container, { me }) {
  const host = el('div', {}, el('p', { class: 'note' }, 'Reading last week’s trade…'));
  mount(container, el('div.card', {}, [
    backToHome(),
    el('h2', {}, 'Market Info'),
    el('p', { class: 'note' }, 'What things are worth in your ' + regionWord() + ', over the week just gone. ' +
      'It updates once a week, when the new week begins.'),
    host,
  ]));

  api.getWeeklyMarket()
    .then((d) => {
      // A travelling shop is not a shop waiting on an admin: it has no home
      // market on purpose, and saying "no region set" would read as a fault.
      if (d.traveling) {
        mount(host, emptyState({
          glyph: '🐎',
          title: 'Your shop travels',
          hint: 'A travelling shop has no home ' + regionWord() + ', so there is no one local market to ' +
            'report on. Your sales still count towards the ' + regionWord() + ' each one was rung up in.',
        }));
        return;
      }
      if (d.noRegion) {
        mount(host, emptyState({
          glyph: '🗺️',
          title: regionsOn() ? 'No ' + regionWord() + ' set' : 'Not used in this realm',
          hint: regionsOn()
            ? 'Your shop has no ' + regionWord() + ' assigned, so there is no local market to report on. An admin can set one.'
            : 'This realm does not divide trade by ' + regionWord() + ', so there is no local market to report on.',
        }));
        return;
      }

      const items = d.items || [];
      const label = weekLabel(d.week);

      if (!items.length) {
        mount(host, emptyState({
          glyph: '🪙',
          title: 'A quiet week',
          hint: 'Nothing was traded in your ' + regionWord() + (label ? ' between ' + label : ' last week') +
            '. Check back when the next week turns over.',
        }));
        return;
      }

      // The same picker Item Performance uses, but over the items that traded
      // HERE — offering a name with no local trade would open an empty block.
      const picker = createItemPicker({
        placeholder: 'Look up an item…',
        items: items.map((i) => ({ ...i, name: i.item })),
        onPick: (it) => {
          picker.clear();
          openFocalMenu(it.item, (h) => mount(h, itemBlock(it, BLOCK)));
        },
      });

      mount(host,
        el('div.card', {}, [
          el('h3', {}, (d.hold || 'Your ' + regionWord()) + (label ? ' · ' + label : '')),
          el('p', { class: 'note' }, 'Average value is what the item actually changed hands for here — ' +
            'every sale and every delivery bought from your ' + regionWord() + ', weighted by units and with ' +
            'outliers fenced off, so one buyer overpaying does not become the item’s worth. Hover a value to ' +
            'see how much trade it rests on.'),
          ...items.slice(0, TOP_ITEMS).map((i) => itemBlock(i, BLOCK)),
          ...(items.length > TOP_ITEMS ? [
            el('h4', {}, 'Look up an item'),
            el('p', { class: 'note' }, 'Any of the ' + items.length + ' items that traded here last week.'),
            picker.el,
          ] : []),
        ]),
      );
    })
    .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
}
