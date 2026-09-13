/**
 * The Terms of Service and the Privacy Policy, as data.
 *
 * WHY THESE ARE NOT ADMIN-EDITABLE, when the About page is. The About page says
 * what a realm is; these say what the SOFTWARE does with a person's data and on
 * what terms it is offered. Those are facts about this deployment — one
 * codebase, one database, one sign-in provider — and they are the same whichever
 * realm you are looking at. An editable privacy policy is a privacy policy that
 * can be made false, and the person editing it is not the one who decides where
 * the data goes.
 *
 * WHY THEY ARE NOT TRANSLATED. `scripts/i18n-extract.mjs` skips this file, so
 * none of it reaches the language packs and every reader gets the English. That
 * is deliberate twice over: a mistranslated sentence about what happens to
 * somebody's data is worse than an honest one they have to read in a second
 * language, and a document of this length would otherwise cost a full
 * translation pass per release for wording that changes rarely. The page says
 * so under its own title, in the READER'S language — that one sentence lives in
 * the view, because a notice explaining why the rest is English is no use in
 * English.
 *
 * KEEP IT TRUE. Every claim here is checkable against the code, and several are
 * load-bearing:
 *   • the columns listed under "What we store" are `users`, `sessions` and the
 *     per-shop tables in `worker/src/db.js`;
 *   • "your IP is never written down" is `ratelimit.js` — an in-memory Map keyed
 *     by token, or by IP only for an unauthenticated caller, in a 60-second
 *     window;
 *   • the browser keys are `auth.js`, `theme.js`, `i18n.js`, `offline-queue.js`
 *     and `guide.js`.
 * If one of those changes, this changes in the same commit.
 */

/**
 * When the wording last moved materially. ISO, so the page can write it in the
 * reader's own language and format like every other date in the app — an
 * English month name under a German heading would be the one bit of this that
 * nobody chose.
 */
export const LEGAL_UPDATED = '2026-09-13';

/**
 * A document: a title, a standfirst, and sections of prose.
 *
 * A section's `body` is a list, where a string is a paragraph and an array is a
 * bulleted list. That is the whole grammar — enough for a document like this
 * and not enough to need a parser.
 */
const TERMS = {
  key: 'terms',
  title: 'Terms of Service',
  intro: 'The Vici Automated Ledger is a free, fan-made bookkeeping tool for roleplay trade on the ' +
    'Mereth Skyrim RP server. These are the terms it is offered on. They are meant to be read, so ' +
    'they are written plainly and kept short.',
  sections: [
    { heading: 'It is free, and it is provided as it is', body: [
      'The Ledger costs nothing and always will. Nothing in it is paywalled, no shop pays for a ' +
        'better place in it, and no one is asked for a coin to keep trading. The tip jar on the ' +
        'About page is a thank-you to the person who writes it and buys nothing here.',
      'It is offered WITHOUT WARRANTY OF ANY KIND. It may be unavailable, it may be wrong, and it ' +
        'may lose data. Backups are taken but are not a promise. Nothing here is a guarantee of ' +
        'availability, accuracy, or fitness for any purpose, and the people who run it are not ' +
        'liable for any loss arising from using it.',
      'If a figure in the Ledger matters to you, keep your own record of it. Owners can export ' +
        'their shop’s books as a spreadsheet at any time from Shop Settings.',
    ] },
    { heading: 'Everything in here is fiction', body: [
      'Every coin, price, coffer, wage, levy and rent in the Ledger is roleplay. None of it is ' +
        'real money, none of it can be exchanged for real money, and none of it entitles anyone ' +
        'to anything outside the game.',
      'Do not use the Ledger to arrange real-world payments or to record real transactions. It is ' +
        'a book for a story.',
    ] },
    { heading: 'Your account', body: [
      'You sign in with a Google account, and that account is your identity here. You are ' +
        'responsible for what is done under it — so keep it to yourself, and sign out on a device ' +
        'you share.',
      'Join codes admit people to a realm, a shop, or a Court’s premises. Treat them as ' +
        'credentials: give one only to somebody who should have it, and if one goes somewhere it ' +
        'should not have, reissue it — which stops the old one working immediately.',
      'One person, one account. Registering more than once to hold extra shops, or to appear as ' +
        'more than one trader, is not on.',
    ] },
    { heading: 'What you may not do', body: [
      'Most of this is enforced by the software rather than left to good manners, but stating it ' +
        'is the point of a term:',
      [
        'Do not try to reach another shop’s, another Court’s or another realm’s data — by a URL, ' +
          'a code you were not given, or anything else.',
        'Do not automate the Ledger against its will: no scripts hammering the API, no scraping.',
        'Do not use the free-text fields — notes, notices, feedback, customer names — to harass ' +
          'anybody, or for anything unlawful.',
        'Do not attempt to break, overload, or find your way around the parts that decide who may ' +
          'see what.',
      ],
      'Finding a hole is welcome; walking through it is not. Report it through Feedback.',
    ] },
    { heading: 'What you write stays yours', body: [
      'Your character, your shop’s name, your notes and everything you record remain yours. By ' +
        'entering them you allow the Ledger to store them and show them to the people it is built ' +
        'to show them to — your shop, your realm’s admins, and your region’s Court — and to count ' +
        'them in the network’s market figures.',
      'That last part is the point of a shared ledger: what your shop trades helps decide what ' +
        'the realm thinks things are worth. If you would rather it did not, the answer is not to ' +
        'record it here.',
    ] },
    { heading: 'Who decides things', body: [
      'The Ledger enforces rules; it does not make them. Owners activate and remove their own ' +
        'staff, Courts govern the shops in their region, and a realm’s admins run the realm — ' +
        'including suspending an account, archiving a shop, or removing someone from it.',
      'Those are the server’s decisions, not the software’s, and they are taken up with the ' +
        'people who run your realm rather than with this page.',
      'An account may be deactivated or removed for breaking these terms. You may leave at any ' +
        'time from Profile → Leave your shop.',
    ] },
    { heading: 'Changes', body: [
      'These terms may change as the Ledger does. A material change is announced in Patch Notes, ' +
        'and the date at the top of this page always says when it last moved. Carrying on using ' +
        'the Ledger after a change accepts it.',
    ] },
    { heading: 'Not affiliated with anybody', body: [
      'This is a fan project. It is not made, endorsed, or supported by Bethesda Softworks or ' +
        'ZeniMax — The Elder Scrolls and Skyrim are theirs — nor by Google, Cloudflare, GitHub, ' +
        'or Ko-fi, whose services it merely uses.',
    ] },
    { heading: 'Getting in touch', body: [
      'Signed in, the Feedback page in the side menu reaches the people who run the Ledger, and ' +
        'you can see everything you have sent. Otherwise, SmileDaemon on the Mereth Discord.',
    ] },
  ],
};

