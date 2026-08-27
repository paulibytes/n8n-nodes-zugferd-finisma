# n8n-nodes-zugferd-finisma

n8n-Community-Node für elektronische Rechnungen nach **EN 16931** (ZUGFeRD,
Factur-X, XRechnung). Er spricht die öffentliche REST-API von
[finisma.de](https://finisma.de/entwickler).

Zwei Operationen:

| Operation | Was passiert | Voraussetzung |
|---|---|---|
| **Rechnung erzeugen** | visuelle PDF + EN-16931-Daten → fertige ZUGFeRD-PDF (PDF/A-3) | Konto; ohne Abo bis zu 5/Tag mit Wasserzeichen |
| **Rechnung erzeugen, Ausgabeformat "Nur XML"** | EN-16931-Daten → CII-XML, ohne Sichtdokument | aktives Abo |
| **Rechnung prüfen** | E-Rechnung gegen EN 16931 und PDF/A-3 prüfen → Prüfbericht | kostenlos |

## Installation

In n8n unter **Einstellungen → Community-Nodes → Installieren** den Paketnamen
`n8n-nodes-zugferd-finisma` eintragen.

## Zugangsdaten

Der Node kennt zwei Wege. Der Parameter *Authentifizierung* entscheidet.

### API-Key (schnell eingerichtet)

Den Key im finisma-Konto unter „API-Zugang" erstellen (beginnt mit `fnsm_`,
wird nur einmal angezeigt) und als Credential **finisma API** hinterlegen. Die
Basis-URL bleibt auf `https://finisma.de`, sofern keine eigene Instanz
angesprochen wird.

### OAuth2 (Konto verbinden)

Als Credential **finisma OAuth2 API** anlegen, dann auf *Connect my account*
klicken — nach der Zustimmung hält n8n das Token und erneuert es selbst. Der
Grant Type ist auf PKCE festgelegt, weil finisma für jeden Client
`code_challenge_method=S256` verlangt.

Client-ID und -Secret holst du im finisma-Konto unter „Eigene Anwendungen":
Name eintragen, dazu die Redirect URL, die oben im Credential-Dialog als
*OAuth Redirect URL* steht. Sie muss exakt übereinstimmen. Das Secret wird nur
einmal angezeigt.

Wer es per Skript braucht, kann denselben Client auch über die offene
Registrierung anlegen:

```bash
curl -X POST https://finisma.de/api/oauth/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Mein n8n",
    "redirect_uris": ["https://n8n.example.com/rest/oauth2-credential/callback"]
  }'
```

So angelegte Clients gehören keinem Konto und erscheinen deshalb nicht in der
Liste; über das Konto angelegte lassen sich dort auch wieder sperren.

Verbundene Anwendungen stehen im finisma-Konto und lassen sich dort jederzeit
trennen.

## Verwendung

Das PDF muss als **Binärfeld** am Eingangs-Item anliegen (Standardname `data`),
etwa aus einem E-Mail-, Drive- oder HTTP-Request-Node.

