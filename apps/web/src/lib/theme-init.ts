// Bewusst KEIN 'use client': Das Layout (Server-Komponente) bettet das Skript direkt in die Seite ein.
// Käme die Konstante aus einer Client-Datei, wäre sie für React eine Modulreferenz, die erst nachgeladen werden muss.
// Der `<head>` hängt dann an einem noch ladenden Chunk und die Hydration stolpert sporadisch (React #418).

export const STORAGE_KEY = 'sg-theme';

export const SIDEBAR_KEY = 'sg-sidebar-collapsed';

/**
 * Wird im <head> vor dem ersten Rendern ausgeführt: Theme und eingeklappte Seitenleiste landen als
 * Attribute auf <html>, damit nichts blitzt oder springt. Das Seitenleisten-Aussehen steuert CSS.
 */
export const THEME_INIT_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||t==='dark')d.setAttribute('data-theme',t);if(localStorage.getItem('${SIDEBAR_KEY}')==='1')d.setAttribute('data-sidebar','collapsed')}catch(e){}`;
