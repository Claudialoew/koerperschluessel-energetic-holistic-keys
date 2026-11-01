// Netlify Function: nimmt E-Mail + Ergebnis vom Körperschlüssel entgegen
// und legt den Kontakt sicher (Server-Seite, API-Key nie im Frontend sichtbar) bei GetResponse an.


const TORE = require("../../tore.json");
const GR = "https://api.getresponse.com/v3";
const FELDER = { koerperschluessel_tor: "Tor-Name", koerperschluessel_link: "Link", koerperschluessel_pdf: "PDF" };

function schoen(t) {
  return t.toLowerCase().replace(/(^|[\s&,-]+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

async function feldIds(headers) {
  const ids = {};
  const r = await fetch(`${GR}/custom-fields?perPage=100`, { headers });
  const liste = r.ok ? await r.json() : [];
  for (const f of liste) if (FELDER[f.name]) ids[f.name] = f.customFieldId;
  for (const name of Object.keys(FELDER)) {
    if (ids[name]) continue;
    const c = await fetch(`${GR}/custom-fields`, {
      method: "POST", headers,
      body: JSON.stringify({ name, type: "text", valueType: "string", hidden: "false", values: [] }),
    });
    if (c.ok) ids[name] = (await c.json()).customFieldId;
    else console.error("Feld konnte nicht angelegt werden:", name, c.status, await c.text());
  }
  return ids;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "Ungültige Anfrage" };
  }

  const { email, name, tor, runde, age } = payload;

  if (!name || typeof name !== "string" || !name.trim() || name.length > 80) {
    return { statusCode: 400, body: JSON.stringify({ error: "Name fehlt" }) };
  }

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Ungültige E-Mail-Adresse" }) };
  }

  const apiKey = process.env.GETRESPONSE_API_KEY;
  const campaignId = process.env.GETRESPONSE_CAMPAIGN_ID;

  if (!apiKey || !campaignId) {
    console.error("GETRESPONSE_API_KEY oder GETRESPONSE_CAMPAIGN_ID fehlt in den Netlify-Umgebungsvariablen.");
    return { statusCode: 500, body: JSON.stringify({ error: "Server nicht konfiguriert" }) };
  }

  
  const headers = { "Content-Type": "application/json", "X-Auth-Token": `api-key ${apiKey}` };
  const torNr = Number.isInteger(tor) && tor >= 1 && tor <= 14 ? tor : null;
  const customFieldValues = [];
  if (torNr) {
    try {
      const ids = await feldIds(headers);
      const eintrag = TORE.find((t) => t.number === torNr);
      const base = (process.env.URL || "").replace(/\/$/, "");
      const werte = {
        koerperschluessel_tor: `Tor ${torNr} · ${schoen(eintrag ? eintrag.title : "")}`,
        koerperschluessel_link: `${base}/tor-${String(torNr).padStart(2, "0")}.html`,
        koerperschluessel_pdf: `${base}/downloads/tor-${String(torNr).padStart(2, "0")}.pdf`,
      };
      for (const [n, v] of Object.entries(werte)) if (ids[n]) customFieldValues.push({ customFieldId: ids[n], value: [v] });
    } catch (e) {
      console.error("Felder nicht verfügbar, Kontakt wird trotzdem angelegt:", e);
    }
  }

  const body = {
    ...(customFieldValues.length ? { customFieldValues } : {}),
    email: email,
    campaign: { campaignId: campaignId },
    name: name.trim(),
    // Autoresponder-Tag 0: ohne diesen Wert starten die Autoresponder bei API-Kontakten nicht.
    dayOfCycle: 0,
    // Optional: Falls du in GetResponse Custom Fields "koerperschluessel_tor" und "koerperschluessel_alter"
    // angelegt hast, kannst du sie hier per customFieldId eintragen. Ohne Custom Fields wird das einfach
    // weggelassen, der Kontakt wird trotzdem angelegt.
  };

  try {
    const response = await fetch("https://api.getresponse.com/v3/contacts", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // GetResponse gibt bei Erfolg 202 Accepted zurück, kein JSON-Body.
    if (response.status === 202 || response.status === 201) {
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    // Kontakt existiert eventuell schon (Code 1008) - das ist kein echter Fehler für uns.
    const errorText = await response.text();
    console.error("GetResponse-Antwort:", response.status, errorText);

    if (response.status === 400 && errorText.includes('"code":1008')) {
      return { statusCode: 200, body: JSON.stringify({ success: true, note: "Kontakt existierte bereits" }) };
    }

    return { statusCode: 502, body: JSON.stringify({ error: "GetResponse-Fehler", detail: errorText }) };
  } catch (err) {
    console.error("Fehler beim Aufruf der GetResponse-API:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Serverfehler" }) };
  }
};
