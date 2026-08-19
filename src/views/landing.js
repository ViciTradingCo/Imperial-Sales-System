/**
 * Landing / About page. Signed-out visitors see it first (with the sign-in
 * button); signed-in users can revisit it from the "About" nav item.
 *
 * The wording is ADMIN-EDITABLE, and edited HERE — an admin looking at the page
 * gets an "Edit this page" button that turns the cards themselves into their
 * own fields. It used to be a form in Network Settings, three boxes labelled
 * Heading / Body / Credits with no sight of what they produced; the page is the
 * only honest preview of the page, so the form moved onto it and the settings
 * tile now brings you here. Saving writes at YOUR scope: a System Admin edits
 * the deployment's own copy, a Realm Admin their realm's overrides, exactly as
 * the branding form does — the Worker decides which, never the client.
 *
 * Admin text is rendered as TEXT NODES, never HTML. A free-text field that
 * accepted markup would accept a <script>, and this page is served to every
 * visitor of the realm — including ones holding a session token. `richText`
 * gives paragraphs and bullets, which is as much as anyone needs here.
 */
import { el, mount } from '../lib/dom.js';
import { branding, applyBranding } from '../lib/branding.js';
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.js';

/**
 * The stock copy — what a blank field falls back to.
 *
 * It lives here rather than in the Worker's defaults so that clearing a box
 * RESTORES the built-in wording instead of emptying the page; the two links of
 * the tip jar are the exception and default in the Worker, since a button
 * pointing nowhere is not a fallback.
 */
const STOCK = {
  aboutBody: 'A sales system for the Mereth Skyrim RP server. Shops across the ' +
    'holds record their sales and restocks, owners manage their own inventory ' +
    'and staff, and Vici Trading Co. keeps the whole trade network — certification ' +
    'and pooled records — in one place.',
  supportTitle: 'Tip the ledger-keeper',
  supportBody: 'This ledger is the work of one person. Every part of it — the register, ' +
    'the stockrooms, the market analysis, the courts, the coffers — was designed, written, ' +
    'and rewritten by SmileDaemon over a long run of evenings and weekends, then kept ' +
    'running afterwards: bugs chased down, features added because a shopkeeper asked, ' +
    'the whole thing rebuilt from a pile of spreadsheets into the app you are reading now.\n\n' +
    'It is free to use, and it stays that way. Nothing here is paywalled, no shop pays for ' +
    'a better place in it, and no one is asked for a coin to keep trading.\n\n' +
    'If it has saved you an evening of bookkeeping, or you just want to say thanks for the ' +
    'hours behind it, the tip jar is below. It goes straight to SmileDaemon and pays for ' +
    'the upkeep — and for the next thing on the list.',
};

/** Renders free text: blank lines split paragraphs, "- " lines become bullets. */
function richText(text) {
  const out = [];
  String(text || '').split(/\n{2,}/).forEach((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    if (lines.every((l) => l.startsWith('- '))) {
      out.push(el('ul', { class: 'feature-list' }, lines.map((l) => el('li', {}, l.slice(2)))));
    } else {
      out.push(el('p', {}, lines.join(' ')));
    }
  });
  return out;
}

/** The credits fallback — a literal, so the one bit of markup here is ours. */
function stockCredits() {
  return [
    el('p', { html: 'Created and managed by <b>SmileDaemon</b>.' }),
    el('p', { class: 'note' }, 'Questions or concerns? Send them directly to SmileDaemon on Discord.'),
  ];
}

/**
 * The tip jar's button: the supporter's own image, linked to their page.
 *
 * The image is a third party's and the service worker does not cache anything
 * cross-origin, so offline (or with the host blocked) it simply will not load —
 * the error handler turns the button into a plain text link rather than leaving
 * a broken box, the same fallback the header logo and the tile art use.
 */