Beim Erzeugen kommen die Rechnungsdaten als JSON in den Parameter
*Rechnungsdaten*. Die maßgebliche Struktur steht als Schema `Invoice` in der
[OpenAPI-Spezifikation](https://finisma.de/api/v1/openapi.json); sie wird
direkt aus dem Validierungsschema erzeugt und ist damit immer aktuell.

```json
{
  "invoiceNumber": "2026-001",
  "issueDate": "2026-08-01",
  "dueDate": "2026-08-31",
  "currency": "EUR",
  "seller": {
    "name": "Muster GmbH",
    "vatId": "DE123456789",
    "address": { "line1": "Hauptstr. 1", "city": "Hamburg", "postalCode": "20095", "countryCode": "DE" }
  },
  "buyer": {
    "name": "Kunde AG",
    "address": { "line1": "Marktplatz 5", "city": "Berlin", "postalCode": "10115", "countryCode": "DE" }
  },
  "lines": [
    { "name": "Beratung", "quantity": 10, "unitCode": "HUR", "unitPriceNet": 100, "vatRatePercent": 19, "lineNetAmount": 1000,
      "sellerArticleId": "JH-1", "buyerArticleId": "4440", "globalArticleId": "4012345678901" }
  ],
  "vatBreakdown": [
    { "ratePercent": 19, "basisAmount": 1000, "taxAmount": 190, "categoryCode": "S" }
  ],
  "totalNet": 1000,
  "totalVat": 190,
  "totalGross": 1190,
  "payment": {
    "terms": "Zahlbar innerhalb 30 Tagen ohne Abzug",
    "discountPercent": 2.25,
    "discountDays": 14
  },
  "notes": ["Eigentumsvorbehalt bis zur vollständigen Bezahlung."]
}
```

Mengeneinheiten werden automatisch auf UN/ECE-Rec-20-Codes normalisiert, aus
`Std.` wird also `HUR`. Skonto landet als KoSIT-Konvention in den
Zahlungsbedingungen (BT-20).

Die drei Artikelkennungen sind optional: `sellerArticleId` ist die eigene
Nummer (BT-155), `buyerArticleId` die des Kunden (BT-156) und
`globalArticleId` eine normierte Kennung (BT-157), üblicherweise eine GTIN.
Eine EAN-13 ist eine GTIN-13 und gehört ebenfalls dorthin. Wer einen anderen
Nummernkreis nutzt, setzt zusätzlich `globalArticleScheme` auf den passenden
ISO-6523-Code; ohne Angabe gilt `0160` (GS1 GTIN). Damit lassen sich
Artikelnummern strukturiert übergeben, statt sie in den Positionstext zu
schreiben, wo der Empfänger sie nicht auswerten kann.

Die erzeugte Rechnung liegt danach als Binärfeld am Ausgangs-Item und kann
direkt versendet oder abgelegt werden.

## Anhänge

Stundennachweise, Leistungsscheine und Ähnliches werden in die Rechnung
eingebettet, nicht daneben verschickt. Dazu müssen sie als weitere Binärfelder
am Eingangs-Item anliegen; deren Namen kommen komma-getrennt in den Parameter
*Anhang-Felder (Binary)*, etwa `stundennachweis,leistungsschein`.

Erlaubt sind PDF, PNG, JPEG, CSV, XLSX, ODS und XML, je bis 10 MB. Den MIME-Typ
nimmt der Node aus dem Binärfeld, den Dateinamen ebenfalls.

In *Anhang-Beschreibungen* kommt je Anhang ein Text, in derselben Reihenfolge
wie die Feldnamen, etwa `Stundennachweis März 2026`. Das füllt BT-123, die
Beschreibung der rechnungsbegründenden Unterlage. Ohne Angabe steht dort der
Dateiname, und der Empfänger sieht nicht, wozu die Datei gehört. Der Anhang
selbst wird als Dokumentenart 916 im XML deklariert, „rechnungsbegründende
Unterlage", und liegt zugleich als eingebettete Datei in der PDF/A-3.

Was die Rechnung ist und was Anhang, entscheidet allein die Benennung der
Felder. Das unter *PDF-Feld* genannte Feld wird aus der Anhang-Liste immer
herausgefiltert, die Rechnung kann also nicht als Anhang in sich selbst landen,
auch wenn die Liste aus `$binary` erzeugt wurde und den Namen mitbringt.
Doppelte Einträge werden zusammengefasst. Ein genanntes Feld, das am Item nicht
existiert, bricht dagegen ab: das ist ein Tippfehler und soll auffallen.

Anhänge gehören **nicht** in die Rechnungsdaten. Das EN-16931-Schema kennt kein
`attachments`-Feld, ein Eintrag dort wird beim Prüfen stillschweigend verworfen,
ohne Fehlermeldung.

## Ausgabeformat

Die Operation *Rechnung erzeugen* kennt zwei Ausgabeformate:

**ZUGFeRD-PDF** (Standard): Die Quell-PDF im PDF-Feld wird zum Sichtdokument,
das CII-XML wird eingebettet, das Ergebnis ist eine PDF/A-3.

**Nur XML**: Es entsteht ausschliesslich die CII-XML, ohne Sichtdokument. Das
PDF-Feld entfaellt dabei komplett, der Node schickt nur die Rechnungsdaten.
Sinnvoll fuer Behoerdenportale und die Weiterverarbeitung in anderen Systemen,
und deutlich schneller, weil der Einbettungsschritt wegfaellt. Das Ergebnis
liegt als Binaerdatei mit `application/xml` im gewaehlten Ausgabefeld,
`json.format` nennt das verwendete Format.

Der XML-Weg setzt ein aktives finisma-Abo voraus. Das kostenlose
Tageskontingent arbeitet mit einem Wasserzeichen im Sichtdokument, und eine
XML kann keines tragen.

## Fehler

Die API antwortet mit `400` bei ungültigen Daten (mit Feldpfad in `details`),
`401` bei fehlendem oder ungültigem Credential, `403` bei fehlendem OAuth-Scope
und `429` beim Rate-Limit (30 Prüfungen und 20 Erzeugungen pro Minute) oder
wenn das kostenlose Tageskontingent aufgebraucht ist (`free_quota_exhausted`,
Retry-After zeigt auf Mitternacht). Ohne Abo erzeugt finisma bis zu 5
Rechnungen pro Tag, die PDF trägt dann das finisma-Prüfsiegel als
Wasserzeichen und die Antwort das Feld `watermarked: true`; mit Abo entfallen
Limit und Siegel. Mit
*Continue On Fail* landet die Meldung im `error`-Feld des Items statt den
Workflow abzubrechen.

## Lokal entwickeln

```bash
pnpm install          # oder: npm install --ignore-scripts
pnpm build
pnpm pack             # oder: npm pack
```

Nicht mischen: läuft `pnpm install` und danach `npm install` im selben
Arbeitsverzeichnis, versucht npm pnpms internes `node_modules/.pnpm/` als
normalen Abhängigkeitsbaum zu lesen und bricht mit
`Cannot read properties of null (reading 'matches')` ab. Vor einem Wechsel des
Paketmanagers also `rm -rf node_modules`.

Warum das `--ignore-scripts` bei npm: `n8n-workflow` bringt über
`@n8n/expression-runtime` das native Modul `isolated-vm` mit, dessen Build auf
vielen Rechnern scheitert (`gyp ERR! make failed`). Gebraucht wird
`n8n-workflow` hier nur für die Typen, zur Laufzeit stellt n8n es selbst
bereit, das Binary läuft also nie. Bei pnpm steht die Ausnahme fest in der
`package.json` (`pnpm.neverBuiltDependencies`), da genügt `pnpm install`.

Den **Inhalt** des Archivs direkt in das Verzeichnis `custom` der n8n-Daten
entpacken, sodass dort `package.json` liegt und kein Unterordner:

```bash
docker exec <container> sh -c 'mkdir -p /home/node/.n8n/custom'
docker cp n8n-nodes-zugferd-finisma-*.tgz <container>:/tmp/node.tgz
docker exec <container> sh -c 'cd /home/node/.n8n/custom && tar xzf /tmp/node.tgz --strip-components=1'
docker restart <container>
```

Danach erscheint der Node als „ZUGFeRD / E-Rechnung (finisma)" in der Palette,
registriert als `CUSTOM.zugferdFinisma`. Nicht unter Einstellungen →
Community-Nodes: die Liste zeigt nur über npm installierte Pakete.

Zwei Fallen. Kein `npm install` in dem Verzeichnis: npm zieht die
Peer-Dependency `n8n-workflow` als echte Abhängigkeit mit, das sind rund 90
Pakete und 57 MB samt `isolated-vm`, dessen nativer Build nicht durchläuft. Zur
Laufzeit stellt n8n `n8n-workflow` selbst bereit, entpackt genügen 100 KB. Und
`--strip-components=1` nicht vergessen, sonst landet alles unter `package/` und
n8n findet die `package.json` nicht.

Ob n8n den Node geladen hat, verrät nicht das Log (für Custom-Nodes schreibt es
keine Zeile), sondern in der angemeldeten Instanz:

```javascript
fetch('/types/nodes.json').then(r => r.json())
  .then(d => console.log(d.filter(n => /zugferd/i.test(n.name || ''))))
```

## Lizenz

MIT

## Mitarbeit

Quellcode: https://github.com/paulibytes/n8n-nodes-zugferd-finisma
Fehler und Wünsche: https://github.com/paulibytes/n8n-nodes-zugferd-finisma/issues

Der Node ist ein Client der finisma-REST-API. Fragen zur API selbst, zu
Rechnungsdaten oder zur Validierung gehören nach
https://finisma.de/entwickler bzw. an erechnung@paulibytes.de.
