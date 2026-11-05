// Bewusst KEIN 'use client': Das Layout (Server-Komponente) bettet das Skript direkt in die Seite ein.
// Käme die Konstante aus einer Client-Datei, wäre sie für React eine Modulreferenz, die erst nachgeladen werden muss.
// Der `<head>` hängt dann an einem noch ladenden Chunk und die Hydration stolpert sporadisch (React #418).

export const STORAGE_KEY = 'sg-theme';

/** Zuletzt bekannte Standard-Darstellung (`light` | `dark`), damit der erste Paint ohne den Core stimmt */
export const DEFAULT_KEY = 'sg-theme-default';

export const SIDEBAR_KEY = 'sg-sidebar-collapsed';

/** Attribut auf <html>: Die Seitenleiste ist nur wegen des Live-Dashboards eingeklappt (nicht vom Nutzer) */
export const SIDEBAR_AUTO_ATTR = 'data-sidebar-auto';

/**
 * Wird im <head> vor dem ersten Rendern ausgeführt: Theme und eingeklappte Seitenleiste landen als
 * Attribute auf <html>, damit nichts blitzt oder springt. Das Seitenleisten-Aussehen steuert CSS.
 * Auf `/session` (Live-Dashboard) ist die Seitenleiste eingeklappt, damit die Folie genug Platz hat; das merkt sich
 * `data-sidebar-auto`, damit die Shell den alten Zustand beim Verlassen wiederherstellt. Gespeichert wird nichts.
 */
export const THEME_INIT_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem('${STORAGE_KEY}');if(t!=='light'&&t!=='dark')t=localStorage.getItem('${DEFAULT_KEY}');if(t==='light'||t==='dark')d.setAttribute('data-theme',t);if(localStorage.getItem('${SIDEBAR_KEY}')==='1')d.setAttribute('data-sidebar','collapsed');else if(/^\\/session\\/?$/.test(location.pathname)){d.setAttribute('data-sidebar','collapsed');d.setAttribute('${SIDEBAR_AUTO_ATTR}','')}}catch(e){}`;
