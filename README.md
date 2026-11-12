# Gestione Spese

App per tenere traccia delle spese, pensata per essere usata dal telefono e personalizzata in ogni parte.

## Cosa fa

- **Categorie con sottocategorie** a più livelli (es. Casa › Bollette › Luce), con nome, icona e colore a scelta.
- **Conti e metodi di pagamento** definiti da te: contanti, più conti personali, conto in comune (es. Fineco), carte.
- **Movimenti**: importo, data, categoria, conto e nota. Storico con ricerca e filtri per periodo, categoria e conto.
- **Budget** mensili o annuali per categoria o sottocategoria (anche limitati a un solo conto), con soglia di avviso personalizzabile. L'app avvisa quando si raggiunge la soglia e quando si supera il limite: al salvataggio della spesa, nel riepilogo e con un contatore sulla scheda Budget.
- **Resoconti e grafici**: andamento mensile, ripartizione per categoria (con dettaglio delle sottocategorie), per conto e per tipo di conto, su mese, anno o periodo personalizzato.
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
