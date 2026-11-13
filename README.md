# Gestione Spese

App per tenere traccia di spese ed entrate, pensata per essere usata dal telefono e personalizzata in ogni parte.

## Cosa fa

- **Categorie con sottocategorie** a più livelli (es. Casa › Bollette › Luce), con nome, icona e colore a scelta.
- **Conti e metodi di pagamento** definiti da te: contanti, più conti personali, conto in comune (es. Fineco), carte.
- **Movimenti**: uscite ed entrate con importo, data, categoria, conto e nota. Storico con ricerca e filtri per periodo, tipo, categoria e conto. Le categorie di entrata (stipendio, rimborsi…) sono separate da quelle di uscita.
- **Movimenti ricorrenti**: affitto, abbonamenti, stipendio e simili vengono registrati da soli alla data prevista (ogni settimana, ogni mese, ogni anno…), compresi gli arretrati se l'app non viene aperta per un po'. Si possono mettere in pausa, modificare o far terminare a una certa data.
- **Importazione dell'estratto conto**: carica il file dei movimenti scaricato dalla banca (CSV o Excel `.xlsx`; riconosce da solo colonne, separatori, date e importi). Prima di importare vedi l'anteprima, i movimenti già presenti vengono riconosciuti e lasciati fuori, e le categorie vengono proposte in base alle tue regole (“se la descrizione contiene…”) e ai movimenti già registrati. Il file viene letto sul dispositivo e non viene inviato da nessuna parte.
- **Budget** mensili o annuali per categoria o sottocategoria (anche limitati a un solo conto), con soglia di avviso personalizzabile. L'app avvisa quando si raggiunge la soglia e quando si supera il limite: al salvataggio della spesa, nel riepilogo e con un contatore sulla scheda Budget.
- **Resoconti e grafici**: entrate, uscite e saldo del periodo; andamento mensile, ripartizione per categoria (con dettaglio delle sottocategorie), per conto e per tipo di conto, su mese, anno o periodo personalizzato.
- **Backup**: esportazione e importazione di tutti i dati (JSON) ed esportazione dei movimenti in CSV per Excel.
- **Installabile e utilizzabile offline** (PWA), con tema chiaro e scuro.

I dati restano solo sul dispositivo, nel browser (`localStorage`): non c'è nessun server. Per passare i dati da un dispositivo a un altro si usa il backup.

## Tecnologia

HTML, CSS e JavaScript senza framework né dipendenze e senza passaggi di compilazione: i file del repository sono l'app.

| File | Contenuto |
| --- | --- |
| `index.html`, `css/style.css` | Struttura e stile |
| `js/logic.js` | Calcoli (categorie, filtri, budget, CSV), senza accesso alla pagina |
| `js/store.js` | Dati predefiniti e salvataggio |
| `js/charts.js` | Grafici in HTML/SVG |
| `js/importer.js` | Lettura degli estratti conto (CSV, Excel), doppioni e categorie suggerite |
| `js/app.js` | Interfaccia |
| `sw.js`, `manifest.webmanifest` | Installazione e uso offline |

## Provarla sul computer

```bash
npm start        # apre un server su http://localhost:8080 (richiede Python 3)
npm test         # test dei calcoli (richiede Node 20 o successivo)
```

## Pubblicarla per usarla dal telefono

1. Su GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, ramo `main`, cartella `/ (root)`.
2. Dopo un paio di minuti l'app è all'indirizzo indicato in quella pagina.
3. Dal telefono, apri l'indirizzo e scegli **Aggiungi a schermata Home** (iPhone: pulsante Condividi; Android: menu del browser).

Nota: GitHub Pages su un repository privato richiede un piano a pagamento; l'indirizzo è comunque pubblico, ma i dati delle spese non vengono mai caricati online.
