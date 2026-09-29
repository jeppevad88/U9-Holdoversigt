# Opsætning af U9 iCal Edge Function

Dette projekt bruger en Supabase Edge Function til at hente de fem DanskHåndbold iCal-kalendere server-side.

## 1. Åbn det nye U9 Supabase-projekt

I Supabase vælger du projektet med Project URL:
https://cnbhybdyftviykzsrkzl.supabase.co

## 2. Opret funktionen

Gå til **Edge Functions** i venstre menu.

Vælg **Deploy a new function** → **Via Editor**.

Vælg en tom funktion, hvis Supabase tilbyder det. Giv den navnet:

`u9-ical-sync`

## 3. Indsæt koden

Åbn filen:

`supabase/functions/u9-ical-sync/index.ts`

fra dette GitHub-projekt/ZIP og kopier hele indholdet ind i Edge Function-editoren.

Funktionen skal starte med `const corsHeaders = ...` og slutte med `Deno.serve(...)`.

## 4. Public adgang til funktionen

Filen `supabase/config.toml` i projektet indeholder:

`[functions.u9-ical-sync]`
`verify_jwt = false`

Når funktionen oprettes direkte via Dashboard-editoren, skal den publiceres uden login/JWT-krav, så den kan kaldes fra GitHub Pages.

## 5. Deploy

Klik **Deploy function**.

Supabase oplyser, at deployment normalt tager ca. 10-30 sekunder.

Funktionen får denne URL:

`https://cnbhybdyftviykzsrkzl.supabase.co/functions/v1/u9-ical-sync`

## 6. Test funktionen

På funktionens side vælger du **Test**.

Brug:
- Method: `GET`

Der behøver ikke være en request body.

Et vellykket svar er JSON med felterne:
- `ok`
- `fetchedAt`
- `feeds`
- `matches`

`matches` skal indeholde kampene fra DanskHåndbold.

## 7. Test hjemmesiden

Upload U9-filerne til GitHub Pages.

Åbn siden og lav en hård genindlæsning med **Ctrl + F5**.

Øverst skal der stå, at fælles data gemmes automatisk.

Kampprogrammet skal derefter komme fra Edge Functionen.

## Vigtigt

`config.js` indeholder en **publishable key**. Den må gerne bruges i browseren, når RLS er korrekt sat op. Del aldrig en Supabase **secret/service_role key** i GitHub eller browserkode.
