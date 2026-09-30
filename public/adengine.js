/* AdEngine · snippet universal. Guarda el identificador de clic del anuncio y lo asocia al email cuando el usuario se registra.
   Uso: <script src="https://TU-ADENGINE/adengine.js" data-endpoint="https://TU-ADENGINE/api/track"></script>
   Y al conocer el email (registro / checkout): window.adengine.identify("correo@ejemplo.com") */
(function () {
  var s = document.currentScript, ep = (s && s.getAttribute("data-endpoint")) || "/api/track";
  var q = new URLSearchParams(location.search), keys = ["gclid", "fbclid", "ttclid"], found = false;
  keys.forEach(function (k) { var v = q.get(k); if (v) { try { localStorage.setItem("ae_" + k, v); } catch (e) {} found = true; } });
  function ids() { var o = {}; keys.forEach(function (k) { try { var v = localStorage.getItem("ae_" + k); if (v) o[k] = v; } catch (e) {} }); return o; }
  function send(email) {
    var body = ids(); if (!Object.keys(body).length) return;
    if (email) body.email = email; body.landing = location.href;
    try { navigator.sendBeacon ? navigator.sendBeacon(ep, new Blob([JSON.stringify(body)], { type: "text/plain" })) : fetch(ep, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }); } catch (e) {}
  }
  if (found) send();
  window.adengine = { identify: send, ids: ids };
})();
