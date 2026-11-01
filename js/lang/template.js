/* Translation template. To add a language:
   1. Copy this file to js/lang/<id>.js (bem for Icibemba, nya for Chinyanja, ...).
   2. Change 'template' below to the id and translate each English text. Have a native speaker
      check every line before publishing; leave a line out rather than guess.
   3. Add <script src="js/lang/<id>.js" defer></script> before js/marketplace.js on each page,
      and [id, name] to settings.languages in js/catalogue.js. The language menu then appears
      in the footer. Text without a translation stays in English.
   Keys match data-i18n="..." attributes in the pages. */
window.ZS_LANG = window.ZS_LANG || {};
window.ZS_LANG.template = {
  'nav.cart': 'Cart',
  'nav.deals': 'Today\'s deals',
  'nav.promotions': 'Promotions'
};
