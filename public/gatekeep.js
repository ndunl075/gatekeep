/* gatekeep.js: stable device id for signup forms. No network calls, no tracking. */
(function () {
  var K = "gk_did", id = "";
  function cookie() { var m = document.cookie.match("(?:^|; )" + K + "=([^;]+)"); return m && m[1]; }
  try { id = localStorage.getItem(K) || ""; } catch { }
  id = id || cookie() || "";
  if (!id) id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  try { localStorage.setItem(K, id); } catch { }
  document.cookie = K + "=" + id + ";max-age=31536000;path=/;SameSite=Lax" + (location.protocol === "https:" ? ";Secure" : "");
  function fill() {
    var f = document.querySelectorAll('input[name="gk_device_id"]');
    for (var i = 0; i < f.length; i++) f[i].value = id;
  }
  window.gatekeep = { deviceId: function () { return id; }, fill: fill };
  fill();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill);
  new MutationObserver(fill).observe(document.documentElement, { childList: true, subtree: true });
})();
