// Netlify Function: nimmt E-Mail + Ergebnis vom Körperschlüssel entgegen
// und legt den Kontakt sicher (Server-Seite, API-Key nie im Frontend sichtbar) bei GetResponse an.

const TOR_NAMEN = {
  1: "Tor 1 – Sicherheit & Ankommen",
  2: "Tor 2 – Körpergefühl & Zugehörigkeit",
  3: "Tor 3 – Ich-Kraft & Selbstwert",
  4: "Tor 4 – Liebe & Bindung",
  5: "Tor 5 – Ausdruck & Wahrheit",
  6: "Tor 6 – Klarheit & Erkenntnis",
  7: "Tor 7 – Sinn & Verkörperung",
};

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

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Ungültige E-Mail-Adresse" }) };
  }

  const apiKey = process.env.GETRESPONSE_API_KEY;
  const campaignId = process.env.GETRESPONSE_CAMPAIGN_ID;

  if (!apiKey || !campaignId) {
    console.error("GETRESPONSE_API_KEY oder GETRESPONSE_CAMPAIGN_ID fehlt in den Netlify-Umgebungsvariablen.");
    return { statusCode: 500, body: JSON.stringify({ error: "Server nicht konfiguriert" }) };
  }

  const torLabel = TOR_NAMEN[tor] || "unbekannt";

  const body = {
    email: email,
    campaign: { campaignId: campaignId },
    ...(name ? { name: name } : {}),
    // Optional: Falls du in GetResponse Custom Fields "koerperschluessel_tor" und "koerperschluessel_alter"
    // angelegt hast, kannst du sie hier per customFieldId eintragen. Ohne Custom Fields wird das einfach
    // weggelassen, der Kontakt wird trotzdem angelegt.
  };

  try {
    const response = await fetch("https://api.getresponse.com/v3/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": `api-key ${apiKey}`,
      },
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
