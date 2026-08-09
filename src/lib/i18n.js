/**
 * Lightweight client-side translation.
 *
 * The app is authored in English; this layer swaps interface text to the user's
 * chosen language at render time. It works by translating text nodes (and
 * placeholder/title attributes) against an English→target dictionary, and a
 * MutationObserver re-applies it to anything rendered later — so one mechanism
 * covers the whole app without threading a t() through every view.
 *
 * Notes:
 *  • English is the source language (no dictionary, no work).
 *  • Proper nouns (the app name, character/business names) and any string not in
 *    the dictionary are left as-is, so nothing ever renders blank.
 *  • The choice is per-device (localStorage), like the theme. Changing it
 *    reloads so every surface re-renders cleanly in the new language.
 */
export const LANGS = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
};

const KEY = 'eec.lang';

export function getLang() {
  try { return localStorage.getItem(KEY) || 'en'; } catch (e) { return 'en'; }
}
export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch (e) { /* private mode */ }
}

// English phrase → per-language translation. Keep keys EXACTLY as they appear in
// the UI (trimmed). Add rows freely; missing rows fall back to English.
const T = {
  // Nav + shell
  'Home': { es: 'Inicio', fr: 'Accueil', de: 'Start', it: 'Home' },
  'Admin Panel': { es: 'Panel de administración', fr: 'Panneau d’administration', de: 'Admin-Bereich', it: 'Pannello admin' },
  'Business Operations': { es: 'Operaciones', fr: 'Opérations', de: 'Betrieb', it: 'Operazioni' },
  'Ledger Settings': { es: 'Ajustes del negocio', fr: 'Réglages du registre', de: 'Ladeneinstellungen', it: 'Impostazioni registro' },
  'Network Settings': { es: 'Ajustes de red', fr: 'Réglages du réseau', de: 'Netzwerk­einstellungen', it: 'Impostazioni rete' },
  'Profile': { es: 'Perfil', fr: 'Profil', de: 'Profil', it: 'Profilo' },
  'Patch Notes': { es: 'Notas de versión', fr: 'Notes de version', de: 'Änderungen', it: 'Note di rilascio' },
  'About': { es: 'Acerca de', fr: 'À propos', de: 'Über', it: 'Informazioni' },
  'Sign Out': { es: 'Cerrar sesión', fr: 'Se déconnecter', de: 'Abmelden', it: 'Esci' },
  'Sign out': { es: 'Cerrar sesión', fr: 'Se déconnecter', de: 'Abmelden', it: 'Esci' },

  // Action bars / lists
  'Register': { es: 'Caja', fr: 'Caisse', de: 'Kasse', it: 'Cassa' },
  'Inventory': { es: 'Inventario', fr: 'Inventaire', de: 'Inventar', it: 'Inventario' },
  'Employees': { es: 'Empleados', fr: 'Employés', de: 'Mitarbeiter', it: 'Dipendenti' },
  'Member List': { es: 'Lista de miembros', fr: 'Liste des membres', de: 'Mitgliederliste', it: 'Elenco membri' },
  'Company List': { es: 'Lista de empresas', fr: 'Liste des entreprises', de: 'Firmenliste', it: 'Elenco aziende' },

  // Common buttons
  'Save': { es: 'Guardar', fr: 'Enregistrer', de: 'Speichern', it: 'Salva' },
  'Save profile': { es: 'Guardar perfil', fr: 'Enregistrer le profil', de: 'Profil speichern', it: 'Salva profilo' },
  'Save note': { es: 'Guardar nota', fr: 'Enregistrer la note', de: 'Notiz speichern', it: 'Salva nota' },
  'Edit': { es: 'Editar', fr: 'Modifier', de: 'Bearbeiten', it: 'Modifica' },
  'Delete': { es: 'Eliminar', fr: 'Supprimer', de: 'Löschen', it: 'Elimina' },
  'Remove': { es: 'Quitar', fr: 'Retirer', de: 'Entfernen', it: 'Rimuovi' },
  'Cancel': { es: 'Cancelar', fr: 'Annuler', de: 'Abbrechen', it: 'Annulla' },
  'Search': { es: 'Buscar', fr: 'Rechercher', de: 'Suchen', it: 'Cerca' },
  'Notes': { es: 'Notas', fr: 'Notes', de: 'Notizen', it: 'Note' },
  'Subscription': { es: 'Suscripción', fr: 'Abonnement', de: 'Abonnement', it: 'Abbonamento' },
  'Activate': { es: 'Activar', fr: 'Activer', de: 'Aktivieren', it: 'Attiva' },
  'Add to order': { es: 'Añadir al pedido', fr: 'Ajouter à la commande', de: 'Zur Bestellung', it: 'Aggiungi all’ordine' },
  'Complete sale': { es: 'Completar venta', fr: 'Finaliser la vente', de: 'Verkauf abschließen', it: 'Completa vendita' },
  'Record intake': { es: 'Registrar entrada', fr: 'Enregistrer un achat', de: 'Wareneingang', it: 'Registra carico' },
  // The register's two sides.
  'Selling': { es: 'Vendiendo', fr: 'Vente', de: 'Verkauf', it: 'Vendita' },
  'Buying': { es: 'Comprando', fr: 'Achat', de: 'Einkauf', it: 'Acquisto' },
  'Intake Ingredients/Stock': { es: 'Registrar ingredientes/existencias', fr: 'Réception d’ingrédients / stock', de: 'Zutaten/Warenzugang erfassen', it: 'Carico ingredienti/scorte' },
  'How this step works': { es: 'Cómo funciona este paso', fr: 'Comment fonctionne cette étape', de: 'So funktioniert dieser Schritt', it: 'Come funziona questo passaggio' },
  'Void this sale': { es: 'Anular esta venta', fr: 'Annuler cette vente', de: 'Verkauf stornieren', it: 'Annulla vendita' },

  // Headings
  'Appearance': { es: 'Apariencia', fr: 'Apparence', de: 'Darstellung', it: 'Aspetto' },
  'Language': { es: 'Idioma', fr: 'Langue', de: 'Sprache', it: 'Lingua' },
  'Order': { es: 'Pedido', fr: 'Commande', de: 'Bestellung', it: 'Ordine' },
  'Customer Details': { es: 'Datos del cliente', fr: 'Détails du client', de: 'Kundendaten', it: 'Dati cliente' },
  'Recent deliveries': { es: 'Entregas recientes', fr: 'Livraisons récentes', de: 'Letzte Lieferungen', it: 'Consegne recenti' },
  'Credits': { es: 'Créditos', fr: 'Crédits', de: 'Mitwirkende', it: 'Crediti' },
  'What you can do': { es: 'Qué puedes hacer', fr: 'Ce que vous pouvez faire', de: 'Was du tun kannst', it: 'Cosa puoi fare' },
  'Sign in to begin': { es: 'Inicia sesión para empezar', fr: 'Connectez-vous pour commencer', de: 'Zum Start anmelden', it: 'Accedi per iniziare' },
  'Edit company': { es: 'Editar empresa', fr: 'Modifier l’entreprise', de: 'Firma bearbeiten', it: 'Modifica azienda' },
  'Edit member': { es: 'Editar miembro', fr: 'Modifier le membre', de: 'Mitglied bearbeiten', it: 'Modifica membro' },

  // Labels / fields
  'Character name': { es: 'Nombre del personaje', fr: 'Nom du personnage', de: 'Charaktername', it: 'Nome personaggio' },
  'Business name': { es: 'Nombre del negocio', fr: 'Nom de l’entreprise', de: 'Firmenname', it: 'Nome attività' },
  'Company name': { es: 'Nombre de la empresa', fr: 'Nom de l’entreprise', de: 'Firmenname', it: 'Nome azienda' },
  'Business': { es: 'Negocio', fr: 'Entreprise', de: 'Firma', it: 'Attività' },
  'Company': { es: 'Empresa', fr: 'Entreprise', de: 'Firma', it: 'Azienda' },
  'Role': { es: 'Rol', fr: 'Rôle', de: 'Rolle', it: 'Ruolo' },
  'Status': { es: 'Estado', fr: 'Statut', de: 'Status', it: 'Stato' },
  'Email': { es: 'Correo', fr: 'E-mail', de: 'E-Mail', it: 'Email' },
  'Region': { es: 'Feudo', fr: 'Fief', de: 'Fürstentum', it: 'Contea' },
  'Theme': { es: 'Tema', fr: 'Thème', de: 'Design', it: 'Tema' },
  'Customer': { es: 'Cliente', fr: 'Client', de: 'Kunde', it: 'Cliente' },
  'Quantity': { es: 'Cantidad', fr: 'Quantité', de: 'Menge', it: 'Quantità' },
  'Item': { es: 'Artículo', fr: 'Article', de: 'Artikel', it: 'Articolo' },
  'Vendor': { es: 'Proveedor', fr: 'Fournisseur', de: 'Lieferant', it: 'Fornitore' },
  'Sale price': { es: 'Precio de venta', fr: 'Prix de vente', de: 'Verkaufspreis', it: 'Prezzo di vendita' },

  // Statuses / words
  'active': { es: 'activo', fr: 'actif', de: 'aktiv', it: 'attivo' },
  'pending': { es: 'pendiente', fr: 'en attente', de: 'ausstehend', it: 'in attesa' },
  'guest': { es: 'invitado', fr: 'invité', de: 'Gast', it: 'ospite' },
  'admin': { es: 'administrador', fr: 'administrateur', de: 'Administrator', it: 'amministratore' },
  'owner': { es: 'propietario', fr: 'propriétaire', de: 'Inhaber', it: 'proprietario' },
  'employee': { es: 'empleado', fr: 'employé', de: 'Mitarbeiter', it: 'dipendente' },
  'Shop Owner': { es: 'Propietario', fr: 'Propriétaire', de: 'Ladeninhaber', it: 'Proprietario' },
  'Employee': { es: 'Empleado', fr: 'Employé', de: 'Mitarbeiter', it: 'Dipendente' },
  'Cart is empty': { es: 'El carrito está vacío', fr: 'Le panier est vide', de: 'Warenkorb ist leer', it: 'Il carrello è vuoto' },
  'Your account is active.': { es: 'Tu cuenta está activa.', fr: 'Votre compte est actif.', de: 'Dein Konto ist aktiv.', it: 'Il tuo account è attivo.' },
};

