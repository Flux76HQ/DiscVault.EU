# App Store Connect — "App Privacy" invulgids (DiscVault iOS)

Deze gids helpt je de **App Privacy**-sectie in App Store Connect
(App Store Connect → jouw app → **App Privacy**) correct in te vullen voor de
DiscVault-app. De antwoorden zijn gebaseerd op wat de app daadwerkelijk doet in
de code (`DiscVaultApp`-repo), niet op aannames.

> **Let op:** dit is invulmateriaal/richtlijn, geen formeel juridisch advies. Je
> vult de labels zelf in App Store Connect in. Werk dit bij zodra het
> datagedrag van de app verandert (bijv. als er ooit analytics wordt toegevoegd).

---

## 0. Kernvraag: "Do you or your third-party partners collect data from this app?"

**Antwoord: Yes — Data is collected.**

Waarom niet "No"? Apple rekent iets als *collected* zodra het het toestel
verlaat op een manier die jij (of je partners) kunt inzien. De app zelf
verzamelt niets voor lokaal gebruik, **maar** roept één online dienst aan die
door jou (DiscVault — VaultStack) wordt beheerd: **MovieVault**
(`movies2.vaultstack.eu`). Daar wordt bij een barcode-scan of titelzoekopdracht
data naartoe gestuurd. Vanaf de build met de anonieme installatietelling meldt de
app daarnaast één keer per dag aan `api.discvault.eu` dat ze in gebruik is (zie
1c). Daardoor moet je "Yes" kiezen en de betreffende datatypes declareren.

**Belangrijk onderscheid — wat je NIET hoeft te declareren:**

- **Lokale opslag op het toestel** (je collectie, watchlist, kijkgeschiedenis in
  SwiftData; instellingen; Keychain-items). Verlaat het toestel niet richting
  jou → geen "collection".
- **Sync naar de eigen self-hosted DiscVault-server van de gebruiker.** Die data
  gaat naar een server die de gebruiker zelf beheert; jij (de ontwikkelaar)
  ontvangt of benadert die niet → geen developer-"collection". (Neem dit wel op
  in het privacybeleid, wat al gebeurd is, maar niet in het privacy-label.)

> **Metadatabijdrage — huidige status (belangrijk voor het label).** MovieVault
> wordt óók gebruikt om de gedeelde catalogus te verrijken: als je metadata
> corrigeert of handmatig aanmaakt, gaat die terug naar MovieVault. **In de
> huidige iOS-app gebeurt dit echter niet vanuit de app zelf** — de app doet
> richting MovieVault alleen `GET` (search, barcode, movie/person detail). De
> terugkoppeling wordt nu verzorgd door de **DiscVault-server**. Voor het
> App-Privacy-label van de *huidige* app-versie verandert er daardoor niets: je
> declareert alleen wat de app zelf verstuurt (zie §1). Zie §7 voor wat er
> verandert zodra de app zelf gaat bijdragen.

---

## 1. Datatypes die je WÉL declareert (via MovieVault)

Voeg in App Store Connect onder **"Data Types"** de volgende twee categorieën
toe. Voor beide geldt hetzelfde antwoordpatroon:

- **Linked to the user's identity?** → **No**
  (geen account, geen naam/e-mail; het device-ID is willekeurig gegenereerd en
  niet herleidbaar tot de persoon.)
- **Used for tracking?** → **No**
  (geen koppeling met data van andere bedrijven voor advertenties/measurement;
  geen ad-netwerken of databrokers.)

### 1a. Identifiers → Device ID

- **Wat:** bij het eerste gebruik genereert de app een willekeurige
  `instanceId` (bijv. `ios_<UUID>`) plus een device-publickey/`keyId`, en stuurt
  die (met app-naam, app-versie, platform) naar MovieVault om een token te
  krijgen en misbruik te beperken.
- **Data type:** **Device ID** (onder *Identifiers*).
- **Purposes:** **App Functionality** (device koppelen/authenticeren voor de
  metadata-lookup) en, indien beschikbaar, **Fraud prevention/Security** voor
  rate-limiting.
- **Linked to identity:** No · **Tracking:** No.
- Dit is géén IDFA/advertising identifier.

### 1b. Usage Data → Search History (of "Other Usage Data")

