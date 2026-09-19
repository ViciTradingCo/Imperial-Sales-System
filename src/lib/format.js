/**
 * Formatting helpers.
 *
 * The denomination is a per-realm setting (Realm Management → Network Settings),
 * so it is set once from the signed-in profile rather than hard-coded. It starts
 * as "gp" and every amount in the app renders through here, which is why there
 * is a single mutable value instead of threading it through every caller.
 */
import { getLang, deviceLocale, t } from './i18n.js';

/**
 * WHAT LANGUAGE A DATE IS WRITTEN IN — the same one the sentence around it is.
 *
 * Every date here went through `toLocaleDateString()` with no locale, which
 * asks the READER'S SYSTEM and nothing else. So an English interface on a
 * French device printed "16 – 22 août" — one language in the words, another in
 * the figures, in the middle of a sentence.
 *
 * ONE ANSWER FOR BOTH HALVES. `getLang()` now starts from the device too
 * (`i18n.deviceLang`), so the words and the dates come from the same place by
 * default and cannot disagree. When a reader OVERRULES it in Appearance the
 * dates follow them there, because a French interface with English dates is the
 * same fault the other way round.
 *
 * The REGION is a second question. `en-US` and `en-GB` are one language and two
 * ways of writing 3/4/2026, so when the device's own tag is in the language we
 * are rendering, its full tag wins — an American reads American dates. Only
 * when someone has chosen a language their device did not ask for do we fall
 * back to a sensible region for it, since their device's region says nothing
 * about how that language is written.
 */
const LOCALES = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT' };
function locale() {
  const lang = getLang();
  const device = deviceLocale();
  if (device && device.toLowerCase().split('-')[0] === lang) return device;
  return LOCALES[lang] || LOCALES.en;
}

/** A date, in the app's language. Anything unreadable comes back as ''. */
export function formatDate(value, opts) {
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale(), opts);
}

/** A date and a time, same rule. */
export function formatDateTime(value, opts) {
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(locale(), opts);
}

/**
 * A weekday by number, 0 = Sunday.
 *
 * The Worker works out WHICH day a shop trades best on; it must not also decide
 * what that day is CALLED, because it has no idea who is reading. So it sends
 * the number and the name is made here, in the reader's language — the same
 * division as money and regions.
 */
export function weekdayName(index) {
  const n = Math.floor(Number(index));
  if (!isFinite(n) || n < 0 || n > 6) return '';
  // 2024-01-07 was a Sunday; adding the index lands on the day wanted.
  return new Date(Date.UTC(2024, 0, 7 + n)).toLocaleDateString(locale(), { weekday: 'long', timeZone: 'UTC' });
}

let unit = 'gp';
let region = { label: 'Region', shown: true };

/** Sets the denomination for the rest of the session. Called at sign-in. */
export function setCurrency(c) { unit = String(c || 'gp').trim() || 'gp'; }
export function currency() { return unit; }

/**
 * Region wording and visibility, from the realm's preferences.
 *
 * Both are set once at sign-in for the same reason the denomination is: they
 * are presentation, every screen needs them, and threading them through every
 * render function would guarantee somewhere gets missed — which is exactly what
 * happened when only the register honoured them.
 */
export function setRegion(prefs) {
  region = {
    label: String((prefs && prefs.regionLabel) || 'Region').trim() || 'Region',
    shown: !prefs || prefs.showRegion !== false,
  };
}
/** What this realm calls a region, capitalised for labels. */
export function regionLabel() { return region.label; }
/** The same, lowercased for mid-sentence use. */
export function regionWord() { return region.label.toLowerCase(); }
/** Whether this realm uses regions at all. False hides every region surface. */
export function regionsOn() { return region.shown; }

/**
 * Whether this realm requires certification (the subscription).
 *
 * Set at sign-in with the other presentation settings, and read wherever a
 * screen would otherwise ask about expiry dates. The Worker enforces the rule
 * itself — this only decides what is worth SHOWING, so a realm that does not
 * charge for anything is not made to look at a subscription it does not have.
 */
let certOn = true;
export function setCertification(prefs) { certOn = !prefs || prefs.certification !== false; }
export function certificationOn() { return certOn; }

/**
 * ITEM KINDS — food, drink, a weapon — as this realm names them.
 *
 * Set at sign-in with the rest of the presentation settings, for the same
 * reason: a tag is STORED lowercase so it compares by one rule, and the realm's
 * own spelling is applied where it is shown. A realm renaming a kind re-renders
 * its stock; it never invalidates a listing's tags.
 */
let tags = [];
export function setItemTags(list) {
  tags = (Array.isArray(list) ? list : []).map((t) => String(t || '').trim()).filter(Boolean);
}
/** The realm's vocabulary, in its own spelling — what a tag picker offers. */
export function itemTags() { return tags.slice(); }
/**
 * How one stored tag is written on screen. A tag no longer in the vocabulary
 * still shows: removing a kind leaves it on the listings that carry it, and a
 * blank where a word used to be would be worse than the word.
 */
