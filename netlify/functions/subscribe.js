// Netlify Function: nimmt E-Mail + Ergebnis vom Körperschlüssel entgegen
// und legt den Kontakt sicher (Server-Seite, API-Key nie im Frontend sichtbar) bei GetResponse an.


const TORE = require("../../tore.json");
const ZUSATZ = require("../../zusatz.json");
const GR = "https://api.getresponse.com/v3";
const FELDER = { koerperschluessel_tor: "Tor-Name", koerperschluessel_link: "Link", koerperschluessel_pdf: "PDF" };
// GetResponse-Textfelder fassen höchstens 255 Zeichen. Der Zusatztext wird deshalb satzweise auf
// mehrere Felder verteilt (za = Körper mit Einleitung, zb = Gefühle, zc = Stärke) und in der Mail
// mit [[custom_koerperschluessel_zusatz_a1]] [[..._a2]] ... hintereinander eingefügt.
const ZUSATZ_GRUPPEN = { a: 3, b: 2, c: 2 };
for (const [g, n] of Object.entries(ZUSATZ_GRUPPEN)) for (let i = 1; i <= n; i++) FELDER[`koerperschluessel_zusatz_${g}${i}`] = `Zusatz ${g}${i}`;

function teile(text, max = 255) {
  const saetze = text.split(/(?<=[.:!?])\s+/);
  const teile = [];
  let cur = "";
  for (let satz of saetze) {
    while (satz.length > max) {
      const cut = satz.lastIndexOf(" ", max);
      if (cur) { teile.push(cur); cur = ""; }
      teile.push(satz.slice(0, cut));
      satz = satz.slice(cut + 1);
    }
    if ((cur + " " + satz).trim().length <= max) cur = (cur + " " + satz).trim();
    else { teile.push(cur); cur = satz; }
  }
  if (cur) teile.push(cur);
  return teile;
}

function zusatzAbsaetze(kz, gz, sz) {
  const ok = (i, liste) => Number.isInteger(i) && i >= 0 && i < liste.length;
  if (!ok(kz, ZUSATZ.koerper) || !ok(gz, ZUSATZ.gefuehl) || !ok(sz, ZUSATZ.staerke)) return null;
  return [`${ZUSATZ.intro} ${ZUSATZ.koerper[kz]}`, ZUSATZ.gefuehl[gz], ZUSATZ.staerke[sz]];
}

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

  const { email, name, tor, runde, age, kz, gz, sz } = payload;

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

  const absaetze = zusatzAbsaetze(kz, gz, sz);
  if (absaetze) {
    try {
      const ids = await feldIds(headers);
      ["a", "b", "c"].forEach((g, gi) => {
        const stuecke = teile(absaetze[gi]).slice(0, ZUSATZ_GRUPPEN[g]);
        stuecke.forEach((t, i) => {
          const id = ids[`koerperschluessel_zusatz_${g}${i + 1}`];
          if (id) customFieldValues.push({ customFieldId: id, value: [t] });
        });
      });
    } catch (e) {
      console.error("Zusatzfelder nicht verfügbar, Kontakt wird trotzdem angelegt:", e);
    }
  }
  const zusatzAntwort = absaetze ? { intro: ZUSATZ.intro, absaetze: [absaetze[0].slice(ZUSATZ.intro.length + 1), absaetze[1], absaetze[2]] } : null;

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
      return { statusCode: 200, body: JSON.stringify({ success: true, zusatz: zusatzAntwort }) };
    }

    // Kontakt existiert eventuell schon (Code 1008) - das ist kein echter Fehler für uns.
    const errorText = await response.text();
    console.error("GetResponse-Antwort:", response.status, errorText);

    if (response.status === 400 && errorText.includes('"code":1008')) {
      return { statusCode: 200, body: JSON.stringify({ success: true, note: "Kontakt existierte bereits", zusatz: zusatzAntwort }) };
    }

    return { statusCode: 502, body: JSON.stringify({ error: "GetResponse-Fehler", detail: errorText }) };
  } catch (err) {
    console.error("Fehler beim Aufruf der GetResponse-API:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Serverfehler" }) };
  }
};