function supportButton(b) {
  const link = el('a', { class: 'kofi', href: b.supportUrl, target: '_blank', rel: 'noopener noreferrer' });
  if (b.supportImageUrl) {
    const img = el('img', { class: 'kofi-img', src: b.supportImageUrl, alt: 'Support this project', loading: 'lazy' });
    img.addEventListener('error', () => {
      img.remove();
      link.classList.add('kofi-plain');
      link.appendChild(document.createTextNode('Support this project ↗'));
    });
    link.appendChild(img);
  } else {
    link.classList.add('kofi-plain');
    link.appendChild(document.createTextNode('Support this project ↗'));
  }
  return link;
}


/** The page as everyone reads it. */
function aboutView({ signInMount, canEdit, onEdit }) {
  const b = branding();
  const nodes = [];

  if (canEdit) {
    nodes.push(el('div.card.about-edit', {}, [
      el('span', { class: 'note' }, 'This page is yours to write — heading, body, credits, and the tip jar.'),
      el('button.secondary-btn', { onclick: onEdit }, '✎ Edit this page'),
    ]));
  }

  nodes.push(el('div.card.hero', {}, [
    el('h2', {}, b.aboutTitle || b.tagline || 'The Vici Automated Ledger'),
    ...richText(b.aboutBody || STOCK.aboutBody),
  ]));

  if (signInMount) {
    nodes.push(el('div.card.signin-wrap', {}, [
      el('h3', {}, 'Sign in to begin'),
      el('p', { class: 'note' }, 'Use the Google account you trade under. ' +
        'New faces are asked to register a character and a business.'),
      signInMount,
    ]));
  }

  nodes.push(el('div.card', {}, [
    el('h3', {}, 'What you can do'),
    el('ul', { class: 'feature-list' }, [
      el('li', {}, 'Employees ring up sales at their shop’s register.'),
      el('li', {}, 'Owners manage their shop: inventory, staff, and pricing.'),
      el('li', {}, 'Admins keep the network and its settings in order.'),
      el('li', {}, 'Your view only ever shows the business you belong to.'),
    ]),
  ]));

  nodes.push(el('div.card.credits', {}, [
    el('h3', {}, 'Credits'),
    ...(b.aboutCredits ? richText(b.aboutCredits) : stockCredits()),
  ]));

  // The tip jar sits under the credits — it is the same subject, said with a
  // button — and only appears when it has somewhere to point.
  if (b.supportUrl) {
    nodes.push(el('div.card.support', {}, [
      el('h3', {}, b.supportTitle || STOCK.supportTitle),
      ...richText(b.supportBody || STOCK.supportBody),
      el('div', { class: 'kofi-wrap' }, [supportButton(b)]),
      el('p', { class: 'note' }, 'Tips are a thank-you, never a requirement. The ledger works the same either way.'),
    ]));
  }

  return nodes;
}

/**
 * The page as an admin writes it: the same cards, with the wording turned into
 * its own fields. `onSave(values)` does the writing and is expected to redraw;
 * it rejects with something worth showing when the Worker refuses.
 */