- **Wat:** de barcode die je scant, of de zoektekst die je typt, wordt naar
  MovieVault gestuurd om de juiste titel/omslag/jaar/format terug te geven.
- **Data type:** kies **Search History** (het dichtst passend: "informatie over
  zoekopdrachten die de gebruiker uitvoert"). Als je Search History niet passend
  vindt, gebruik dan **Product Interaction** onder *Usage Data*.
- **Purposes:** **App Functionality** (de lookup/verrijking die de gebruiker zelf
  opvraagt).
- **Linked to identity:** No · **Tracking:** No.

> Waarom niet "User Content"? De zoekterm/barcode is bewust géén persoonlijke
> content; het is een productidentificatie. "Search History"/"Usage Data" dekt
> dit het beste. Kies wat je het meest verdedigbaar vindt en houd het consistent.

---

### 1c. Usage Data → Product Interaction (installatietelling, vanaf de eerste build die meldt)

- **Wat:** hooguit één keer per UTC-dag, wanneer de gebruiker de app opent,
  stuurt de app `POST https://api.discvault.eu/v2/presence` met vijf velden:
  `protocol` (`presence-1`), `platform` (`ios`), de marketingversie, `mode`
  (`standalone` of `coupled`) en het aantal hele dagen sinds de vorige
  geaccepteerde melding van dit toestel. Geen id, geen taal, geen toesteltype,
  niets over de collectie. MovieVault bewaart alleen dagtotalen.
  Besluit en regels: App-Guidance ADR-0020 en
  `projects/discvault/specs/active-installation-count.md` §7.
- **Waarom declareren:** Apple rekent het als *collected*: het verlaat het
  toestel en wij kunnen de totalen langer inzien dan nodig is om het verzoek te
  beantwoorden (760 dagen). De uitzondering voor "optional disclosure" geldt
  niet, want de telling is op iOS **niet optioneel** voor de gebruiker: er is
  geen schakelaar (besluit 2026-11-10).
- **Data type:** **Product Interaction** (onder *Usage Data*: "app launches,
  taps, …" — een melding dat de app vandaag geopend is, is precies een
  app-launch-signaal).
- **Purposes:** alleen **Analytics**. *Niet* App Functionality: de app werkt
  zonder.
- **Linked to the user's identity?** → **No**. Er gaat geen enkele
  identificatie mee, en de dagtotalen zijn niet naar een toestel te herleiden.
- **Used for tracking?** → **No**. Niets wordt gekoppeld aan data van derden.
- **Wanneer:** in dezelfde week als de eerste build die meldt wordt
  gedistribueerd, **TestFlight inbegrepen** (TestFlight-builds melden ook). Niet
  eerder: een label dat iets declareert wat geen build doet, klopt evenmin.
- **Stappen in App Store Connect:** *Apps → DiscVault → App Privacy →
  Data Types → Edit* → vink onder *Usage Data* **Product Interaction** aan →
  *Save* → bij Product Interaction: purpose **Analytics** → *Linked to user:*
  **No** → *Tracking:* **No** → *Save* → bovenaan **Publish**. Het label is
  per app, niet per build: na *Publish* geldt het direct voor de App Store-pagina.

---

## 2. Datatypes die je NIET verzamelt (expliciet uitsluiten)

Deze horen bij "Data Not Collected" — vink ze **niet** aan:

- **Contact Info** — naam, e-mail, adres, telefoonnummer: niet verzameld.
- **Health & Fitness:** niet verzameld.
- **Financial Info** — betaal-/bankgegevens: niet verzameld.
- **Location** (precies of globaal): niet verzameld.
- **Sensitive Info:** niet verzameld.
- **Contacts** (adresboek): niet verzameld.
- **User Content** — foto's/video's, audio, gameplay, klantsupport, overige
  gebruikerscontent: niet verzameld/verstuurd naar jou.
- **Browsing History:** niet verzameld.
- **Identifiers → User ID:** niet verzameld (geen account).
- **Purchases:** niet verzameld.
- **Diagnostics** — crash data, performance, other diagnostics: niet verzameld
  (geen analytics- of crash-SDK). De installatietelling is *Usage Data →
  Product Interaction* (1c), niet Diagnostics.
- **Advertising Data / Ad-identifiers:** niet verzameld (geen ads).

---

## 3. Camera

- De app vraagt **cameratoegang** uitsluitend om een barcode te scannen
  (VisionKit, on-device). De permissietekst staat al in `Info.plist`
  (`NSCameraUsageDescription`).
- Camerabeelden worden **on-device** verwerkt en niet opgeslagen of verstuurd;
  alleen het **gedecodeerde barcodenummer** gaat naar MovieVault (zie 1b).
- Dit hoeft **niet** apart als "collected" datatype: de foto/het beeld verlaat
  het toestel niet. Alleen de barcode-waarde (Usage Data) telt.

---

## 4. Tracking / App Tracking Transparency (ATT)

- De app doet **geen tracking** zoals Apple dat definieert (geen koppeling van
  gebruikers-/apparaatdata met data van andere bedrijven voor gerichte
  advertenties of measurement; geen doorverkoop aan databrokers).
- Daarom is er **geen** `NSUserTrackingUsageDescription` en **geen**
  ATT-prompt nodig, en zet je overal **"Used for tracking? → No"**.

---

## 5. Samenvatting (snelinvul-tabel)

| App Store-vraag | Antwoord |
|---|---|
| Collect data? | **Yes** (via MovieVault) |
| Identifiers → Device ID | Collected · App Functionality (+ Security) · niet gekoppeld · geen tracking |
| Usage Data → Search History | Collected · App Functionality · niet gekoppeld · geen tracking |
| Usage Data → Product Interaction | Collected · **Analytics** · niet gekoppeld · geen tracking (installatietelling, 1c; vanaf de eerste build die meldt) |
| Contact Info / Location / Contacts / Health / Financial / Browsing / User Content / Diagnostics / Purchases / User ID / Ads | **Not Collected** |
| Data van sync naar eigen server | **Niet declareren** (jij ontvangt het niet) |
| Camerabeelden | **Niet declareren** (blijft on-device) |
| Metadatabijdrage (correcties) | Vandaag **niet declareren** — gebeurt server-side, niet vanuit de app (zie §7) |
| Tracking / ATT-prompt | **Nee** |
| Privacy Policy URL | `https://discvault.eu/privacy.html` |

---

## 6. Onderhoud

Werk zowel dit document, het privacy-label als
[`privacy.html`](../privacy.html) bij zodra je:

- een veld aan de installatietelling toevoegt (dat is eerst een nieuw besluit in
  App-Guidance en een nieuwe contractversie in MovieVault), of er een
  schakelaar voor maakt (dan wordt 1c mogelijk "optional to disclose"),
- crash-reporting toevoegt (dan komt **Diagnostics** erbij),
- accounts/inlog in de app toevoegt (dan mogelijk **User ID**/**Contact Info**),
- een nieuwe externe dienst aanroept,
- of advertenties/tracking toevoegt (dan ATT + Tracking = Yes).

---

## 7. Toekomst: directe metadatabijdrage vanuit de app

Zodra de app zelf metadata gaat bijdragen aan MovieVault (in plaats van alleen de
DiscVault-server), verandert het label. Loop dit dan na:

- **Usage Data** — breid het doel/omvang uit: naast opgevraagde zoektermen stuurt
  de app dan ook door de gebruiker ingevoerde/gecorrigeerde titelgegevens.
- **User Content** — overweeg dit datatype aan te zetten (categorie "Other User
  Content"): de bijgedragen metadata is door de gebruiker aangeleverde content
  die wordt opgeslagen en met andere gebruikers gedeeld. Blijft **niet gekoppeld
  aan identiteit** en **geen tracking**, mits alleen de willekeurige toestel-ID
  wordt meegestuurd.
- **Consent/opt-out** — als er een opt-in of opt-out-instelling komt, beschrijf die
  in de app en in [`privacy.html`](../privacy.html); een opt-in versterkt de
  AVG-grondslag (toestemming i.p.v. gerechtvaardigd belang).
- Houd het [privacybeleid](../privacy.html) (§5, subsectie "Contributing metadata
  improvements") en de [voorwaarden](../terms.html) (§4.1, licentieverlening) in
  lijn met het daadwerkelijke gedrag.