export function tagLabel(tag) {
  const raw = String(tag || '').trim();
  return tags.find((t) => t.toLowerCase() === raw.toLowerCase()) || raw;
}

/**
 * TRAVELING — a company with no fixed region. The word an admin picks on the
 * company record instead of a region, mirroring `worker/src/regions.js`, which
 * is where the rule is stated in full and which refuses to let a realm name a
 * real region this.
 *
 * NOT translated with the region label. Region/Hold/Province is what a realm
 * calls a PLACE; this is the answer "none of them", and it means the same thing
 * whatever the places are called.
 */
export const TRAVELING = 'Traveling';

/** Whether a company's region means "no fixed region". */
export function isTraveling(hold) {
  return String(hold || '').trim().toLowerCase() === TRAVELING.toLowerCase();
}

/**
 * An amount, in this realm's denomination.
 *
 * WHOLE COINS, ROUNDED DOWN. Prices may be typed with a fraction — the register
 * and the inventory both accept 22.5 — but nothing here deals in half a coin, so
 * every amount SHOWN is a whole number with the fraction dropped, never rounded
 * up. This mirrors `worker/src/money.js`, which applies the same rule to what
 * gets stored, so a figure on screen is the figure in the ledger.
 *
 * The float tail is settled BEFORE the fraction is dropped, at six places —
 * below anything a person would type, above the noise a summed ledger carries.
 * Without it 1239.9999999999998 would print as 1239; at two places a genuine
 * 12.999 would print as 13, rounding up. See worker/src/money.js.
 */
export function money(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0' + unit;
  return String(coins(v)) + unit;
}

/**
 * The numeric half of `money()` — whole coins, rounded down, no denomination.
 *
 * For a screen that has to ADD amounts up and show both the parts and the sum:
 * summing the raw figures and flooring once would print a total that is a coin
 * off the lines above it. The rule lives in one place so the two cannot drift.
 */
export function coins(n) {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.floor(Math.round(v * 1e6) / 1e6);
}

/**
 * WHAT SOMEBODY EARNS, worded for a screen — the roster's line and the time
 * card's, kept together because they are one fact told to two audiences and
 * because they share a trap.
 *
 * Both halves may stand alone: a shop pays by the hour, on what is sold, or
 * both, and neither is a fallback for the other. Nothing set is said plainly,
 * since 0 and "nobody has decided yet" look identical on a wage line.
 *
 * THE TRAP. The dictionary is keyed on whole TEXT NODES, so a line built at
 * render time out of two catalogue phrases reaches the page as a node that is
 * neither of them. The exact lookup misses, the matcher falls through to the
 * templates, and the first template that fits EATS THE OTHER HALF into its own
 * placeholder — a German roster read "5gp an hour · 10 % Provision". Nothing
 * errors when this happens; it is wrong only to somebody who reads the
 * language. The two functions answer it differently on purpose:
 *
 *   • `earningsLine` joins two fragments, so each is translated FIRST (`t`,
 *     the escape hatch in i18n.js — this line is why it exists);
 *   • `payTerms` is a sentence, so all three are spelled out WHOLE. That does
 *     not change a word of the English; it changes what the EXTRACTOR can see,
 *     which was otherwise the stem "You are paid {0}." with the entire clause
 *     in the hole. Collapsing them back would look harmless and break every
 *     pack — see the note over `payTerms` itself.
 *
 * `worker/test/i18n-assembled.test.js` drives both through every finished pack.
 */
export function earningsLine(payRate, commissionRate) {
  return [
    payRate ? t(money(payRate) + ' an hour') : '',
    commissionRate ? t(commissionRate + '% commission') : '',
  ].filter(Boolean).join(' · ') || 'No pay set';
}

/**
 * The same thing said to the person earning it, as a sentence.
 *
 * THREE WHOLE SENTENCES, not a stem with a clause pushed into it. The English
 * is identical either way; what the branches buy is three complete templates in
 * the catalogue instead of one useless `"You are paid {0}."`, which used to
 * match the finished sentence and hand its own English middle straight back —
 * "Du wirst mit 5gp an hour bezahlt." A translator needs the whole sentence in
 * any case, since German wraps the verb around the figure rather than following
 * it.
 */
export function payTerms(rate, commissionRate) {
  if (rate && commissionRate) {
    return 'You are paid ' + money(rate) + ' an hour and ' + commissionRate + '% of what you sell.';
  }
  if (rate) return 'You are paid ' + money(rate) + ' an hour.';
  if (commissionRate) return 'You are paid ' + commissionRate + '% of what you sell.';
  return 'No pay set — ask your owner to set an hourly rate, a commission, or both, or your work is ' +
    'worth nothing on the log.';
}
