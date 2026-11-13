export const googleTagSource = "https://www.googletagmanager.com/gtm.js?id=GTM-NQCKWLZB";

// Consent is queued before the asynchronous container can run. Advertising
// storage stays disabled because JURO's preferences only opt into analytics.
export const googleTagBootstrap = `
window.dataLayer = window.dataLayer || [];
window.gtag = function gtag(){window.dataLayer.push(arguments);};
(function(){
  function analyticsConsent(choice){
    return choice === 'analytics' && navigator.doNotTrack !== '1' ? 'granted' : 'denied';
  }
  function savedConsent(){
    try{return localStorage.getItem('juro-cookie-consent');}catch{return 'necessary';}
  }
  window.gtag('consent', 'default', {
    analytics_storage: analyticsConsent(savedConsent()),
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied'
  });
  window.gtag('js', new Date());
  function update(event){
    window.gtag('consent', 'update', {
      analytics_storage: analyticsConsent(event.detail || savedConsent())
    });
  }
  window.addEventListener('juro-cookie-consent-changed', update);
  window.addEventListener('juro-consent-changed', update);
  window.addEventListener('storage', function(event){
    if(event.key === null || event.key === 'juro-cookie-consent') update(event);
  });
})();`;

export const googleTagCsp = {
  script: "https://www.googletagmanager.com https://www.googleadservices.com https://www.google.com",
  image: "https://*.google-analytics.com https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://www.google.com",
  connect: "https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://www.google.com https://ad.doubleclick.net",
  frame: "https://www.googletagmanager.com",
};