let cache = null;
let cacheLang = null;
function dict() {
  const l = getLang();
  if (l === 'en') return null;
  if (cacheLang === l && cache) return cache;
  const out = {};
  for (const en in T) { if (T[en][l]) out[en] = T[en][l]; }
  cache = out; cacheLang = l;
  return out;
}

function translatePhrase(s) {
  const d = dict();
  if (!d) return s;
  const key = s.trim();
  if (!key) return s;
  const hit = d[key];
  return hit == null ? s : s.replace(key, hit);
}

function translateNode(node) {
  if (!dict()) return;
  if (node.nodeType === 3) { // text
    const t = translatePhrase(node.nodeValue);
    if (t !== node.nodeValue) node.nodeValue = t;
    return;
  }
  if (node.nodeType !== 1) return; // elements only past here
  if (node.hasAttribute) {
    ['placeholder', 'title', 'aria-label'].forEach((a) => {
      if (node.hasAttribute(a)) {
        const v = node.getAttribute(a);
        const t = translatePhrase(v);
        if (t !== v) node.setAttribute(a, t);
      }
    });
  }
  node.childNodes.forEach(translateNode);
}

let observer = null;

/** Translate the current document and keep translating anything rendered later. */
export function applyLang() {
  cache = null; cacheLang = null; // pick up the current language
  if (getLang() === 'en') return;
  translateNode(document.body);
  if (!observer) {
    observer = new MutationObserver((muts) => {
      muts.forEach((m) => m.addedNodes && m.addedNodes.forEach((n) => translateNode(n)));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
