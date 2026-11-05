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
 * Ebenfalls auf `/session` ist die Darstellung standardmäßig dunkel (07-UX §3.3): eine eigene Wahl auf diesem Gerät
 * und ein als „hell“ gespeicherter Standard gehen vor.
 * Das Lesen des Speichers steht in einem eigenen `try`: Ist er gesperrt, klappt die Seitenleiste trotzdem ein.
 */
export const THEME_INIT_SCRIPT = `try{var d=document.documentElement,s=/^\\/session\\/?$/.test(location.pathname),t=null,f=null,c=null;try{t=localStorage.getItem('${STORAGE_KEY}');f=localStorage.getItem('${DEFAULT_KEY}');c=localStorage.getItem('${SIDEBAR_KEY}')}catch(e){}if(t!=='light'&&t!=='dark')t=s&&f!=='light'?'dark':f;if(t==='light'||t==='dark')d.setAttribute('data-theme',t);if(c==='1')d.setAttribute('data-sidebar','collapsed');else if(s){d.setAttribute('data-sidebar','collapsed');d.setAttribute('${SIDEBAR_AUTO_ATTR}','')}}catch(e){}`;
