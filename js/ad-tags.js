/* Zed Supply advertising tags: Meta Pixel, LinkedIn Insight Tag and Google Ads.
   Loaded from the <head> of every page, after the Google Analytics tag.
   None of them loads, sets a cookie or sends anything until the visitor clicks
   Accept on the cookie banner (saved as 'zs-consent' = 'granted'). Decline, or
   not answering yet, keeps them off. js/main.js calls ZSAds.consent() when the
   choice changes, and ZSAds.track() for the same events it sends to GA4.

   SETUP: replace each value ending in _HERE with your own. Anything still ending
   in _HERE is skipped, so nothing loads while these are placeholders. A new
   domain must also be added to the Content Security Policy on all four pages. */
(function () {
  'use strict';

  var META_PIXEL_ID = 'META_PIXEL_ID_HERE';             // Meta Events Manager > Data sources (a 15–16 digit number)
  var LINKEDIN_PARTNER_ID = 'LINKEDIN_PARTNER_ID_HERE'; // LinkedIn Campaign Manager > Analyze > Insight Tag (digits only)
  var GOOGLE_ADS_ID = 'GOOGLE_ADS_ID_HERE';             // Google Ads > Goals > Conversions > Tag setup (looks like AW-123456789)

  // One conversion per action, matching the GA4 events in js/main.js:
  // form_submit (help centre contact form), whatsapp_click and phone_click.
  //   meta:      the Meta standard event sent (Lead or Contact)
  //   linkedin:  the conversion ID of a LinkedIn conversion set to "Event-specific" (digits only)
  //   googleAds: the conversion label after the slash in send_to 'AW-123456789/AbCdEf...'
  var CONVERSIONS = {
    form_submit:    { meta: 'Lead',    linkedin: 'LINKEDIN_LEAD_CONVERSION_ID_HERE',     googleAds: 'GOOGLE_ADS_LEAD_LABEL_HERE' },
    whatsapp_click: { meta: 'Contact', linkedin: 'LINKEDIN_WHATSAPP_CONVERSION_ID_HERE', googleAds: 'GOOGLE_ADS_WHATSAPP_LABEL_HERE' },
    phone_click:    { meta: 'Contact', linkedin: 'LINKEDIN_PHONE_CONVERSION_ID_HERE',    googleAds: 'GOOGLE_ADS_PHONE_LABEL_HERE' }
  };

  function isSet(v) { return !!v && !/_HERE$/.test(v); }
  function accepted() { try { return localStorage.getItem('zs-consent') === 'granted'; } catch (e) { return false; } }
  var on = false, loaded = false;

  function load() {
    on = true;
    if (loaded) {
      // Accepted again after declining on this page: resume what already loaded
      if (window.fbq) window.fbq('consent', 'grant');
      if (isSet(GOOGLE_ADS_ID) && typeof window.gtag === 'function') window.gtag('consent', 'update', { ad_user_data: 'granted', ad_personalization: 'granted' });
      return;
    }
    loaded = true;

    if (isSet(META_PIXEL_ID)) {
      // Meta Pixel base code
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () {
          n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
        n.queue = []; t = b.createElement(e); t.async = !0;
        t.src = v; s = b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t, s);
      }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', META_PIXEL_ID);
      window.fbq('track', 'PageView');
    }

    if (isSet(LINKEDIN_PARTNER_ID)) {
      // LinkedIn Insight Tag
      window._linkedin_partner_id = LINKEDIN_PARTNER_ID;
      window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
      window._linkedin_data_partner_ids.push(LINKEDIN_PARTNER_ID);
      (function (l) {
        if (!l) { window.lintrk = function (a, b) { window.lintrk.q.push([a, b]); }; window.lintrk.q = []; }
        var s = document.getElementsByTagName('script')[0];
        var b = document.createElement('script');
        b.type = 'text/javascript'; b.async = true;
        b.src = 'https://snap.licdn.com/li.lms-analytics/insight.min.js';
        s.parentNode.insertBefore(b, s);
      })(window.lintrk);
    }

    if (isSet(GOOGLE_ADS_ID) && typeof window.gtag === 'function') {
      // Google Ads shares the Google tag already loaded for GA4 in the <head>
      window.gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
      window.gtag('config', GOOGLE_ADS_ID);
    }
  }

  // Declined on this page after accepting: stop sending. js/main.js deletes the cookies.
  function revoke() {
    on = false;
    if (window.fbq) window.fbq('consent', 'revoke');
    if (typeof window.gtag === 'function') window.gtag('consent', 'update', { ad_user_data: 'denied', ad_personalization: 'denied' });
  }

  function track(name) {
    var c = CONVERSIONS[name];
    if (!on || !c) return;
    if (isSet(META_PIXEL_ID) && window.fbq) window.fbq('track', c.meta, { content_name: name });
    if (isSet(LINKEDIN_PARTNER_ID) && isSet(c.linkedin) && window.lintrk) window.lintrk('track', { conversion_id: Number(c.linkedin) });
    if (isSet(GOOGLE_ADS_ID) && isSet(c.googleAds) && typeof window.gtag === 'function') {
      window.gtag('event', 'conversion', { send_to: GOOGLE_ADS_ID + '/' + c.googleAds });
    }
  }

  window.ZSAds = { consent: function (choice) { if (choice === 'granted') load(); else revoke(); }, track: track };
  if (accepted()) load();
})();