const PRIVACY = {
  key: 'privacy',
  title: 'Privacy Policy',
  intro: 'What the Vici Automated Ledger knows about you, where it keeps it, who can see it, and ' +
    'how to get rid of it. Everything below is a description of what the software actually does.',
  sections: [
    { heading: 'The short version', body: [
      'The Ledger holds your email address, the character and shop names you give it, and the ' +
        'trade you record. There is no advertising, no tracking, no analytics, and nothing is ' +
        'ever sold or handed to anybody beyond the services that run the site.',
    ] },
    { heading: 'What we get from Google', body: [
      'Signing in tells us two things about your Google account: your EMAIL ADDRESS and the ' +
        'DISPLAY NAME on it. That is all we ask for and all we receive.',
      'We never see your Google password. We do not read your mail, your contacts, your files, or ' +
        'anything else in your account, and we do not store your profile picture.',
      'Your email is how the Ledger knows who you are between visits, and it is what an admin or ' +
        'your shop’s owner sees on your membership.',
    ] },
    { heading: 'What you tell us', body: [
      'Everything else is something you or your shop typed in:',
      [
        'your character name, and which business you belong to;',
        'your role, your standing, and the pay or commission rate your owner has set;',
        'the sales, deliveries, transfers, crafting, harvests and stocktakes you record;',
        'your shop’s coffer entries, notices, discounts, specials and settings;',
        'your time cards — when you clocked on and off;',
        'anything you send through Feedback, which arrives with your name, shop and the date;',
        'notes an admin or a Court may write about your membership or your shop.',
      ],
      'A sale can also carry a CUSTOMER’S NAME, typed by whoever rang it up. That may be your ' +
        'character on somebody else’s books — the Ledger has no way to know, so if you would ' +
        'rather it was not recorded, ask the shop not to type it.',
    ] },
    { heading: 'What the app notes as you work', body: [
      'When your account was created, when it last made a request, and which of your shops you ' +
        'are currently acting as. Significant actions by owners, Courts and admins are written to ' +
        'an audit log with the actor’s name — so that a shop can see who changed what.',
    ] },
    { heading: 'What we do NOT collect', body: [
      [
        'No advertising, and no advertising identifiers.',
        'No analytics, no tracking pixels, and no third-party scripts on any page you use.',
        'No location data.',
        'No cookies for tracking. The Ledger uses none at all.',
        'No IP addresses in the database. Your IP is used in memory to rate-limit requests from ' +
          'callers who are not signed in, in a window one minute long, and is never written down.',
      ],
    ] },
    { heading: 'Where it is kept', body: [
      'The data lives in Cloudflare D1 — a database in Cloudflare’s network — and is reached ' +
        'through a Cloudflare Worker. The site itself is served from GitHub Pages. Google handles ' +
        'the sign-in. Where off-site backups are switched on for a deployment, a daily encrypted-' +
        'in-transit snapshot is written to Cloudflare R2 and the most recent fortnight is kept.',
      'Those four are the only companies involved, and each is a service the Ledger runs on rather ' +
        'than somebody we hand your data to for their own use.',
      'One page loads something from outside: the tip jar button on the About page is an image ' +
        'from Ko-fi, and following the link takes you to Ko-fi’s own site, under their policies. ' +
        'No other page fetches anything from a third party.',
    ] },
    { heading: 'What is kept in your browser', body: [
      'Not cookies — the Ledger stores a few things in your browser’s own local storage, where ' +
        'they stay on your device:',
      [
        'your session token and the email and name it signed in with, so that reloading the page ' +
          'does not sign you out;',
        'your chosen surface, text size and language;',
        'any sales you rang up while offline, waiting to be sent;',
        'which “How this works” panels you have finished with.',
      ],
      'Signing out clears the session; the rest are preferences and stay until you clear your ' +
        'browser’s data for this site. The app also keeps a copy of its own pages so it works ' +
        'without a connection — that is the app itself, not anything about you.',
    ] },
    { heading: 'Who can see what', body: [
      [
        'YOUR SHOP — its owner and managers see your membership, your shifts and what you have ' +
          'sold, because that is what paying you depends on.',
        'YOUR REALM’S ADMINS — the whole of that realm, including your email address.',
        'YOUR REGION’S COURT — a read-only view of the shops in its own region: their rosters, ' +
          'their books and how they are trading. It cannot change anything, and it cannot see ' +
          'outside its region.',
        'OTHER REALMS — nothing. A realm is a sealed server; no report, search or figure ever ' +
          'crosses from one into another.',
        'THE PUBLIC — nothing. Every page but the sign-in screen and these documents requires an ' +
          'account, and there is no public shop page.',
      ],
      'Nothing is sold, rented, or shared for anybody’s marketing, ever.',
    ] },
    { heading: 'How long it is kept', body: [
      [
        'Sign-in sessions expire after 24 hours, and signing out ends one immediately.',
        'Your membership row is DELETED when you leave a shop, and your sessions are ended with it.',
        'A shop that closes is archived rather than deleted: its books stay on the network’s ' +
          'records, under a reserved name, so a realm’s history does not develop a hole. Its ' +
          'trade stops counting towards the market’s figures.',
        'Where off-site backups are switched on, a copy may persist in them for up to a fortnight ' +
          'after it is deleted from the live database.',
      ],
    ] },
    { heading: 'What you can do about it', body: [
      [
        'SEE IT — your profile, your time card and your own feedback are all in the app. An owner ' +
          'can export their shop’s whole records as a spreadsheet from Shop Settings.',
        'CORRECT IT — your character name is yours to change on the Profile page. Anything your ' +
          'shop recorded is your owner’s to correct.',
        'DELETE IT — Profile → Leave your shop removes your membership and signs you out. To have ' +
          'an account and everything attached to it removed entirely, ask an admin of your realm.',
      ],
      'Depending on where you live you may have further rights over your data, such as asking for ' +
        'a copy of it or objecting to it being held. Ask, and we will do what we can — this is a ' +
        'small hobby project and the honest answer is that a request is handled by a person ' +
        'reading it, not by a process.',
    ] },
    { heading: 'Children', body: [
      'The Ledger is not directed at children under 13 and we do not knowingly hold their data. ' +
        'If you believe a child has registered, tell an admin and the account will be removed.',
    ] },
    { heading: 'Changes', body: [
      'This policy changes when what the software does changes. A material change is announced in ' +
        'Patch Notes, and the date at the top of this page says when it last moved.',
    ] },
    { heading: 'Getting in touch', body: [
      'Signed in, use the Feedback page in the side menu. Otherwise, SmileDaemon on the Mereth ' +
        'Discord. There is no data-protection department; there is one person, and they read it.',
    ] },
  ],
};

/** Both documents, by the key their route uses. */
export const LEGAL_DOCS = { terms: TERMS, privacy: PRIVACY };
