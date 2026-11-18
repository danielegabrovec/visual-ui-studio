# Visual UI Studio

IDE visuale local-first di **Daniele Gabrovec**.

[Scarica l’installer per Windows x64](https://github.com/danielegabrovec/visual-ui-studio/releases/latest)

## Cosa puoi fare

- Progettare interfacce su Canvas libero o strutturato. Modificare CSS, sorgenti e bundle con un editor integrato.
- Creare o aprire progetti su disco. Lo Studio offre 11 stack di progetto, 26 target di generazione e un terminale integrato.
- Provare automazioni JavaScript e TypeScript, disegnare grafi Blueprint e costruire scene Three.js.
- Progettare schemi, eseguire query e generare interfacce e codice per SQLite, PostgreSQL, MySQL, MariaDB e SQL Server.
- Collegare Ollama, LM Studio o un provider compatibile. È disponibile anche un assistente integrato utilizzabile offline.

La versione desktop gestisce il disco, la toolchain e l’esecuzione SQL. L’anteprima browser è disponibile durante lo sviluppo e conserva i progetti nel browser.

## Sviluppo e build

Serve Node.js 24. Su Windows, per ottenere il pacchetto x64 dal sorgente:

```powershell
npm ci
npx electron --version
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run dist:win
```

`npm run dev` avvia lo sviluppo con aggiornamento live. `npm run start` apre la build già compilata. L’installer viene scritto in `release/`. I test dei database reali richiedono istanze temporanee configurate espressamente. I runtime di tutti gli stack generati richiedono le rispettive dipendenze.

## Licenze e dati

Il sorgente di Visual UI Studio è distribuito con [licenza MIT](LICENSE). I componenti di terzi conservano le proprie licenze. I [relativi avvisi](THIRD-PARTY-NOTICES.txt), le licenze Electron e Chromium e questa [nota sui dati](PRIVACY.md) accompagnano la distribuzione. Per segnalazioni di sicurezza consulta la [procedura](SECURITY.md).
