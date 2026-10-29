/* ---------- avvio ---------- */
// L'app parte qui, dopo che TUTTI i moduli del bundle sono stati valutati.
// Prima il primo render partiva dalla coda di 90-settings-and-bootstrap.js,
// a bundle ancora a meta': le funzioni dei moduli successivi usate da quel
// render dovevano essere dichiarazioni function (hoisting), un const dava errore.
init();