function aboutEditor({ draft, scope, inherited, onSave, onCancel }) {
  const fields = {};

  /** One labelled box, prefilled from this admin's own value. */
  function box(key, label, node, hint) {
    node.value = draft[key] || '';
    if (hint) node.placeholder = hint;
    fields[key] = node;
    return el('div', { class: 'about-field' }, [el('label', {}, label), node]);
  }

  /**
   * What an empty box will fall back to — a Realm Admin's inherited wording if
   * they have any, otherwise the stock copy. Shown as the placeholder so blank
   * reads as "inherited", never as "missing".
   */
  function fallbackHint(key, stock) {
    const from = scope === 'realm' ? inherited[key] : '';
    const text = from || stock || '';
    return text ? (from ? 'Inherited: ' : '') + text.slice(0, 110) : '';
  }

  // A form this long wants its Save at both ends, and a DOM node can only be in
  // one place — so each bar builds its own buttons and status line, and saving
  // speaks to all of them at once.
  const bars = [];
  function actionBar(note) {
    const save = el('button.primary', { onclick: doSave }, 'Save page');
    const status = el('span', { class: 'note' });
    bars.push({ save, status });
    return el('div.card.about-edit', {}, [
      el('span', { class: 'note' }, note),
      el('div', { class: 'row-actions' }, [status, save, el('button', { onclick: onCancel }, 'Cancel')]),
    ]);
  }
  const say = (text, cls) => bars.forEach((b) => {
    b.status.className = cls || 'note';
    b.status.textContent = text || '';
  });

  async function doSave() {
    bars.forEach((b) => { b.save.disabled = true; });
    say('Saving…');
    const values = {};
    Object.keys(fields).forEach((k) => { values[k] = fields[k].value.trim(); });
    try {
      await onSave(values);
    } catch (e) {
      say(e.message || String(e), 'error');
      bars.forEach((b) => { b.save.disabled = false; });
    }
  }

  return [
    actionBar(scope === 'realm'
      ? 'You are editing this realm’s About page. A box left blank uses the deployment’s wording.'
      : 'You are editing the About page every visitor sees. A box left blank uses the built-in wording.'),

    el('div.card.hero', {}, [
      box('aboutTitle', 'Heading', el('input', { type: 'text' }), fallbackHint('aboutTitle', branding().tagline)),
      box('aboutBody', 'Body', el('textarea', { rows: '8' }), fallbackHint('aboutBody', STOCK.aboutBody)),
      el('p', { class: 'note' }, 'Blank lines separate paragraphs; a block of lines each starting with “- ” becomes a bullet list.'),
    ]),

    el('div.card.credits', {}, [
      el('h3', {}, 'Credits'),
      box('aboutCredits', 'What it says', el('textarea', { rows: '4' }),
        fallbackHint('aboutCredits', 'Created and managed by SmileDaemon.')),
    ]),

    el('div.card.support', {}, [
      el('h3', {}, 'Tip jar'),
      box('supportTitle', 'Heading', el('input', { type: 'text' }), fallbackHint('supportTitle', STOCK.supportTitle)),
      box('supportBody', 'What it says', el('textarea', { rows: '8' }), fallbackHint('supportBody', STOCK.supportBody)),
      box('supportImageUrl', 'Button image link', el('input', { type: 'url' }), fallbackHint('supportImageUrl', 'https://…')),
      box('supportUrl', 'Where the button goes', el('input', { type: 'url' }), fallbackHint('supportUrl', 'https://…')),
      el('p', { class: 'note' }, scope === 'realm'
        // A realm's blank field INHERITS, so blanking is not how a realm hides
        // it — say so here rather than let an admin clear the box and wonder.
        ? 'Both links must be full https:// addresses. Left blank they use the deployment’s, ' +
          'which is why a realm cannot take the tip jar off by clearing them.'
        : 'Clear the destination link to take the whole tip jar off the page. ' +
          'Both links must be full https:// addresses.'),
    ]),

    actionBar('Nothing is saved until you press Save page.'),
  ];
}

export function renderLanding(container, { signInMount, me } = {}) {
  // Who is offered the pencil: an admin — the same people the Worker will let
  // save. A visitor and an ordinary member see the page and nothing else.
  const canEdit = !!(me && me.role === 'admin');
  const draw = (nodes) => mount(container, ...nodes);
  const showPage = () => draw(aboutView({ signInMount, canEdit, onEdit: startEdit }));

  async function startEdit() {
    let r;
    try {
      r = await api.getBrandingAdmin();
    } catch (e) { toast(e.message || String(e), 'error'); return; }
    draw(aboutEditor({
      draft: r.branding || {},
      scope: r.scope || 'site',
      inherited: r.inherited || {},
      onCancel: showPage,
      // The endpoint answers with the branding now in force, so the page is
      // redrawn from what was SAVED rather than from what was typed.
      onSave: async (values) => {
        applyBranding(await api.setBranding(values));
        showPage();
        toast('About page saved', 'ok');
      },
    }));
    window.scrollTo(0, 0);
  }

  showPage();
}
