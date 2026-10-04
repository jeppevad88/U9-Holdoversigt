# U9 Holdoversigt – Hjallerup IF

Denne version er bygget som U11-værktøjet, men til Hjallerup IF U9 drenge.

## Hvad er med?
- Runde-faner og automatisk valg af den aktuelle runde ud fra kampdatoer.
- Maks. 7 spillere pr. hold.
- Lånte spillere markeres med grøn skrift og `LÅN`.
- En spiller må godt spille på flere hold i samme runde.
- Afbud med årsag + mulighed for helt at fjerne et afbud.
- Spillerstatistik opdelt efter oprindeligt hold.
- Samlet spillerliste sorteret efter flest kampe.
- Kampprogram med underfaner: Samlet kampprogram, Spillede kampe og ét faneblad pr. hold.
- Kampprogrammet hentes fra DanskHåndbolds iCal-kalendere via Supabase Edge Function.
- Fælles holddata gemmes i `public.u9_state` i Supabase.

## GitHub
Læg alle filerne fra denne mappe i root af dit nye GitHub repository. `index.html` skal ligge direkte i root.

## Supabase database
Kør `supabase.sql` én gang i Supabase SQL Editor. Den opretter kun `u9_state` og de nødvendige RLS-politikker.

## Supabase Edge Function – nødvendig for iCal
Browseren kan ikke læse DanskHåndbolds `text/calendar`-filer direkte fra GitHub Pages pga. CORS. Derfor henter Edge Functionen iCal-filerne server-side.

Funktionen ligger i:
`supabase/functions/u9-ical-sync/index.ts`

Og `supabase/config.toml` indeholder:
`verify_jwt = false`

### Deploy
Deploy funktionen som `u9-ical-sync` i det samme Supabase-projekt, som står i `config.js`.

Når funktionen er live, skal denne adresse svare med JSON:
`https://jgcufgjezxxrbxarucam.supabase.co/functions/v1/u9-ical-sync`

## Bemærkning om spillerunder
Hvis DanskHåndbolds iCal-data indeholder et rundenummer i eventets tekst, bruges det. Ellers grupperes kampe automatisk efter kalenderuge som en stabil fallback. Rundens viste nummer bliver derefter 1, 2, 3 osv. efter den kronologiske rækkefølge.

### Rundevisning
I rundeoversigten vises kun den første kamp for et hold, hvis holdet har flere kampe samme dag. Detaljerede kampe kan stadig ses under Kampprogram. En enkeltstående kalenderkamp, der ellers ville danne en ny runde, lægges sammen med den foregående runde.


## Tidsformat
Hjemmesiden viser kampens dato og klokkeslæt præcis som skrevet i DanskHåndbolds iCal-feed. Der foretages ingen UTC-/tidszonekonvertering. Kalenderens tekst er den eneste kilde til kamptidspunktet.
