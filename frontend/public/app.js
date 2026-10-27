// КаркасCRM — одностраничный интерфейс (без сборки и внешних зависимостей)
const $ = s => document.querySelector(s);
// именно массив: у NodeList нет find/filter/some, а в интерфейсе они нужны
const $$ = s => Array.from(document.querySelectorAll(s));

// SVG Vector Icon Dictionary (~77 icons + eye/eyeOff)
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  pipe: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
  inbox: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  contacts: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  contact: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  companies: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  company: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 10h.01"/>',
  tasks: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  task: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  products: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  product: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
  competitors: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  competitor: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  analytics: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  profile: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  plusCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  delete: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  time: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  email: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  sync: '<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>',
  repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  attach: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  theme: '<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor"/>',
  arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  arrowUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  arrowDown: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronUp: '<polyline points="18 15 12 9 6 15"/>',
  money: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  revenue: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  key: '<path d="M21 2l-2 2m-1.5 1.5L14 9l-2-2-4 4 2 2-4 4-2-2-2 2a4.24 4.24 0 0 0 6 6l11-11a2.12 2.12 0 0 0 0-3l-2-2z"/>',
  lightning: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  automation: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  puzzle: '<path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v4h1.5a2.5 2.5 0 0 1 0 5H2v4a2 2 0 0 0 2 2h4v-1.5a2.5 2.5 0 0 1 5 0V22h4a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/>',
  fields: '<path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v4h1.5a2.5 2.5 0 0 1 0 5H2v4a2 2 0 0 0 2 2h4v-1.5a2.5 2.5 0 0 1 5 0V22h4a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  backup: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
  pipeline: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
  sparkles: '<path d="M12 3l1.91 5.82a2 2 0 0 0 1.27 1.27L21 12l-5.82 1.91a2 2 0 0 0-1.27 1.27L12 21l-1.91-5.82a2 2 0 0 0-1.27-1.27L3 12l5.82-1.91a2 2 0 0 0 1.27-1.27L12 3z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  externalLink: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  whatsapp: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  telegram: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  tags: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  alertCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  chartPie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  history: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  command: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  excel: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13l3 4m0-4l-3 4"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="12" y1="3" x2="12" y2="21"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
};

function icon(name, size = 16, className = '') {
  const p = ICON_PATHS[name] || ICON_PATHS.file || '';
  return `<svg class="ico ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em">${p}</svg>`;
}

// Внутренние коды источников и каналов — только в данных, пользователю показываем русские названия.
// Транспорты Wazzup (wazzup24.ru/help/api/channels): список закрытый, но шире,
// чем «WhatsApp, Telegram, Instagram, Viber» — туда входят Авито, MAX, Циан и ВКонтакте.
const WZ_TRANSPORTS = {
  whatsapp: 'WhatsApp', wapi: 'WhatsApp Business API', whatsgroup: 'Группа WhatsApp',
  tgapi: 'Telegram', telegram: 'Telegram-бот', instagram: 'Instagram', viber: 'Viber',
  avito: 'Авито', max: 'MAX', maxbot: 'MAX-бот', cian: 'Циан', vk: 'ВКонтакте',
  // групповые чаты — это типы чата, а не транспорты, но в списках и бейджах
  // они встречаются так же часто
  telegroup: 'Группа Telegram', maxgroup: 'Группа MAX'
};
// Транспорт канала Wazzup и тип чата — разные списки. Отправляем мы по типу чата,
// поэтому транспорт переводим в него: WhatsApp Business API (wapi) пишет в чат типа
// whatsapp, личный Telegram (tgapi) и Telegram-бот — в telegram, MAX-бот — в max.
// У Циана своего типа чата в API нет — отправлять туда нельзя, и в списке его нет.
const WZ_TRANSPORT_TO_CHAT = {
  whatsapp: 'whatsapp', wapi: 'whatsapp', whatsgroup: 'whatsgroup', tgapi: 'telegram',
  telegram: 'telegram', instagram: 'instagram', viber: 'viber', avito: 'avito',
  max: 'max', maxbot: 'max', vk: 'vk'
};
// Всё, чем Wazzup умеет отправлять. Групповые чаты приходят из вебхуков,
// транспорта с таким именем нет — поэтому добавлены отдельно.
const WZ_CHAT_SET = new Set([...Object.values(WZ_TRANSPORT_TO_CHAT), 'telegroup', 'maxgroup']);
// Состояния канала, при которых сообщения не ходят
// (wazzup24.ru/help/api-ru/rabota-s-kanalami). Неизвестное или отсутствующее
// состояние считаем рабочим: иначе новый статус у вендора спрятал бы все каналы.
const WZ_DEAD_STATES = ['disabled', 'notEnoughMoney', 'blocked', 'unauthorized', 'qridle',
  'openelsewhere', 'foreignphone', 'waitForPassword', 'onModeration', 'rejected', 'phoneUnavailable'];
const wzAlive = c => !WZ_DEAD_STATES.includes(String(c && c.state || ''));
// состояния канала по-русски: [подпись, класс бейджа]
const WZ_STATE_LABELS = {
  active: ['работает', ''], init: ['подключается', 'grey'],
  disabled: ['отключён в кабинете Wazzup', 'grey'], onModeration: ['на модерации', 'grey'],
  phoneUnavailable: ['телефон недоступен', 'orange'], qridle: ['нужно отсканировать QR-код', 'orange'],
  openelsewhere: ['занят другим аккаунтом Wazzup', 'orange'], notEnoughMoney: ['не хватает средств на балансе', 'orange'],
  foreignphone: ['QR отсканирован другим номером', 'orange'], unauthorized: ['нужно подключить заново', 'orange'],
  waitForPassword: ['ждёт код двухфакторной защиты', 'orange'], blocked: ['заблокирован', 'orange'],
  rejected: ['отклонён модерацией', 'orange']
};
const wzState = s => WZ_STATE_LABELS[s] || (s ? [s, 'grey'] : ['состояние не указано', 'grey']);
const SOURCE_LABELS = {
  manual: 'Вручную', import: 'Импорт из CSV', site: 'Сайт', email: 'Почта',
  ...WZ_TRANSPORTS,
  ...Object.fromEntries(Object.entries(WZ_TRANSPORTS).map(([k, v]) => ['wazzup-' + k, v + ' (Wazzup)']))
};
const sourceLabel = s => SOURCE_LABELS[s] || (s ? String(s) : 'Вручную');
const sourceOptions = selected => Object.entries(SOURCE_LABELS).map(([code, name]) =>
  `<option value="${code}" ${code === (selected || 'manual') ? 'selected' : ''}>${name}</option>`).join('');

// Подписи типов чата. Как тип чата telegram покрывает и личный аккаунт, и бота,
// поэтому здесь нейтральное «Telegram»; различие важно в списке подключённых
// каналов — там подпись берётся из транспортов (wzTransportLabel).
const CHANNEL_LABELS = { ...WZ_TRANSPORTS, telegram: 'Telegram', email: 'Почта', any: 'Любой канал' };
const channelLabel = c => CHANNEL_LABELS[c] || c || '';
const wzTransportLabel = t => WZ_TRANSPORTS[String(t || '').trim().toLowerCase()] || channelLabel(t);
// название канала для списков: своё название, если его задали, иначе
// «WhatsApp · 79991112233» — вендор передаёт только номер или юзернейм
const wzTitle = c => (c.label ? String(c.label)
  : [wzTransportLabel(c.transport), c.name || c.phone || c.external_id].filter(Boolean).join(' · '));
// бейджи каналов клиента: «WhatsApp · Telegram» — одна строка для списков
const chan = c => (c || 'whatsapp').split(',').map(x => x.trim()).filter(Boolean).map(x => `<span class="chan ${x}">${esc(channelLabel(x))}</span>`).join(' ');

const ROLE_LABELS = { admin: 'Администратор', manager: 'Менеджер', viewer: 'Наблюдатель' };
const roleLabel = r => ROLE_LABELS[r] || r;

// Браузер хранит кириллический домен в машиночитаемом виде: вместо
// «crm.каркастайги.рф» — «crm.xn--80aaamzedb7cml.xn--p1ai». В адресе вебхука и в
// коде для сайта так и должно остаться, а вот читать и набирать его вручную будет
// человек, поэтому в текстах для людей расшифровываем обратно (RFC 3492).
function punyDecodeLabel(label) {
  if (!/^xn--/i.test(label)) return label;
  const input = label.slice(4);
  const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700;
  const digit = c => (c >= 48 && c <= 57) ? c - 48 + 26 : (c >= 65 && c <= 90) ? c - 65 : (c >= 97 && c <= 122) ? c - 97 : BASE;
  const adapt = (delta, points, first) => {
    delta = first ? Math.floor(delta / DAMP) : delta >> 1;
    delta += Math.floor(delta / points);
    let k = 0;
    while (delta > ((BASE - TMIN) * TMAX) >> 1) { delta = Math.floor(delta / (BASE - TMIN)); k += BASE; }
    return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
  };
  let n = 128, i = 0, bias = 72;
  const out = [];
  const sep = input.lastIndexOf('-');
  let pos = 0;
  if (sep >= 0) { for (let k = 0; k < sep; k++) out.push(input.charCodeAt(k)); pos = sep + 1; }
  while (pos < input.length) {
    const oldi = i; let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= input.length) return label;
      const d = digit(input.charCodeAt(pos++));
      if (d >= BASE) return label;
      i += d * w;
      const t = k <= bias ? TMIN : (k >= bias + TMAX ? TMAX : k - bias);
      if (d < t) break;
      w *= (BASE - t);
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    i %= (out.length + 1);
    out.splice(i, 0, n);
    i++;
  }
  // Если расшифровка дала символы, которых в домене быть не может (управляющие,
  // пробел, невидимые C1), значит строка испорчена — оставляем её как есть.
  // Показать человеку неверный адрес дороже, чем машиночитаемый.
  if (!out.length || out.some(c => c < 0x21 || (c >= 0x7f && c <= 0x9f) || c > 0x10ffff)) return label;
  return String.fromCharCode(...out);
}
// адрес для показа человеку; машинные адреса (вебхук, код формы) не трогаем
function humanOrigin(origin) {
  const m = /^(https?:\/\/)([^/?#\s]+)(.*)$/i.exec(String(origin || '').trim());
  if (!m) return String(origin || '');
  return m[1] + m[2].split('.').map(punyDecodeLabel).join('.') + m[3];
}


function normalizeDue(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const tmrw = new Date(now.getTime() + 86400000);
  const tmrwStr = `${tmrw.getFullYear()}-${pad(tmrw.getMonth() + 1)}-${pad(tmrw.getDate())}`;

  const mSeg = s.match(/^сегодня(?:\s+(\d{1,2}:\d{2}))?$/i);
  if (mSeg) {
    const time = mSeg[1] ? (mSeg[1].length === 4 ? '0' + mSeg[1] : mSeg[1]) : '14:00';
    return `${todayStr} ${time}`;
  }
  const mZav = s.match(/^завтра(?:\s+(\d{1,2}:\d{2}))?$/i);
  if (mZav) {
    const time = mZav[1] ? (mZav[1].length === 4 ? '0' + mZav[1] : mZav[1]) : '10:00';
    return `${tmrwStr} ${time}`;
  }
  const mRu = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}:\d{2}))?$/);
  if (mRu) {
    const time = mRu[4] ? (mRu[4].length === 4 ? '0' + mRu[4] : mRu[4]) : '10:00';
    return `${mRu[3]}-${mRu[2]}-${mRu[1]} ${time}`;
  }
  const mIso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?/);
  if (mIso) {
    return `${mIso[1]} ${mIso[2] || '10:00'}`;
  }
  return s;
}

function taskDueMeta(due, done = false) {
  if (!due) return { label: '—', overdue: false, text: '—' };
  const norm = normalizeDue(due);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const tmrw = new Date(now.getTime() + 86400000);
  const tmrwStr = `${tmrw.getFullYear()}-${pad(tmrw.getMonth() + 1)}-${pad(tmrw.getDate())}`;

  const parts = norm.split(' ');
  const datePart = parts[0] || '';
  const timePart = parts[1] ? parts[1].slice(0, 5) : '';

  let label = '';
  let isOverdue = false;

  if (datePart === todayStr) {
    label = timePart ? `сегодня ${timePart}` : 'сегодня';
    if (!done && timePart) {
      const curTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      if (curTime > timePart) isOverdue = true;
    }
  } else if (datePart === tmrwStr) {
    label = timePart ? `завтра ${timePart}` : 'завтра';
  } else if (datePart < todayStr) {
    const [y, m, d] = datePart.split('-');
    label = `${d}.${m}.${y}${timePart ? ' ' + timePart : ''}`;
    if (!done) isOverdue = true;
  } else {
    const [y, m, d] = datePart.split('-');
    label = `${d}.${m}.${y}${timePart ? ' ' + timePart : ''}`;
  }

  return { label, overdue: isOverdue, text: label, raw: norm };
}

function isAscii(str) {
  if (!str || typeof str !== 'string') return false;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

// Сессия живёт в HttpOnly-cookie: JavaScript её не видит и не может украсть.
// Токен держим только в памяти вкладки (на случай, если cookie отключены),
// а значение из старых версий localStorage при старте вычищаем.
try { localStorage.removeItem('karkas_token'); } catch {}

// ── тема: светлая / тёмная / как в системе ────────────────────────────────
function currentThemeMode() {
  try { return localStorage.getItem('karkas_theme') || 'auto'; } catch { return 'auto'; }
}
function resolvedTheme(mode) {
  if (mode === 'dark' || mode === 'light') return mode;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
// Без поддержки backdrop-filter шапка иначе просвечивала бы контентом.
try { if (!(window.CSS && CSS.supports && CSS.supports('backdrop-filter', 'blur(4px)'))) document.documentElement.classList.add('no-backdrop'); } catch {}

function applyTheme(mode = currentThemeMode()) {
  const res = resolvedTheme(mode);
  document.documentElement.dataset.theme = res;
  try {
    if (mode === 'auto') localStorage.removeItem('karkas_theme');
    else localStorage.setItem('karkas_theme', mode);
  } catch {}
  const btn = $('#themeBtn');
  if (btn) {
    btn.innerHTML = icon(res === 'dark' ? 'moon' : 'sun', 16);
    btn.title = `Тема: ${res === 'dark' ? 'тёмная' : 'светлая'} (режим: ${mode})`;
  }
}
function toggleTheme() {
  const cur = currentThemeMode();
  const next = cur === 'auto' ? (resolvedTheme('auto') === 'dark' ? 'light' : 'dark') : (cur === 'light' ? 'dark' : 'auto');
  applyTheme(next);
  toast({ light: 'Светлая тема', dark: 'Тёмная тема', auto: 'Как в системе' }[next]);
}
if (window.matchMedia) {
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentThemeMode() === 'auto') applyTheme('auto');
    });
  } catch {}
}
applyTheme();

let token = '';
const state = {
  view: 'dashboard', settingsTab: 'integrations', pipeline: 1, conv: null, listOnly: false,
  deals: [], stages: [], pipelines: [], contacts: [], companies: [], channels: [],
  cache: {}, dealTab: 'details', meta: null, dupes: null, me: null, users: [],
  taskScope: 'mine', taskFilter: '', dealScope: 'all', taskView: 'list', taskSelectMode: false, sel: {}
};

const CUR = () => (state.meta && state.meta.company && state.meta.company.currency) || '₽';
const fmt = n => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ' + CUR();
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Отметки времени база хранит в UTC (datetime('now')) — показываем в местном поясе.
// Сроки задач (due) и дедлайны — уже местное настенное время, для них dueText.
const dtFmt = d => d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dt = s => {
  if (!s) return '';
  const raw = String(s).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}Z`) : (/Z|[+-]\d{2}:?\d{2}$/.test(raw) ? new Date(raw) : null);
  if (d && !isNaN(d)) return dtFmt(d);
  // Дата без времени (например «2023-08-01» из картотеки судов) — тоже дд.мм.гггг:
  // часы и минуты здесь смысла не имеют, а формат во всём интерфейсе один.
  const dOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dOnly) return `${dOnly[3]}.${dOnly[2]}.${dOnly[1]}`;
  return raw.replace('T', ' ').slice(0, 16);
};
// Даты в привычном формате СНГ: 31.12.2026 (а не 2026-12-31).
// В ISO оставляем только значения для полей ввода <input type="date">.
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
function monthText(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return ym || '';
  const name = MONTHS_NOM[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : ym;
}
// Месяц коротко: «2026-10» → «10.2026» (привычно для СНГ, в отличие от ISO).
function monthShort(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}.${m[1]}` : (ym || '');
}
// «2026-10-20», «2026-10-20 09:30», «2026-10-20T09:30» → «20.10.2026[ 09:30]»
function dateText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return raw;
  return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ' ' + m[4] + ':' + m[5] : ''}`;
}
const dueText = s => dateText(s);
// Локальная дата YYYY-MM-DD. toISOString() здесь нельзя: в Москве он отдаёт
// вчерашний день до 03:00, из-за чего «сегодня» и неделя съезжали на сутки.
const isoDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => isoDate();
// Локальный месяц YYYY-MM — по той же причине: toISOString() в Москве отдаёт
// прошлый месяц до 03:00, и заголовок плана продаж показывал не тот месяц.
const isoMonth = (d = new Date()) => isoDate(d).slice(0, 7);
function fmtDayMonth(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const t = new Date(); const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
  if (isoDate(d) === isoDate(t)) return 'сегодня';
  if (isoDate(d) === isoDate(tomorrow)) return 'завтра';
  return `${m[3]}.${m[2]}.${m[1]}`;
}
// Внешние ссылки: только http(s). «site.ru» превращаем в https://site.ru,
// а javascript:/data: отбрасываем — иначе получится XSS через поле «Сайт».
function siteHref(u) {
  const v = String(u || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v)) return 'https://' + v;
  return '';
}
const num = v => (String(v ?? '').replace(/[^\d.-]/g, '') || 0) * 1;
// Русское склонение после числа: 1 задача / 2 задачи / 5 задач.
// last2 — чтобы 11–14 не превращались в «задачи» по ошибке.
function plural(n, one, few, many) {
  const x = Math.abs(Math.round(Number(n) || 0));
  const last2 = x % 100, last = x % 10;
  if (last2 >= 11 && last2 <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

async function api(path, opt = {}) {
  let r;
  try {
    r = await fetch(path, {
      ...opt,
      signal: opt.signal || AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(opt.headers || {})
      }
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error('Сервер не ответил вовремя — возможно, внешние источники работают медленно. Повторите попытку чуть позже.');
    throw new Error('Нет связи с сервером. Проверьте подключение к интернету и обновите страницу.');
  }
  if (r.status === 401) {
    // сессия истекла в любом виде (токен или cookie) — возвращаем на экран входа
    const d = await r.json().catch(() => ({}));
    const err = new Error(d.error || 'Нужно войти в систему.');
    err.unauthorized = true;
    if (!opt.noSessionEnd && path !== '/api/auth/login') endSession('Сеанс завершён. Войдите, пожалуйста, заново.');
    throw err;
  }
  if (String(opt.raw ? 0 : 1) && !(r.headers.get('content-type') || '').includes('json')) return r;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(d.error || (`Не удалось выполнить запрос (код ${r.status}). Обратитесь к администратору, если проблема повторяется.`));
    err.status = r.status; err.data = d;
    throw err;
  }
  return d;
}

const download = async (path, name) => {
  let r;
  try { r = await fetch(path, { headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}) } }); }
  catch { toast('Нет связи с сервером — файл не скачался. Проверьте интернет и попробуйте снова.', 'err'); return false; }
  if (!r.ok) {
    let msg = 'Не удалось скачать файл (код ' + r.status + ')';
    try { msg = (await r.json()).error || msg; } catch { }
    toast(msg, 'err');
    return false;
  }
  const b = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return false;
};

// Всплывающие уведомления. Простой toast — короткая новость «сохранено/ошибка».
// notify — важное событие с заголовком и действием («Открыть чат», «Открыть задачу»):
// так сотрудник не пропустит сообщение клиента и сможет перейти в один клик.
// Технические сообщения браузера («...is not a function», «Cannot read properties…»)
// человеку ни о чём не говорят: превращаем их в понятный текст, а подробности — в консоль.
const TECH_ERROR = /is not a function|cannot read propert|is not defined|undefined is not|null is not an object|illegal invocation|failed to construct|is not iterable|invalid state/i;
function humanError(msg) {
  const text = String(msg || '').trim();
  if (!text || !TECH_ERROR.test(text)) return text;
  console.error('Техническая ошибка интерфейса:', text);
  return 'Действие не выполнено из-за сбоя в интерфейсе. Обновите страницу (F5) — введённые данные сохранятся. (' + text.slice(0, 60) + ')';
}
function toast(t, kind = 'ok') {
  pushToast({ text: kind === 'err' ? humanError(t) : String(t || ''), kind: kind === 'err' ? 'error' : 'ok', timeout: kind === 'err' ? 5200 : 2600 });
}
function notify({ title, text = '', kind = 'message', actionLabel = '', onAction = null, timeout = 7000 }) {
  pushToast({ title, text, kind, actionLabel, onAction, timeout });
}
function pushToast({ title = '', text = '', kind = 'ok', actionLabel = '', onAction = null, timeout = 4000 }) {
  const box = $('#toast');
  if (!box) return;
  const icons = { ok: 'checkCircle', error: 'alertCircle', message: 'inbox', task: 'tasks', info: 'bell' };
  const el = document.createElement('div');
  el.className = `toast-item ${kind}${onAction ? ' clickable' : ''}`;
  el.innerHTML = `<span class="toast-ico">${icon(icons[kind] || 'bell', 16)}</span>
    <div class="toast-text">${title ? `<b>${esc(title)}</b>` : ''}<span>${esc(text)}</span>${actionLabel ? `<span style="opacity:.75;margin-top:2px">${esc(actionLabel)} →</span>` : ''}</div>
    <button type="button" class="toast-x" aria-label="Закрыть уведомление">×</button>`;
  const close = () => { clearTimeout(el._t); el.remove(); };
  el.querySelector('.toast-x').onclick = e => { e.stopPropagation(); close(); };
  if (onAction) el.onclick = () => { close(); try { onAction(); } catch (err) { console.error(err); } };
  box.appendChild(el);
  // больше трёх карточек не держим: экран не должен «зарастать» старыми новостями
  while (box.children.length > 3) box.firstElementChild.remove();
  el._t = setTimeout(close, timeout);
}
function openModal(html) {
  closeMenu();
  $('#modalBody').innerHTML = html;
  lockFormsForViewer($('#modalBody'));
  $('#modal').classList.remove('hidden');
  // курсор сразу в первом пустом поле: форма заполняется с клавиатуры, но
  // открытая на просмотр карточка не перехватывает ввод и не портит текст
  const first = $('#modalBody input:not([type=hidden]):not([type=checkbox]):not([disabled]), #modalBody textarea, #modalBody select');
  if (first && !String(first.value || '').length) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch {} }, 30);
}
// Наблюдатель видит карточки и отчёты, но формы в окнах становятся только для
// чтения: сервер изменения всё равно отклоняет, а человеку сразу понятно почему.
function lockFormsForViewer(root) {
  if (canEdit()) return;
  lockForm(root, 'Режим просмотра: изменения вносит сотрудник с ролью «Менеджер» или «Администратор».');
}
// Форма открывается на просмотр: поля гаснут, а под ними — понятная причина.
function lockForm(root, text) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('form').forEach(f => {
    f.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = true; });
    if (!f.querySelector('.viewer-lock')) {
      const note = document.createElement('p');
      note.className = 'form-hint viewer-lock';
      note.textContent = text;
      f.appendChild(note);
    }
  });
}
function closeModal() {
  $('#modal').classList.add('hidden');
  if ($('#createdCredentials')) $('#modalBody').replaceChildren();
}
// Единое окно подтверждения вместо системного confirm().
function askConfirm(message, onYes, { okText = 'Подтвердить', danger = true, extraText = '', onExtra = null } = {}) {
  openModal(`<h3>Подтверждение действия</h3><p>${esc(message)}</p>
   <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
     <button class="btn" onclick="closeModal()">Отмена</button>
     ${extraText ? `<button class="btn" id="askConfirmExtra">${esc(extraText)}</button>` : ''}
     <button class="btn ${danger ? 'danger' : 'primary'}" id="askConfirmYes">${esc(okText)}</button>
   </div>`);
  $('#askConfirmYes').onclick = async () => {
    closeModal();
    // ошибку сервера показываем пользователю, а не теряем в консоли
    try { await onYes(); } catch (e) { toast(e.message, 'err'); }
  };
  const extra = $('#askConfirmExtra');
  if (extra && onExtra) extra.onclick = async () => { closeModal(); try { await onExtra(); } catch (e) { toast(e.message, 'err'); } };
}
// Единое модальное окно ввода вместо системного prompt().
function askInput({ title, label, value = '', type = 'text', okText = 'Сохранить' }, onSubmit) {
  openModal(`<h3>${esc(title)}</h3><form onsubmit="return askInputSubmit(event)">
    <label>${esc(label)}<input id="askInputField" type="${esc(type)}" value="${esc(value)}" required></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button type="button" class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn primary">${esc(okText)}</button>
    </div></form>`);
  setTimeout(() => { const f = $('#askInputField'); if (f) { f.focus(); f.select(); } }, 0);
  window.__askInputCb = onSubmit;
}
function askInputSubmit(e) {
  e.preventDefault();
  const value = $('#askInputField').value.trim();
  const cb = window.__askInputCb;
  closeModal();
  if (cb) Promise.resolve().then(() => cb(value)).catch(err => toast(err.message, 'err'));
  return false;
}
function tmpl(name, obj = {}) {
  // возвращаем чистый текст: экранирование делает вызывающий код при вставке в HTML
  return String(obj.body || '').replace(/{(\w+)}/g, (m, k) => (obj[k] !== undefined && obj[k] !== '' ? String(obj[k]) : m));
}

let __team = [];
async function team() {
  if (!__team.length) __team = await api('/api/users').catch(() => []);
  return __team;
}
function meId() { return (state.me && state.me.id) || null; }
// Права в интерфейсе повторяют права на сервере: наблюдатель только читает,
// менеджер ведёт клиентов и сделки, администратор меняет настройки и справочники.
const amAdmin = () => (state.me && state.me.role) === 'admin';
const canEdit = () => (state.me && state.me.role) !== 'viewer';
const viewerNote = () => canEdit() ? '' : `<div class="notice info">${icon('eye', 15)} <b>Режим просмотра.</b> Все данные и выгрузки доступны, а изменения вносят сотрудники с ролью «Менеджер» или «Администратор».</div>`;
function userOptions(selId) {
  return `<option value="">— не назначен —</option>` + __team.map(u => `<option value="${u.id}" ${u.id === selId ? 'selected' : ''}>${esc(u.name)} (${esc(roleLabel(u.role))})</option>`).join('');
}

// Подсказка в форме: по текущим правилам распределения считает, кому
// достанется новый контакт.
function responsibleHint() {
  const active = (__team || []).filter(u => u.active !== 0);
  const count = active.length || (state.meta && state.meta.activeUsers) || 1;
  if (count <= 1) return 'Пока в команде только вы — новые контакты закрепляются за вами. Добавить коллег: Настройки → Команда.';
  if (state.meta && state.meta.autoAssign) return 'Обращения из чатов и форм CRM распределяет сама — отдаёт менеджеру с меньшим числом сделок в работе. Здесь ответственного можно выбрать вручную.';
  return 'По умолчанию ответственный — вы, но можно выбрать коллегу. Автоматическое распределение обращений включается в «Настройки → Данные и компания».';
}

let __myTasks = [];
function myTasksBlock() {
  if (!__myTasks.length) return '<small style="color:var(--muted)">Открытых задач на вас нет. Поставьте себе дело, чтобы не потерять клиента из виду.</small>';
  return __myTasks.map(t => {
    const meta = taskDueMeta(t.due, t.done);
    return `<div class="row">
      <div style="min-width:0;flex:1">
        <b>${esc(t.title)}</b><br>
        <small class="${meta.overdue ? 'task-due-overdue' : (meta.label.startsWith('сегодня') ? 'task-due-today' : '')}">${esc(meta.label)}${t.contact_name ? ' · ' + esc(t.contact_name) : ''}</small>
      </div>
      <button class="btn sm mark" onclick="toggleTask(${t.id},1)">${icon('check', 13)} Выполнить</button>
    </div>`;
  }).join('');
}

// ── поля форм ───────────────────────────────────────────────────────────────
// Обязательные поля всегда идут первыми: жирная подпись и звёздочка. Ниже —
// необязательные, спокойным шрифтом. Ничего не спрятано за «Дополнительно»:
// лишнего клика нет, а форма остаётся читаемой за счёт разделителя.
const fld = (label, inner, required = false) =>
  `<label class="${required ? 'req' : 'opt'}">${label}${required ? '<span class="star" aria-hidden="true">*</span>' : ''}${inner}</label>`;
const grid2 = html => `<div class="form-grid2">${html}</div>`;
const formLegend = () => `<p class="form-hint"><span class="star">*</span> — обязательные поля. Остальные можно заполнить позже.</p>`;

// ── свои поля (custom fields) ─────────────────────────────────────────────
function cfFor(entity) {
  const all = (state.meta && state.meta.customFields) || [];
  return all.filter(f => f.entity === 'both' || f.entity === entity);
}
function cfValues(custom) {
  try { return typeof custom === 'string' ? JSON.parse(custom || '{}') : (custom || {}); } catch { return {}; }
}
// Свои поля: обязательные — вместе с обязательными полями карточки (сверху),
// необязательные — ниже разделителя, вместе с остальными необязательными.
function cfInputs(entity, obj = {}, grid = 2, only = 'all') {
  const fields = cfFor(entity).filter(f => only === 'all' ? true : only === 'required' ? f.required : !f.required);
  if (!fields.length) return '';
  const val = cfValues(obj.custom);
  return `<div class="form-grid2" style="grid-template-columns:repeat(${grid},1fr)">${fields.map(f => {
    const v = esc(val[f.key] ?? '');
    const star = f.required ? '<span class="star" aria-hidden="true">*</span>' : '';
    const cls = f.required ? 'req' : 'opt';
    if (f.type === 'select') return `<label class="${cls}">${esc(f.label)}${star}<select name="cf_${esc(f.key)}" ${f.required ? 'required' : ''}>${['', ...(f.options || [])].map(o => `<option value="${esc(o)}" ${String(val[f.key] ?? '') === o ? 'selected' : ''}>${esc(o || '—')}</option>`).join('')}</select></label>`;
    const t = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text';
    return `<label class="${cls}">${esc(f.label)}${star}<input name="cf_${esc(f.key)}" type="${t}" value="${v}" ${f.required ? 'required' : ''}></label>`;
  }).join('')}</div>`;
}
function cfCollect(form) {
  const data = Object.fromEntries(new FormData(form)); const custom = {};
  for (const k of Object.keys(data)) if (k.startsWith('cf_')) { custom[k.slice(3)] = data[k]; delete data[k]; }
  data.custom = JSON.stringify(custom);
  return data;
}
function cfTable(entity, obj = {}) {
  const fields = cfFor(entity); const val = cfValues(obj.custom);
  if (!fields.length) return '';
  return fields.map(f => `<tr><th>${esc(f.label)}</th><td>${String(val[f.key] ?? '') !== '' ? esc(val[f.key]) : '—'}</td></tr>`).join('');
}

// ── вход, сессия, меню пользователя ────────────────────────────────────────
function togglePass(btn) {
  const wrap = btn.closest('.pw-wrap') || btn.parentElement;
  const i = wrap ? wrap.querySelector('input') : null;
  if (!i) return;
  const isPass = i.type === 'password';
  i.type = isPass ? 'text' : 'password';
  btn.innerHTML = icon(isPass ? 'eyeOff' : 'eye', 16);
  btn.title = isPass ? 'Скрыть пароль' : 'Показать пароль';
}

function toggleUserMenu(e) {
  if (e) e.stopPropagation();
  const m = $('#userMenu');
  if (m) m.classList.toggle('hidden');
}
function closeUserMenu() {
  const m = $('#userMenu');
  if (m) m.classList.add('hidden');
}
window.addEventListener('click', e => {
  const wrap = $('.user-wrap');
  if (wrap && !wrap.contains(e.target)) closeUserMenu();
  // любое открытое выпадающее меню закрывается кликом вне его
  $$('details.dropdown[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeUserMenu();
    closeModal();
    closePalette();
  }
});

function endSession(reason = '') {
  token = '';
  totalStop();
  try { localStorage.removeItem('karkas_token'); } catch {}
  loginScreen(reason);
}

async function logout() {
  token = '';
  totalStop();
  try { localStorage.removeItem('karkas_token'); } catch {}
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  loginScreen();
}

async function loginScreen(note = '') {
  $('#passwordChange').classList.add('hidden');
  $('#passwordChangeForm').reset();
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  const err = $('#loginErr');
  if (err) err.textContent = note || '';
  const eye = $('#loginEye');
  if (eye) eye.innerHTML = icon('eye', 16);
  const form = $('#loginForm');
  if (form) form.reset();
}

$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const btn = $('#loginBtn'), err = $('#loginErr');
  err.textContent = '';
  btn.classList.add('loading'); btn.disabled = true;
  try {
    const b = Object.fromEntries(new FormData(e.target));
    const d = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(b) });
    if (!d.token || !isAscii(d.token)) throw new Error('Некорректный ключ авторизации');
    token = d.token; // только в памяти: на диск сессия сохраняется HttpOnly-cookie
    btn.textContent = 'Открываем…';
    await boot();
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.add('shake');
    setTimeout(() => err.classList.remove('shake'), 500);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
};

function storeSessionToken(value) {
  token = value; // сессия на диске — HttpOnly-cookie, в localStorage ничего не пишем
}
$('#passwordChangeForm').onsubmit = async e => {
  e.preventDefault();
  const form = e.target, btn = form.querySelector('button'), error = $('#passwordChangeErr');
  error.textContent = '';
  const b = Object.fromEntries(new FormData(form));
  if (b.new_password !== b.confirm_password) { error.textContent = 'Пароли не совпадают'; return; }
  btn.disabled = true;
  try {
    const result = await api('/api/me/password', { method: 'POST', body: JSON.stringify(b) });
    storeSessionToken(result.token); form.reset(); await boot();
  } catch (err) { error.textContent = err.message; }
  finally { btn.disabled = false; }
};

async function boot() {
  try {
    // cookie уходит автоматически (same-origin). noSessionEnd — чтобы первый
    // заход без сессии просто показывал форму входа, без «сеанс истёк».
    const me = await api('/api/me', { noSessionEnd: true });
    $('#uName').textContent = me.user.name;
    $('#uEmail').textContent = me.user.email;
    $('#uAva').textContent = (me.user.name || 'A')[0].toUpperCase();
    state.me = me.user;
    // роль на теле страницы: для наблюдателя прячем кнопки создания в шапке
    document.body.classList.remove('role-admin', 'role-manager', 'role-viewer');
    document.body.classList.add('role-' + (['admin', 'manager', 'viewer'].includes(me.user.role) ? me.user.role : 'manager'));
    if (me.user.must_change_password) {
      $('#login').classList.add('hidden'); $('#app').classList.add('hidden');
      $('#passwordChange').classList.remove('hidden');
      return;
    }
    $('#passwordChange').classList.add('hidden');
    state.meta = await api('/api/meta');
    // менеджеру не показываем карточку «Интеграции»: настройки всё равно только у администратора
    const sideInt = $('#sideIntegrations');
    if (sideInt && me.user.role !== 'admin') sideInt.classList.add('hidden');
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    // Set bell icon
    const bIcon = $('#bellIcon');
    if (bIcon) bIcon.innerHTML = icon('bell', 16);
    applyTheme();
    hydrateNavIcons();
    initRealtime();
    await go(state.view);
  } catch (e) {
    if (e.unauthorized) { await loginScreen(); return; }
    endSession('Сеанс истёк или связь с сервером потерялась — войдите заново.');
  }
}

function hydrateNavIcons() {
  const map = {
    dashboard: 'dashboard', pipe: 'pipe', inbox: 'inbox', contacts: 'contacts',
    companies: 'companies', tasks: 'tasks', products: 'products', competitors: 'competitors',
    analytics: 'analytics', settings: 'settings'
  };
  // Переключение разделов задано встроенным onclick в разметке — здесь только иконки.
  $$('#nav button').forEach(b => {
    const icoSpan = b.querySelector('.nav-ico');
    if (icoSpan && map[b.dataset.view]) icoSpan.innerHTML = icon(map[b.dataset.view], 16);
  });
  $$('#userMenu .user-menu-item').forEach(b => {
    const s = b.querySelector('.um-ico');
    if (s && s.dataset.icon) s.innerHTML = icon(s.dataset.icon, 15);
  });
  const searchIco = $('#searchIco');
  if (searchIco) searchIco.innerHTML = icon('search', 15);
}

/* ---------- navigation + skeletons ---------- */
// Порядок и названия разделов — как в amoCRM: сначала рабочие инструменты
// (стол, сделки, задачи, чаты), затем клиентская база, каталог, отчёты.
const TITLES = {
  dashboard: ['Рабочий стол', 'Главное за сегодня: продажи, задачи и новые сообщения'],
  pipe: ['Сделки', 'Воронка продаж — перетаскивайте карточки между этапами'],
  tasks: ['Задачи', 'Что и когда сделать: звонки, встречи и напоминания'],
  inbox: ['Чаты', 'Одна переписка на клиента: WhatsApp, Telegram, Instagram, Viber и почта'],
  contacts: ['Контакты', 'Клиенты с историей, сделками и перепиской'],
  companies: ['Компании', 'Юридические лица и связанные с ними клиенты'],
  products: ['Каталог', 'Ваш прайс-лист: дома, бани и услуги — то, что продаёте, и по каким ценам'],
  analytics: ['Аналитика', 'Сколько продали, конверсия, план и результаты менеджеров'],
  competitors: ['Конкуренты', 'Проверка по открытым источникам и сравнение цен'],
  settings: ['Настройки', 'Компания, интеграции, поля, команда и резервные копии']
};

const SKELETONS = {
  dashboard: () => `<div class="sk-grid">${'<div class="skeleton sk-kpi"></div>'.repeat(4)}</div><div class="cols"><div class="card"><div class="sk-line w40"></div><div class="sk-line"></div><div class="sk-line w80"></div><div class="sk-line w60"></div></div><div class="card"><div class="sk-line w60"></div>${'<div class="sk-row"><div class="skeleton sk-ava"></div><div style="flex:1"><div class="sk-line"></div><div class="sk-line w60"></div></div></div>'.repeat(4)}</div></div>`,
  pipe: () => `<div class="card"><div class="sk-line w40"></div></div><div class="kanban">${'<div class="skeleton sk-col"></div>'.repeat(4)}</div>`,
  inbox: () => `<div class="inbox"><div class="card">${'<div class="sk-row"><div class="skeleton sk-ava"></div><div style="flex:1"><div class="sk-line"></div></div></div>'.repeat(6)}</div><div class="card"><div class="sk-line w40"></div><div style="height:260px"></div><div class="sk-line"></div></div><div class="card"></div></div>`,
  contacts: () => `<div class="card"><div class="sk-line w60"></div><div class="sk-line"></div><div class="sk-line"></div><div class="sk-line w80"></div></div>`,
  tasks: () => `<div class="card"><div class="sk-line w40"></div>${'<div class="sk-line"></div>'.repeat(5)}</div>`,
  analytics: () => `<div class="sk-grid">${'<div class="skeleton sk-kpi"></div>'.repeat(4)}</div><div class="card"><div style="height:180px"></div></div>`,
  competitors: () => `<div class="sk-grid">${'<div class="skeleton sk-kpi"></div>'.repeat(3)}</div><div class="card">${'<div class="sk-line"></div>'.repeat(4)}</div>`,
  settings: () => `<div class="card"><div class="sk-line w40"></div>${'<div class="sk-line"></div>'.repeat(6)}</div>`,
  companies: () => `<div class="card"><div class="sk-line w40"></div>${'<div class="sk-line"></div>'.repeat(5)}</div>`,
  products: () => `<div class="card"><div class="sk-line w40"></div>${'<div class="sk-line"></div>'.repeat(5)}</div>`
};

async function go(view, subTab) {
  state.view = view;
  if (subTab) state.settingsTab = subTab;
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const [t, sub] = TITLES[view] || [view, ''];
  $('#title').textContent = t; $('#subtitle').textContent = sub;
  const v = $('#view');
  v.innerHTML = (SKELETONS[state.view] || SKELETONS.dashboard)();
  await render();
}

// Поле поиска перерисовывается вместе с таблицей — возвращаем в него курсор,
// иначе после каждого символа приходилось кликать в поле заново.
function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.id || !$('#view').contains(el)) return null;
  return { id: el.id, start: el.selectionStart, end: el.selectionEnd };
}
function restoreFocus(f) {
  if (!f) return;
  const el = document.getElementById(f.id);
  if (!el || el === document.activeElement) return;
  try {
    el.focus({ preventScroll: true });
    if (typeof f.start === 'number' && el.setSelectionRange) el.setSelectionRange(f.start, f.end);
  } catch { }
}
// Живой поиск: не дёргаем сервер и перерисовку на каждый символ.
const __liveTimers = {};
function liveSearch(key, run, ms = 160) { clearTimeout(__liveTimers[key]); __liveTimers[key] = setTimeout(run, ms); }

/* ---------- переключатели состояния ----------
   Кнопки и вкладки вызывают функции, а не пишут в state напрямую: так обработчики
   работают в любом браузере, их можно проверить тестом и легко найти по имени. */
function setSettingsTab(tab) { state.settingsTab = tab; render(); }
function setDealTab(tab, id) { state.dealTab = tab; openDealCard(id); }
function setCompTab(tab, id) { state.compTab = tab; openCompetitorCard(id); }
function setPipeline(id) { state.pipeline = Number(id) || 1; render(); }
function setDealScope(scope) { state.dealScope = scope; render(); }
function setDealQuery(value) { state.dealQuery = value; render(); }
function setTaskScope(scope) { state.taskScope = scope; render(); }
function setTaskView(view) { state.taskView = view; render(); }
function clearTaskFilter() { state.taskFilter = ''; render(); }
function setTaskQuery(value) { state.taskQuery = value; state.taskLimit = 50; render(); }
function clearTaskQuery() { state.taskQuery = ''; render(); }
function showMoreTasks() { state.taskLimit = (state.taskLimit || 50) + 50; render(); }
function goTasks(scope, filter) { state.taskScope = scope || 'all'; state.taskFilter = filter || ''; go('tasks'); }
function setContactFilter(field, value) { state.contactFilter = state.contactFilter || {}; state.contactFilter[field] = value; render(); }
function setContactQuery(value) { state.contactFilter = state.contactFilter || {}; state.contactFilter.q = value; state.contactLimit = 50; render(); }
function showMoreContacts() { state.contactLimit = (state.contactLimit || 50) + 50; render(); }
function setCompanyQuery(value) { state.companyQuery = value; render(); }
function showMoreCompanies() { state.companyLimit = (state.companyLimit || 100) + 100; render(); }
function setProductQuery(value) { state.productQuery = value; render(); }
function setProductScope(scope) { state.productScope = scope; render(); }
function setCompQuery(value) { state.compQuery = value; render(); }
function clearCompQuery() { state.compQuery = ''; render(); }
function setTeamQuery(value) { state.teamQuery = value; render(); }
function setTplQuery(value) { state.tplQuery = value; render(); }
function openConv(id) { state.conv = id; state.listOnly = false; go('inbox'); }
// На телефоне список диалогов и чат не помещаются на одном экране, поэтому
// показываем что-то одно: кнопка «Назад» возвращает к списку. На широком экране
// кнопка скрыта, там оба блока видны всегда.
function closeConv() { state.conv = null; state.listOnly = true; render(); }

// Очередь отрисовки: если пользователь быстро переключает разделы, ответ старого
// запроса не должен перетереть новый экран. Каждый вызов видит актуальный state.view.
let renderQueue = Promise.resolve();
function render() {
  renderQueue = renderQueue.then(renderNow, renderNow);
  return renderQueue;
}
async function renderNow() {
  const v = $('#view');
  closeMenu();
  const focus = captureFocus();
  try {
    if (state.view === 'dashboard') return await dashboard(v);
    if (state.view === 'pipe') return await pipe(v);
    if (state.view === 'inbox') return await inbox(v);
    if (state.view === 'contacts') return await contacts(v);
    if (state.view === 'companies') return await companies(v);
    if (state.view === 'tasks') return await tasks(v);
    if (state.view === 'products') return await products(v);
    if (state.view === 'competitors') return await competitorsView(v);
    if (state.view === 'analytics') return await analytics(v);
    if (state.view === 'settings') return await settings(v);
  } catch (e) {
    v.innerHTML = `<div class="card err"><h3>Не удалось загрузить раздел</h3><p>${esc(e.message)}</p><button class="btn primary" onclick="render()">Повторить попытку</button></div>`;
  } finally {
    restoreFocus(focus);
  }
}

async function openNotifications() {
  const rows = await api('/api/tasks');
  const today = todayISO();
  const over = rows.filter(t => !t.done && normalizeDue(t.due).slice(0, 10) < today && normalizeDue(t.due) !== '');
  const now = rows.filter(t => !t.done && normalizeDue(t.due).slice(0, 10) === today);
  const convs = (await api('/api/conversations')).filter(c => c.unread);
  const rowHtml = t => {
    const meta = taskDueMeta(t.due, t.done);
    return `<div class="row"><span><b>${esc(t.title)}</b><br><small>${esc(meta.label)}${t.contact_name ? ' · ' + esc(t.contact_name) : ''}</small></span>${canEdit() ? `<button class="btn sm" onclick="closeModal();openTask(${t.id})">Открыть</button>` : ''}</div>`;
  };
  const chatRow = c => `<div class="row"><span style="min-width:0"><b>${esc(c.title)}</b> <span class="badge">${c.unread}</span><br><small>${chan(c.channels)} · ${esc(dt(c.last_at))} · ${esc(String(c.last_body || '').slice(0, 70))}</small></span><button class="btn sm" onclick="closeModal();openConv(${c.id})">Открыть чат</button></div>`;
  const empty = 'Ничего не ждёт — можно спокойно работать с клиентами.';
  openModal(`<h3>${icon('bell', 18)} Что ждёт реакции</h3>
   <p class="form-hint">Три списка: просроченные задачи, планы на сегодня и чаты, где клиент ещё не получил ответ. Всплывающие карточки о новых сообщениях видят ответственный за клиента и администраторы, остальным растёт счётчик в меню.</p>
   <h4 class="danger-text" style="margin:12px 0 4px">Просроченные задачи: ${over.length}</h4>
   <p class="form-hint" style="margin:0 0 4px">Срок уже прошёл — лучше заняться этим первым.</p>
   ${over.map(rowHtml).join('') || `<small>${empty}</small>`}
   <h4 style="margin:16px 0 4px;color:var(--green)">Планы на сегодня: ${now.length}</h4>
   <p class="form-hint" style="margin:0 0 4px">Звонки, встречи и письма, запланированные на сегодня.</p>
   ${now.map(rowHtml).join('') || '<small>На сегодня задач нет.</small>'}
   <h4 style="margin:16px 0 4px">${icon('inbox', 15)} Чаты без ответа: ${convs.length}</h4>
   <p class="form-hint" style="margin:0 0 4px">Непрочитанные сообщения клиентов: цифра на оранжевой метке — сколько писем жду́т реакции.</p>
   ${convs.map(chatRow).join('') || '<small>Все переписки прочитаны.</small>'}
   <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
     <button class="btn sm" onclick="closeModal();goTasks('all','overdue')">Все задачи</button>
     <button class="btn sm" onclick="closeModal();go('inbox')">Все чаты</button>
     <button class="btn sm" onclick="closeModal()">Закрыть</button>
   </div>`);
}

const BASE_TITLE = 'КаркасCRM — сделки, клиенты и задачи в единой CRM-системе';
async function navCounts(d) {
  $('#navUnread').textContent = d.unread || '';
  $('#navTasks').textContent = d.tasksOpen || '';
  $('#navDeals').textContent = d.dealsTotal || '';
  // Колокольчик показывает всё, что требует внимания: просроченные задачи и
  // непрочитанные чаты. В заголовке вкладки — только новые сообщения: их видно,
  // даже когда CRM свёрнута.
  const attention = (d.tasksOverdue || 0) + (d.unread || 0);
  const b = $('#bellCount');
  if (b) b.textContent = attention || '';
  const bell = $('#bellBtn');
  if (bell) bell.title = attention
    ? `Требуют внимания: ${attention} (просроченные задачи и новые сообщения)`
    : 'Уведомления: всё под контролем';
  document.title = d.unread ? `(${d.unread}) Новые сообщения — КаркасCRM` : BASE_TITLE;
}

/* ---------- dashboard ---------- */
async function dashboard(v) {
  const d = await api('/api/dashboard');
  navCounts(d);
  __myTasks = (await api('/api/tasks').catch(() => [])).filter(t => !t.done && (t.responsible_id === meId() || !t.responsible_id)).slice(0, 6);
  const max = Math.max(...d.stages.map(s => s.sum), 1);
  const todayTasks = d.tasksToday ?? 0;
  const overdueTasks = d.tasksOverdue ?? 0;
  const unreadChats = d.unread ?? 0;

  v.innerHTML = `
   <div class="card" style="margin-bottom:12px;padding:12px 16px">
     ${!todayTasks && !overdueTasks && !unreadChats
      ? `<div class="all-clear">${icon('checkCircle', 16)} <b>Всё под контролем</b> — просроченных задач и непрочитанных чатов нет</div>`
      : `<h3 style="margin-bottom:8px">${icon('alertCircle', 16)} Требует внимания</h3>`}
     <div class="attn-grid" ${!todayTasks && !overdueTasks && !unreadChats ? 'style="display:none"' : ''}>
       <div class="attn-card today clickable-card" onclick="goTasks('all','today')" title="Открыть задачи на сегодня">
         <span style="font-size:12.5px">${icon('calendar', 14)} На сегодня</span>
         <b>${todayTasks}</b> <small>задач</small>
       </div>
       <div class="attn-card warn clickable-card" onclick="goTasks('all','overdue')" title="Открыть просроченные задачи">
         <span style="font-size:12.5px">${icon('clock', 14)} Просрочено</span>
         <b>${overdueTasks}</b> <small>задач</small>
       </div>
       <div class="attn-card chat clickable-card" onclick="go('inbox')" title="Открыть непрочитанные диалоги">
         <span style="font-size:12.5px">${icon('inbox', 14)} Непрочитанных чатов</span>
         <b>${unreadChats}</b>
       </div>
     </div>
   </div>

   <div class="grid">
     <div class="kpi clickable-card" onclick="go('analytics')" title="Перейти в Аналитику">
       <i>${icon('money', 20)}</i>
       <span>Выручка (успешно)</span>
       <b class="green">${fmt(d.revenue)}</b>
       ${d.monthRevenue ? `<small>в этом месяце: ${fmt(d.monthRevenue)}</small>` : ''}
     </div>
     <div class="kpi clickable-card" onclick="go('pipe')" title="Перейти в Сделки">
       <i>${icon('pipe', 20)}</i>
       <span>Активных сделок</span>
       <b>${d.dealsTotal}</b>
       <small>на сумму ${fmt(d.activeDealsSum || 0)}</small>
     </div>
     <div class="kpi clickable-card" onclick="go('analytics')" title="Перейти в Аналитику">
       <i>${icon('analytics', 20)}</i>
       <span>Конверсия</span>
       <b class="green">${d.conversion ?? 0}%</b>
       <small>успешных к закрытым</small>
     </div>
     <div class="kpi clickable-card" onclick="go('tasks')" title="Перейти в Задачи">
       <i>${icon('tasks', 20)}</i>
       <span>Задачи</span>
       <b>${d.tasksOpen}</b>
       <small>открытых</small>
       ${d.tasksOverdue ? `<small class="danger-text">просрочено: ${d.tasksOverdue}</small>` : `<small>на сегодня: ${d.tasksToday}</small>`}
     </div>
     <div class="kpi clickable-card" onclick="go('inbox')" title="Перейти в Чаты">
       <i>${icon('inbox', 20)}</i>
       <span>Чаты</span>
       <b class="accent">${d.unread}</b>
       <small>${plural(d.unread, 'непрочитанный чат', 'непрочитанных чата', 'непрочитанных чатов')}</small>
     </div>
     <div class="kpi clickable-card" onclick="go('contacts')" title="Перейти в Контакты">
       <i>${icon('contacts', 20)}</i>
       <span>База</span>
       <b>${d.contacts}</b>
       <small>компаний: ${d.companies}</small>
     </div>
   </div>

  ${d.contacts === 0 && d.dealsTotal === 0 ? `<div class="card tint-ok"><b>База пустая — самое время начать</b><br><small>Добавьте первый контакт кнопкой «+ Контакт» вверху страницы: сделки, задачи и чаты можно вести прямо из его карточки. Каналы связи и почта подключаются в разделе «Настройки».</small></div>` : ''}
  <div class="cols"><div>
   <div class="card"><h3>Воронка продаж</h3>${d.stages.map(s => `<p style="display:flex;justify-content:space-between;margin:8px 0 2px"><span>${esc(s.name)} · ${s.count}</span><b>${fmt(s.sum)}</b></p><div class="bar"><i style="width:${Math.round(s.sum / max * 100)}%"></i></div>`).join('')}</div>
   <div class="card"><h3>Последние сделки</h3><table class="mini"><tr><th>Сделка</th><th>Клиент</th><th>Этап</th><th>Сумма</th></tr>${d.recentDeals.map(x => `<tr><td><b>${esc(x.title)}</b></td><td>${esc(x.contact_name || '—')}</td><td>${esc((d.stages.find(s => s.code === x.stage) || {}).name || x.stage)}</td><td><b>${fmt(x.amount)}</b></td></tr>`).join('')}</table></div></div>
  <div>
   <div class="card"><div class="row" style="border:0"><h3>Мои задачи</h3><button class="btn sm" onclick="go('tasks')">Все задачи</button></div>
    <div class="list">${myTasksBlock()}</div></div>
   <div class="card"><h3>Последние события компании</h3>
    <p class="form-hint">Что недавно меняли коллеги: клиенты, этапы сделок, письма, документы.</p>
    <div class="list feed">${d.activities.map(a => `<div class="row"><span>• ${esc(a.text)}<br><small>${esc(dt(a.created_at))}${a.user_name ? ' · ' + esc(a.user_name) : ''}</small></span></div>`).join('') || '<small>Пока пусто</small>'}</div></div>
  </div></div>`;
}

function getAvatarColor(str = '') {
  const colors = ['#16a34a', '#ea580c', '#0284c7', '#7c3aed', '#db2777', '#d97706', '#059669', '#4f46e5'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash << 5) - hash + str.charCodeAt(i);
  return colors[Math.abs(hash) % colors.length];
}

function dealTaskBadge(x) {
  if (['won', 'lost'].includes(x.stage)) return '';
  if (!x.tasks_open || x.tasks_open === 0) {
    return `<span class="deal-task-pill notask" onclick="event.stopPropagation();openTask(null,{deal_id:${x.id},contact_id:${x.contact_id || 'null'}})" title="Нет задач — нажмите, чтобы поставить">${icon('plusCircle', 11)} Без задач</span>`;
  }
  const meta = taskDueMeta(x.next_task_due);
  if (meta.overdue) {
    return `<span class="deal-task-pill overdue" onclick="event.stopPropagation();openTask(null,{deal_id:${x.id}})" title="Просроченная задача: ${esc(meta.label)}">${icon('clock', 11)} ${esc(meta.label)}</span>`;
  }
  if (meta.label.startsWith('сегодня')) {
    return `<span class="deal-task-pill today" onclick="event.stopPropagation();openTask(null,{deal_id:${x.id}})" title="Задача на сегодня">${icon('clock', 11)} ${esc(meta.label)}</span>`;
  }
  return `<span class="deal-task-pill future" onclick="event.stopPropagation();openTask(null,{deal_id:${x.id}})" title="Задача: ${esc(meta.label)}">${icon('clock', 11)} ${esc(meta.label)}</span>`;
}

function dragDealStart(e, id) {
  e.dataTransfer.setData('text/plain', id);
  document.body.classList.add('dragging');
  const bar = $('#dropCloseBar');
  if (bar) bar.classList.remove('hidden');
}
function dragDealEnd() {
  document.body.classList.remove('dragging');
  const bar = $('#dropCloseBar');
  if (bar) bar.classList.add('hidden');
}

/* ---------- deals / kanban ---------- */
async function pipe(v) {
  const d = await api('/api/deals?pipeline=' + state.pipeline);
  Object.assign(state, { deals: d.deals, stages: d.stages, pipelines: d.pipelines });
  $('#navDeals').textContent = d.deals.filter(x => !['won', 'lost'].includes(x.stage)).length;
  const q = (state.dealQuery || '').toLowerCase();
  let baseDeals = state.dealScope === 'mine' ? d.deals.filter(x => x.responsible_id === meId())
    : state.dealScope === 'notask' ? d.deals.filter(x => !x.tasks_open && !['won', 'lost'].includes(x.stage))
    : state.dealScope === 'overdue' ? d.deals.filter(x => x.tasks_open > 0 && taskDueMeta(x.next_task_due).overdue && !['won', 'lost'].includes(x.stage))
    : d.deals;
  const shown = baseDeals.filter(x => !q || `${x.title} ${x.contact_name || ''} ${x.company_name || ''} ${x.responsible || ''}`.toLowerCase().includes(q));
  const noTaskCount = d.deals.filter(x => !x.tasks_open && !['won', 'lost'].includes(x.stage)).length;
  const overdueCount = d.deals.filter(x => x.tasks_open > 0 && taskDueMeta(x.next_task_due).overdue && !['won', 'lost'].includes(x.stage)).length;

  v.innerHTML = `${viewerNote()}${canEdit() ? bulkBar('deals', `${bulkStage()}${bulkOwner('deals')}`) : ''}<div class="card toolbar">
    <b>Воронка:</b><select style="width:auto" onchange="setPipeline(this.value)">${d.pipelines.map(p => `<option value="${p.id}" ${p.id === state.pipeline ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <span class="tabs" style="margin:0"><button class="${state.dealScope !== 'mine' && state.dealScope !== 'notask' && state.dealScope !== 'overdue' ? 'active' : ''}" onclick="setDealScope('all')">Все сделки</button><button class="${state.dealScope === 'mine' ? 'active' : ''}" onclick="setDealScope('mine')">Мои (${d.deals.filter(x => x.responsible_id === meId()).length})</button><button class="${state.dealScope === 'notask' ? 'active' : ''}" onclick="setDealScope('notask')">Без задач (${noTaskCount})</button><button class="${state.dealScope === 'overdue' ? 'active' : ''}" onclick="setDealScope('overdue')">Просрочено (${overdueCount})</button></span>
    <span class="tag" title="Сделок в текущем фильтре">Показано: ${shown.length}${shown.length !== shown.filter(x => !['won', 'lost'].includes(x.stage)).length ? ` · в работе: ${shown.filter(x => !['won', 'lost'].includes(x.stage)).length}` : ''}</span><span class="tag orange" title="Сумма активных сделок в фильтре">В работе на ${fmt(shown.filter(x => !['won', 'lost'].includes(x.stage)).reduce((a, x) => a + x.amount, 0))}</span>
    <button class="btn sm" style="margin-left:auto" onclick="download('/api/export/deals','deals.csv')" title="Выгрузить сделки в CSV">${icon('download', 13)} Экспорт</button>
    <input id="dealSearch" style="max-width:210px" placeholder="Поиск по сделкам и клиентам" value="${esc(state.dealQuery || '')}" oninput="liveSearch('deals',()=>setDealQuery(this.value))">
    ${(state.me && state.me.role) === 'admin' ? `<button class="btn sm" onclick="openPipelineEditor()">${icon('settings', 13)} Настроить воронку</button>` : ''}</div>
  <div class="kanban">${d.stages.map(s => {
    const colDeals = shown.filter(x => x.stage === s.code);
    const colSum = colDeals.reduce((a, x) => a + x.amount, 0);
    return `<div class="col" ${canEdit() ? `ondragover="dragOver(event,this)" ondragleave="this.classList.remove('drag-over')" ondrop="dropDeal(event,'${s.code}',this)"` : ''}>
   <h3><span style="color:${esc(s.color)}">● ${esc(s.name)}</span><span style="display:inline-flex;align-items:center;gap:6px"><small style="font-weight:normal;color:var(--muted)">${fmt(colSum)}</small><span>${colDeals.length}</span>${canEdit() ? `<button type="button" class="btn-col-add" onclick="openDeal(null,'${s.code}')" title="Добавить сделку в этап «${esc(s.name)}»">${icon('plus', 12)}</button>` : ''}</span></h3>
   <div class="deals">${colDeals.map(x => `<article class="deal ${selSet('deals').has(x.id) ? 'selected' : ''}" ${canEdit() ? `draggable="true" ondragstart="dragDealStart(event,${x.id})" ondragend="dragDealEnd()"` : ''} onclick="openDealCard(${x.id})" style="border-left-color:${esc(s.color)}${selSet('deals').has(x.id) ? ';box-shadow:0 0 0 2px var(--green)' : ''}">
    <b>${esc(x.title)}</b>${canEdit() ? `<input type="checkbox" title="Выбрать для массового действия" style="position:absolute;top:8px;right:8px" ${selSet('deals').has(x.id) ? 'checked' : ''} onclick="event.stopPropagation()" onchange="toggleSel('deals',${x.id})">` : ''}<span class="sum">${fmt(x.amount)}</span>
    <small>${icon('contact', 13)} ${esc(x.contact_name || 'Без контакта')}${x.deadline ? ' · ' + icon('clock', 13) + ' ' + esc(dateText(x.deadline)) : ''}</small>
    <div>${dealTaskBadge(x)}</div>
    <div class="deal-foot"><span class="prio ${esc(x.priority)}">${x.priority === 'high' ? 'высокий' : x.priority === 'low' ? 'низкий' : 'обычный'}</span>${canEdit() ? `<span><button class="btn sm" title="Передвинуть на следующий этап" onclick="event.stopPropagation();moveDeal(${x.id},1)">→</button></span>` : ''}</div></article>`).join('') || '<small style="padding:6px;color:var(--muted)">Пусто — перетащите сюда карточку</small>'}</div></div>`;
  }).join('')}</div>
  <div id="dropCloseBar" class="drop-close-bar hidden">
    <div class="drop-zone won" ondragover="event.preventDefault();this.classList.add('drag-target')" ondragleave="this.classList.remove('drag-target')" ondrop="dropDeal(event,'won',this);dragDealEnd()">${icon('checkCircle', 16)} Успешно реализовано</div>
    <div class="drop-zone lost" ondragover="event.preventDefault();this.classList.add('drag-target')" ondragleave="this.classList.remove('drag-target')" ondrop="dropDeal(event,'lost',this);dragDealEnd()">${icon('xCircle', 16)} Закрыто и не реализовано</div>
  </div>`;
}

function dragOver(e, el) { e.preventDefault(); el.classList.add('drag-over'); }
async function dropDeal(e, stage, el) { e.preventDefault(); el.classList.remove('drag-over'); document.body.classList.remove('dragging'); await moveDeal(e.dataTransfer.getData('text/plain'), 0, stage); }
// Название этапа для карточек: пользователь видит «Переговоры», а не код offer.
async function ensureStages() {
  if ((state.stages || []).length) return state.stages;
  try {
    const pl = await api('/api/pipelines');
    state.pipelines = pl;
    if (!state.pipeline || !pl.some(p => p.id === state.pipeline)) state.pipeline = (pl[0] || {}).id || 1;
    state.stages = (pl.find(p => p.id === state.pipeline) || pl[0] || {}).stages || [];
  } catch { }
  return state.stages || [];
}
function stageLabel(code) {
  const own = (state.stages || []).find(s => s.code === code);
  if (own) return own.name;
  // сделка может быть в другой воронке — ищем название этапа во всех загруженных
  for (const p of state.pipelines || []) {
    const hit = (p.stages || []).find(s => s.code === code);
    if (hit) return hit.name;
  }
  return code || '—';
}

async function moveDeal(id, dir, stage) {
  const card = state.deals.find(x => x.id == id);
  if (!card) return;
  if (!stage) { const i = state.stages.findIndex(s => s.code === card.stage); stage = state.stages[Math.min(state.stages.length - 1, i + dir)].code; }
  const stageName = (state.stages.find(s => s.code === stage) || {}).name || stage;
  const before = card.stage;
  card.stage = stage; if (state.view === 'pipe') pipe($('#view'));
  try { await api('/api/deals/' + id, { method: 'PATCH', body: JSON.stringify({ stage }) }); toast('Сделка переведена: ' + stageName); }
  catch (e) { card.stage = before; if (state.view === 'pipe') pipe($('#view')); toast(e.message, 'err'); }
  if (stage === 'lost' && before !== 'lost') askInput({ title: 'Причина отказа', label: 'Почему сделка не реализована? Это видно в аналитике', value: '', okText: 'Сохранить' }, reason => { if (reason) api('/api/deals/' + id, { method: 'PATCH', body: JSON.stringify({ loss_reason: reason }) }).catch(() => {}); });
}

function printDoc(id, doc) {
  // сессия передаётся cookie: токен не попадает в адресную строку и историю браузера
  window.open(`/api/deals/${id}/print?doc=${doc}`, '_blank', 'noopener');
}

// Отправить КП или счёт клиенту. Документ приходит ссылкой, которая открывается
// без входа в CRM: клиенту не нужно заводить учётную запись, а менеджеру —
// скачивать файл и прикладывать его в другой почтовой программе.
async function sendDoc(id) {
  const card = await api('/api/deals/' + id);
  const deal = card.deal;
  const noItems = !(card.products || []).length;
  openModal(`<h3>Отправить документ письмом</h3><form onsubmit="return submitSendDoc(event,${id})">
    ${noItems ? '<p class="form-hint">В сделке нет позиций — документ получится пустым. Сначала добавьте товары или услуги.</p>' : ''}
    ${fld('Какой документ', `<select name="doc"><option value="quote">Коммерческое предложение</option><option value="invoice">Счёт на оплату</option></select>`, true)}
    ${fld('E-mail клиента', `<input name="to" type="email" required value="${esc(deal.contact_email || '')}" placeholder="client@company.ru">`, true)}
    ${fld('Текст письма', `<textarea name="body" rows="3" placeholder="${esc(deal.contact_name || 'Добрый день')}! Направляю документы по вашему запросу…"></textarea>`)}
    <p class="form-hint">В письме будет ссылка на документ: открывается без входа в CRM, срок действия указан в письме.</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button type="button" class="btn" onclick="openDealCard(${id})">Отмена</button>
      <button class="btn primary">Отправить</button>
    </div></form>`);
}
async function submitSendDoc(e, id) {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = e.target.querySelector('button.primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Отправляем…'; }
  try {
    const r = await api(`/api/deals/${id}/send-doc`, { method: 'POST', body: JSON.stringify({ doc: f.get('doc'), to: f.get('to'), body: f.get('body') }) });
    closeModal(); toast('Письмо ушло на ' + r.to);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Отправить'; }
    toast(err.message, 'err');
  }
  return false;
}

async function openDeal(contactId, stageCode) {
  await team();
  await ensureStages();
  if (!state.contacts.length) state.contacts = await api('/api/contacts');
  const def = ((state.pipelines || []).find(p => p.id === state.pipeline) || state.pipelines?.[0] || {}).stages || [];
  const curStage = stageCode || (def[0] ? def[0].code : '');
  openModal(`<h3>Новая сделка</h3><form onsubmit="return saveDeal(event)">
   ${formLegend()}
   ${fld('Название сделки', `<input name="title" required placeholder="Каркасный дом 8×10">`, true)}
   ${cfInputs('deals', {}, 2, 'required')}
   ${grid2(`${fld('Сумма (' + CUR() + ')', `<input name="amount" type="number" value="0" placeholder="0">`)}
     ${fld('Клиент', `<select name="contact_id"><option value="">— выбрать —</option>${state.contacts.map(c => `<option value="${c.id}" ${c.id === contactId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`)}`)}
   ${grid2(`${fld('Этап', `<select name="stage">${def.map(st => `<option value="${esc(st.code)}" ${st.code === curStage ? 'selected' : ''}>${esc(st.name)}</option>`).join('')}</select>`)}
     ${fld('Ответственный', `<select name="responsible_id">${userOptions(meId())}</select>`)}`)}
   ${grid2(`${fld('Дедлайн', '<input name="deadline" type="date">')}
     ${fld('Приоритет', `<select name="priority"><option value="normal">Обычный</option><option value="high">Высокий</option><option value="low">Низкий</option></select>`)}`)}
   ${cfInputs('deals', {}, 2, 'optional')}
   <button class="btn primary w">Создать сделку</button></form>`);
}

function selStages(cur, list) {
  return (list || state.stages || []).map(s => `<option value="${esc(s.code)}" ${s.code === cur ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}
// Код этапа по его смыслу (успех/отказ): в разных воронках коды могут отличаться.
function kindStage(kind) {
  const list = (state.cardStages && state.cardStages.length ? state.cardStages : state.stages) || [];
  const hit = list.find(s => s.kind === kind);
  return hit ? hit.code : (kind === 'won' ? 'won' : 'lost');
}
// Быстрое решение по сделке прямо из карточки: выиграна / отказ.
async function quickDealStage(id, stage) {
  try {
    await api('/api/deals/' + id, { method: 'PATCH', body: JSON.stringify({ stage }) });
    closeModal(); render();
    const st = ((state.cardStages || state.stages || []).find(s => s.code === stage) || {});
    if (st.kind === 'lost') {
      toast('Сделка закрыта как нереализованная');
      askInput({ title: 'Причина отказа', label: 'Почему сделка не реализована? Это видно в аналитике', value: '', okText: 'Сохранить' }, reason => {
        if (reason) api('/api/deals/' + id, { method: 'PATCH', body: JSON.stringify({ loss_reason: reason }) }).catch(() => {});
      });
    } else toast(`Сделка переведена: ${st.name || stage}`);
  } catch (e) { toast(e.message, 'err'); }
}
async function saveDeal(e, id) {
  e.preventDefault();
  const b = cfCollect(e.target);
  // при редактировании воронку не меняем: сделка остаётся там, где она есть
  if (!id) b.pipeline_id = state.pipeline;
  b.amount = num(b.amount);
  b.contact_id = b.contact_id ? +b.contact_id : null;
  b.responsible_id = b.responsible_id ? +b.responsible_id : null;
  const user = __team.find(u => u.id === b.responsible_id);
  if (user) b.responsible = user.name;
  await api(id ? '/api/deals/' + id : '/api/deals', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) });
  if (!id) state.deals = [];
  closeModal(); toast(id ? 'Сделка сохранена' : 'Сделка создана'); render(); return false;
}

async function openDealCard(id) {
  const d = await api('/api/deals/' + id);
  await team();
  const deal = d.deal;
  if (!(state.contacts || []).length) state.contacts = await api('/api/contacts').catch(() => []);
  // этапы берём из воронки самой сделки: иначе в карточке можно выбрать чужой этап
  const pipes = state.pipelines && state.pipelines.length ? state.pipelines : await api('/api/pipelines');
  state.pipelines = pipes;
  const pipe = pipes.find(p => p.id === deal.pipeline_id) || pipes[0] || {};
  state.cardStages = pipe.stages || [];
  state.cardCompanies = state.cardCompanies || await api('/api/companies').catch(() => []);
  const done = ['won', 'lost'].includes(deal.stage);
  const openTasks = (d.tasks || []).filter(t => !t.done).length;
  const nextTask = (d.tasks || []).filter(t => !t.done && t.due).sort((a, b) => String(a.due).localeCompare(String(b.due)))[0];
  openModal(`
   <div class="modal-head">
     <div><h3>${esc(deal.title)}</h3><small>${esc(deal.contact_name || 'Без контакта')} · ${fmt(deal.amount)} · <span class="tag">${esc(stageLabel(deal.stage) || deal.stage)}</span></small></div>
     <div style="display:flex;gap:6px">
       <button class="btn sm" onclick="printDoc(${deal.id},'quote')" title="Коммерческое предложение">${icon('print', 13)} КП</button>
       <button class="btn sm" onclick="printDoc(${deal.id},'invoice')" title="Счёт на оплату">${icon('fileText', 13)} Счёт</button>
       <button class="btn sm" onclick="sendDoc(${deal.id})" title="Отправить КП или счёт клиенту письмом">${icon('mail', 13)} Отправить</button>
     </div>
   </div>
   ${!done && !openTasks ? `<div class="card tint-warn" style="margin:10px 0;padding:10px 12px"><b>${icon('alertCircle', 15)} У сделки нет открытых задач</b> — она может зависнуть. <button class="btn sm" style="margin-left:6px" onclick="openTask(null,{deal_id:${deal.id},contact_id:${deal.contact_id || 'null'}})">${icon('plus', 13)} Поставить задачу</button></div>` : ''}
   ${!done && openTasks && nextTask ? `<p style="margin:6px 0 0"><small>${icon('clock', 13)} Ближайшая задача: <b>${esc(nextTask.title)}</b> — ${esc(taskDueMeta(nextTask.due).label)}</small></p>` : ''}
   ${done ? '' : `<div class="card-actions">
     ${deal.contact_phone ? `<a class="btn sm" href="tel:${esc(String(deal.contact_phone).replace(/[^+\d]/g, ''))}">${icon('phone', 13)} Позвонить</a>` : ''}
     ${deal.contact_phone ? `<a class="btn sm" href="https://wa.me/${esc(String(deal.contact_phone).replace(/[^\d]/g, ''))}" target="_blank" rel="noopener">${icon('whatsapp', 13)} WhatsApp</a>` : ''}
     <button class="btn sm" onclick="openTask(null,{deal_id:${deal.id},contact_id:${deal.contact_id || 'null'}})">${icon('plus', 13)} Задача</button>
     <button class="btn sm primary" onclick="setDealTab('products',${deal.id})">${icon('products', 13)} Добавить товар</button>
     <button class="btn sm" style="margin-left:auto" onclick="quickDealStage(${deal.id},'${esc(kindStage('won'))}')">${icon('checkCircle', 13)} Выиграна</button>
     <button class="btn sm danger" onclick="quickDealStage(${deal.id},'${esc(kindStage('lost'))}')">${icon('xCircle', 13)} Отказ</button>
   </div>`}
   <div class="tabs" style="margin-bottom:12px">
     <button class="${state.dealTab === 'details' ? 'active' : ''}" onclick=\"setDealTab('details',${id})\">Детали</button>
     <button class="${state.dealTab === 'chat' ? 'active' : ''}" onclick=\"setDealTab('chat',${id})\">Переписка</button>
     <button class="${state.dealTab === 'products' ? 'active' : ''}" onclick=\"setDealTab('products',${id})\">Товары (${d.products.length})</button>
     <button class="${state.dealTab === 'tasks' ? 'active' : ''}" onclick=\"setDealTab('tasks',${id})\">Задачи (${d.tasks.length})</button>
     <button class="${state.dealTab === 'notes' ? 'active' : ''}" onclick=\"setDealTab('notes',${id})\">Заметки (${d.notes.length})</button>
     <button class="${state.dealTab === 'history' ? 'active' : ''}" onclick=\"setDealTab('history',${id})\">История</button>
   </div>
   <div id="dealCardTab">${dealTab(deal, d)}</div>`);
}

function dealTab(deal, d) {
  if (state.dealTab === 'details') {
    return `<form onsubmit="return saveDeal(event,${deal.id})">
     ${formLegend()}
     ${fld('Название сделки', `<input name="title" required value="${esc(deal.title)}">`, true)}
     ${cfInputs('deals', deal, 2, 'required')}
     ${grid2(`${fld('Сумма (' + CUR() + ')', `<input name="amount" type="number" value="${deal.amount}">`)}
       ${fld('Этап', `<select name="stage">${selStages(deal.stage, state.cardStages)}</select>`)}`)}
     ${grid2(`${fld('Клиент', `<select name="contact_id"><option value="">— без контакта —</option>${(state.contacts || []).map(c => `<option value="${c.id}" ${c.id === deal.contact_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`)}
       ${fld('Компания', `<select name="company_id"><option value="">— без компании —</option>${(state.cardCompanies || []).map(c => `<option value="${c.id}" ${c.id === deal.company_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`)}`)}
     ${grid2(`${fld('Дедлайн', `<input name="deadline" type="date" value="${esc((deal.deadline || '').slice(0, 10))}">`)}
       ${fld('Ответственный', `<select name="responsible_id">${userOptions(deal.responsible_id)}</select>`)}`)}
     ${grid2(`${fld('Приоритет', `<select name="priority"><option value="normal" ${deal.priority === 'normal' ? 'selected' : ''}>Обычный</option><option value="high" ${deal.priority === 'high' ? 'selected' : ''}>Высокий</option><option value="low" ${deal.priority === 'low' ? 'selected' : ''}>Низкий</option></select>`)}
       ${fld('Причина отказа (если сделка проиграна)', `<input name="loss_reason" value="${esc(deal.loss_reason || '')}" placeholder="Дорого, выбрали другого подрядчика…">`)}`)}
     ${cfInputs('deals', deal, 2, 'optional')}
     <div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary">Сохранить изменения</button><button class="btn danger" type="button" onclick="del('deals',${deal.id})">Удалить</button></div></form>`;
  }
  if (state.dealTab === 'chat') {
    if (!d.conversation) return '<div class="empty">У этой сделки нет контакта или переписки</div>';
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>Чат: ${esc(d.conversation.title)}</b><button class="btn sm" onclick="closeModal();openConv(${d.conversation.id})">Открыть в разделе Чаты →</button></div>
    <div class="msgs" style="max-height:360px">${d.messages.map(msgHtml).join('') || '<small>Сообщений пока нет</small>'}</div>`;
  }
  if (state.dealTab === 'products') {
    const total = d.products.reduce((a, p) => a + p.price * p.qty, 0);
    return `<table><tr><th>Товар / проект</th><th>Цена</th><th>Кол-во</th><th>Сумма</th><th></th></tr>${d.products.map(p => `<tr><td>${esc(p.name)}</td><td>${fmt(p.price)}</td><td>${p.qty}</td><td><b>${fmt(p.price * p.qty)}</b></td><td><button class="btn sm danger" onclick="delRow('deal_products',${p.id},${deal.id})">${icon('close', 13)}</button></td></tr>`).join('') || '<tr><td colspan="5"><small>Позиций нет — добавьте проект дома или доп. опцию</small></td></tr>'}${d.products.length ? `<tr><td colspan="3" style="text-align:right"><b>Итого по позициям:</b></td><td><b>${fmt(total)}</b></td><td></td></tr>${Math.abs(total - deal.amount) >= 1 ? `<tr><td colspan="5"><small>Сумма сделки — ${fmt(deal.amount)}. <button class="btn sm" onclick="syncDealAmount(${deal.id},${total})">Подставить ${fmt(total)} в сделку</button></small></td></tr>` : ''}` : ''}</table>
     <hr><button class="btn sm primary" onclick="addDealProduct(${deal.id})">+ Добавить товар / услугу</button>`;
  }
  if (state.dealTab === 'tasks') {
    return `<div class="list">${d.tasks.map(t => {
      const meta = taskDueMeta(t.due, t.done);
      return `<div class="row">
        <span><button class="btn sm mark ${t.done ? 'done' : ''}" onclick="toggleTask(${t.id}, ${t.done ? 0 : 1}, ${deal.id})">${t.done ? icon('check', 13) + ' Выполнено' : 'Выполнить'}</button> <span class="${t.done ? 'task-done' : ''}">${esc(t.title)}</span><br><small class="${meta.overdue ? 'task-due-overdue' : ''}">${esc(meta.label)}</small></span>
        <button class="btn sm danger" onclick="delRow('tasks',${t.id},${deal.id})">${icon('close', 13)}</button>
      </div>`;
    }).join('') || '<small>Задач нет</small>'}</div>
     <button class="btn sm primary" style="margin-top:10px" onclick="openTask(null,{deal_id:${deal.id},contact_id:${deal.contact_id}})">+ Задача по сделке</button>`;
  }
  if (state.dealTab === 'notes') {
    return `<form onsubmit="return addNote(event,'deals',${deal.id})"><label>Новая заметка<textarea name="body" rows="2" required placeholder="Договорились перезвонить после замера…"></textarea></label><button class="btn sm primary">Добавить</button></form>
     <div class="list" style="margin-top:12px">${d.notes.map(n => noteRow(n, 'deals', deal.id, `${n.id},null,${deal.id}`)).join('') || '<small>Заметок нет — запишите договорённости, чтобы не держать их в голове</small>'}</div>`;
  }
  if (state.dealTab === 'history') {
    return `<div class="list">${d.history.map(a => `<div class="row"><span>• ${esc(a.text)}<br><small>${esc(dt(a.created_at))}${a.user_name ? ' · ' + esc(a.user_name) : ''}</small></span></div>`).join('') || '<small>История пуста</small>'}</div>`;
  }
}

async function addNote(e, entity_type, entity_id) {
  e.preventDefault();
  const body = new FormData(e.target).get('body');
  try { await api('/api/notes', { method: 'POST', body: JSON.stringify({ entity_type, entity_id, body }) }); }
  catch (err) { toast(err.message, 'err'); return false; }
  toast('Заметка добавлена');
  reopenCard(entity_type, entity_id);
  return false;
}
// Заметку можно поправить: опечатка или новая деталь не заставляют писать её заново.
async function editNote(id, entity_type, entity_id) {
  let n;
  try { n = await api('/api/notes/' + id); } catch (e) { return toast(e.message, 'err'); }
  openModal(`<h3>Изменить заметку</h3><form onsubmit="return saveNote(event,${id},'${entity_type}',${entity_id})">
   <label>Текст заметки<textarea name="body" rows="4" required>${esc(n.body || '')}</textarea></label>
   <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary">Сохранить заметку</button>
   <button type="button" class="btn" onclick="reopenCard('${entity_type}',${entity_id})">Отмена</button></div></form>`);
}
async function saveNote(e, id, entity_type, entity_id) {
  e.preventDefault();
  const body = new FormData(e.target).get('body');
  try { await api('/api/notes/' + id, { method: 'PATCH', body: JSON.stringify({ body }) }); }
  catch (err) { toast(err.message, 'err'); return false; }
  toast('Заметка обновлена');
  reopenCard(entity_type, entity_id);
  return false;
}
// После изменения заметки возвращаем человека в ту же карточку, а не в список.
function reopenCard(entity_type, entity_id) {
  if (entity_type === 'deals') openDealCard(entity_id);
  else if (entity_type === 'contacts') openContactCard(entity_id);
  else { closeModal(); render(); }
}
// Строка заметки: текст, автор и понятные кнопки «Изменить» и «Удалить».
function noteRow(n, entity_type, entity_id, delArgs) {
  return `<div class="row"><span>${esc(n.body)}<br><small>${esc(n.author || '—')} · ${esc(dt(n.created_at))}</small></span>
   ${canEdit() ? `<span style="display:flex;gap:6px;flex:none"><button class="btn sm" title="Изменить заметку" onclick="editNote(${n.id},'${entity_type}',${entity_id})">${icon('edit', 13)} Изменить</button>
   <button class="btn sm danger" title="Удалить заметку" onclick="delNote(${delArgs})">${icon('close', 13)}</button></span>` : ''}</div>`;
}
async function addDealProduct(dealId) {
  const prods = await api('/api/products');
  state.catalogMap = Object.fromEntries(prods.map(p => [p.id, { name: p.name, price: p.price, unit: p.unit || 'шт' }]));
  openModal(`<h3>Добавить товар к сделке</h3><form onsubmit="return saveDealProduct(event,${dealId})">
   <label>Товар из каталога<select name="product_id" onchange="pickCatalogProduct(this)"><option value="">— свободная позиция —</option>${prods.map(p => `<option value="${p.id}">${esc(p.name)} (${fmt(p.price)})</option>`).join('')}</select></label>
   <label>Название позиции*<input name="name" required placeholder="Каркасный дом «Север»"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Цена (${CUR()})<input name="price" type="number" required value="0"></label>
   <label>Количество<input name="qty" type="number" step="0.1" value="1"></label></div>
   <button class="btn primary w">Добавить</button></form>`);
}
function pickCatalogProduct(sel) {
  const p = (state.catalogMap || {})[sel.value];
  if (!p) return;
  sel.form.name.value = p.name;
  sel.form.price.value = p.price;
}
async function syncDealAmount(dealId, amount) {
  await api('/api/deals/' + dealId, { method: 'PATCH', body: JSON.stringify({ amount }) });
  toast('Сумма сделки обновлена'); openDealCard(dealId);
}
async function saveDealProduct(e, deal_id) {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target));
  b.deal_id = deal_id; b.price = num(b.price); b.qty = num(b.qty) || 1;
  b.product_id = b.product_id ? +b.product_id : null;
  await api('/api/deals/' + deal_id + '/products', { method: 'POST', body: JSON.stringify(b) });
  toast('Товар добавлен'); openDealCard(deal_id); return false;
}
async function delNote(id, contactId, dealId) {
  await api('/api/notes/' + id, { method: 'DELETE' });
  toast('Заметка удалена');
  if (dealId) openDealCard(dealId); else if (contactId) openContactCard(contactId); else render();
}
async function delRow(table, id, parentId) {
  await api(`/api/${table}/${id}`, { method: 'DELETE' });
  toast('Удалено');
  if (table === 'deals') { closeModal(); render(); return; }
  if (parentId) openDealCard(parentId); else render();
}

/* ---------- inbox ---------- */
// Вложение в пузыре сообщения: картинка показывается превью, остальное — ссылкой на файл.
function attachmentHtml(m) {
  // только безопасные схемы: javascript:/data: в ссылке вложения недопустимы
  if (!m.content_uri || !/^(https?:\/\/|\/uploads\/)/i.test(m.content_uri)) return '';
  const url = esc(m.content_uri);
  const isImage = (m.content_type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(m.content_uri);
  if (isImage) return `<a href="${url}" target="_blank" rel="noopener" class="chat-attach img"><img loading="lazy" src="${url}" alt="${esc(m.content_name || 'изображение')}"></a>`;
  return `<a href="${url}" target="_blank" rel="noopener" class="chat-attach file">${icon('file', 14)}<span>${esc(m.content_name || nameFromUri(url) || 'вложение')}</span></a>`;
}
const MSG_STATUS = { sent: 'отправлено', delivered: 'доставлено', read: 'прочитано', inbound: 'входящее', received: 'получено', local: 'сохранено в CRM', error: 'не отправлено' };
const statusLabel = s => MSG_STATUS[s] || s || '';
// имя файла из ссылки: пригодится, если файл пришёл без имени
function nameFromUri(u) { try { const last = String(u || '').split('?')[0].split('/').pop() || ''; const d = decodeURIComponent(last); return d && /\./.test(d) ? d.slice(0, 80) : ''; } catch { return ''; } }
// аккаунт Wazzup, через который прошло сообщение: человек видит не только
// мессенджер, но и конкретный номер или бота из своего кабинета
function wzAccountLabel(id) { const c = (state.channels || []).find(x => x.external_id === id); return c ? (c.label || wzTitle(c)) : ''; }
function msgHtml(m) {
  const attach = attachmentHtml(m);
  // подпись «Вложение: имя» дублировала бы чип с тем же именем; текст оставляем
  // только когда это настоящая подпись к файлу или когда файл не открыть
  const placeholder = /^вложение[:\s]/i.test(String(m.body || '')) || m.body === '[вложение]';
  const body = m.body && !(placeholder && attach) ? esc(m.body) : '';
  const own = m.direction === 'out';
  const failed = m.status === 'failed';
  const badge = failed ? ' <span class="msg-fail" title="Не доставлено — проверьте подключение канала">не доставлено</span>' : '';
  const acc = wzAccountLabel(m.channel_id);
  return `<div class="msg ${own ? 'out' : ''}"><div>${attach}${body}</div><small>${esc(channelLabel(m.channel) || m.channel)}${acc ? ' · ' + esc(acc) : ''} · ${esc(dt(m.created_at))}${!failed && m.status ? ' · ' + esc(statusLabel(m.status)) : ''}${badge}</small></div>`;
}
// Каналы отправки: сначала те, в которых этот клиент уже писал, затем реально
// подключённые в Wazzup. Зашитый список показывал заказчику WhatsApp, которого
// у него нет, и прятал Авито с MAX, которые есть. Почты здесь нет намеренно:
// письмо отправляется отдельной кнопкой в шапке чата, а не через мессенджер.
// Какому мессенджеру какие транспорты аккаунтов подходят — зеркало серверной
// логики выбора: тип чата и аккаунт должны соответствовать друг другу.
const WZ_CHAT_TRANSPORTS = {
  whatsapp: ['whatsapp', 'wapi'], whatsgroup: ['whatsgroup'], viber: ['viber'],
  instagram: ['instagram'], telegram: ['telegram', 'tgapi'], telegroup: ['telegram', 'tgapi'],
  vk: ['vk'], avito: ['avito'], max: ['max', 'maxbot'], maxgroup: ['max', 'maxbot']
};
// С какого аккаунта уйдёт ответ при выбранном мессенджере: порядок тот же, что
// на сервере — аккаунт клиента, затем свой привязанный, затем любой рабочий.
function sendAccountFor(conv, chatType) {
  const fits = t => (WZ_CHAT_TRANSPORTS[chatType] || []).includes(String(t || '').trim().toLowerCase());
  const rows = state.channels || [];
  const ownRow = rows.find(c => c.external_id === (conv && conv.channel_id));
  if (conv && conv.channel_id && (!ownRow || fits(ownRow.transport))) return ownRow ? (ownRow.label || wzTitle(ownRow)) : 'аккаунт, на который писал клиент';
  const mine = rows.find(c => Number(c.user_id) === Number(meId()) && fits(c.transport) && wzAlive(c));
  if (mine) return mine.label || wzTitle(mine);
  const any = rows.find(c => fits(c.transport) && wzAlive(c));
  return any ? (any.label || wzTitle(any)) : '';
}
function refreshSendAccount(convId) {
  const el = $('#sendAccountHint'); if (!el) return;
  const conv = (state.cache.convs || []).find(c => Number(c.id) === Number(convId)) || null;
  const sel = $('#msgChannel');
  const acc = sendAccountFor(conv, sel ? sel.value : (conv && conv.chat_type) || '');
  el.textContent = acc ? 'Ответ уйдёт с аккаунта: ' + acc + '. Аккаунт Wazzup подставляется автоматически — тот, на который писал клиент.' : 'Рабочего аккаунта для этого мессенджера нет: проверьте синхронизацию каналов в настройках.';
}
function channelOptions(conv) {
  // Почту исключаем: письмо отправляется отдельной кнопкой в шапке чата, а сервер
  // на channel='email' отвечает ошибкой. Пункт, который всегда падает, не нужен.
  // По той же причине не предлагаем значения, которыми Wazzup не отправляет:
  // транспорт канала (wapi, tgapi, cian) типом чата не является.
  const fromConv = String(conv?.channels || '').split(',').map(x => x.trim()).filter(x => WZ_CHAT_SET.has(x));
  const connected = (state.channels || [])
    .filter(wzAlive)
    .map(c => WZ_TRANSPORT_TO_CHAT[String(c.transport || '').trim().toLowerCase()])
    .filter(Boolean);
  const list = [...new Set([...fromConv, ...connected])];
  if (!list.length) {
    // каналы ещё не синхронизированы — берём тип этой беседы, иначе нечего выбрать
    const own = String(conv?.chat_type || '').trim().toLowerCase();
    if (WZ_CHAT_SET.has(own)) list.push(own);
    else return '<option value="" disabled selected>Ответы в этот канал недоступны</option>';
  }
  return list.map(c => `<option value="${esc(c)}" ${c === String(conv?.chat_type || '').toLowerCase() ? 'selected' : ''}>${esc(channelLabel(c))}</option>`).join('');
}
async function inbox(v) {
  const convs = await api('/api/conversations');
  state.cache.convs = convs;
  // подключённые каналы нужны списку «Куда отправить»: без них там только те
  // каналы, в которых клиент уже писал, а новые не предложить
  if (!state.channels.length) state.channels = await api('/api/channels').catch(() => []);
  const cur = state.listOnly ? null : (convs.find(c => c.id === state.conv) || convs[0]);
  if (cur) { state.conv = cur.id; state.listOnly = false; }
  const msgs = cur ? await api(`/api/conversations/${cur.id}/messages`) : [];
  const templates = (state.cache.templates = state.cache.templates || await api('/api/templates'));
  // Wazzup подключён, но адрес у вендора не зарегистрирован: чаты будут пустыми,
  // а причина спрятана в настройках. Баннер ведёт прямо к кнопке, которая чинит.
  // пока входящих не было, настройки перечитываются: баннер должен исчезнуть
  // сразу после первого сообщения, а не после ручного захода в настройки
  if (!state.cache.settings || !(state.cache.settings.wazzup && state.cache.settings.wazzup.hook_msgs)) {
    state.cache.settings = await api('/api/settings').catch(() => state.cache.settings);
  }
  const wzN = state.cache.settings && state.cache.settings.wazzup;
  const wzNudge = wzN && wzN.configured && !wzN.hook_msgs && !wzN.hook_test_at
    ? `<div class="card tint-warn" style="margin:0 0 10px"><p><small>Wazzup подключён, но сообщения ещё не приходили: у Wazzup не указан входящий адрес этой CRM. Нажмите «Зарегистрировать адрес автоматически» — и входящие появятся здесь. <button type="button" class="btn sm" onclick="state.settingsTab='integrations';go('settings')">Открыть настройки</button></small></p></div>`
    : '';

  v.innerHTML = `${wzNudge}<div class="inbox${cur ? '' : ' list-only'}">
   <div class="convs"><div style="padding:10px;border-bottom:1px solid var(--line)"><input id="convSearch" placeholder="Поиск диалогов" oninput="filterConvs(this.value)"></div>
   <div id="convList">${convs.map(c => `<div class="conv ${c.id === (cur || {}).id ? 'active' : ''}${c.unread ? ' unread' : ''}" onclick="openConv(${c.id})">
    <b><span>${esc(c.title)}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</b>
    <p>${esc(c.last_body || '—')}</p><small>${chan(c.channels)} · ${esc(dt(c.last_at))}</small></div>`).join('') || '<div class="empty">Чатов пока нет</div>'}</div></div>
   <div class="chat">${cur ? `
    <div class="chat-head"><button type="button" class="btn sm chat-back" onclick="closeConv()" aria-label="К списку диалогов">${icon('arrowLeft', 14)}</button><div><b>${esc(cur.title)}</b> <small>${esc(cur.phone || '')}</small></div>
      <div style="display:flex;gap:6px">
        <button class="btn sm" onclick="attachContact(${cur.contact_id})">${icon('contact', 13)} Карточка клиента</button>
        ${canEdit() ? `<button class="btn sm" onclick="openEmailComposer(${cur.id})">${icon('email', 13)} Письмо</button>` : ''}
      </div></div>
    <div class="msgs" id="chatMsgs">${msgs.map(msgHtml).join('') || '<div class="empty">Диалог пуст</div>'}</div>
    ${canEdit() ? `<form class="composer" onsubmit="return sendMsg(event,${cur.id})">
     <div class="composer-row">
       <button type="button" class="btn icon-btn composer-ico" title="Прикрепить фото или файл" onclick="document.getElementById('chatFile').click()">${icon('paperclip', 17)}</button>
       <input type="file" id="chatFile" class="hidden" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,application/zip,.doc,.docx,.xls,.xlsx" onchange="uploadChatFile(this,${cur.id})">
       <input id="msgText" placeholder="Сообщение (Enter — отправить)…" required autocomplete="off">
       <button class="btn send-btn" title="Отправить сообщение">${icon('arrowUp', 17)}</button>
     </div>
     <div class="composer-row composer-sub">
       <span class="composer-label">Куда отправить</span>
       <select id="msgChannel" class="composer-select" title="Мессенджер отправки" aria-label="Куда отправить" onchange="refreshSendAccount(${cur.id})">${channelOptions(cur)}</select>
       <select id="msgTmpl" class="composer-select" title="Шаблон ответа" onchange="if(this.value){const t=$('#msgText');t.value=this.value;this.value='';t.focus();t.setSelectionRange(t.value.length,t.value.length)}"><option value="">Шаблоны ответов…</option>${templates.map(t => `<option value="${esc(tmpl(t.name, { body: t.body, name: cur.title, sum: cur.deal_amount ? fmt(cur.deal_amount) : '—', date: new Date().toLocaleDateString('ru-RU') }))}">${esc(t.name)}</option>`).join('')}</select>
       <button type="button" class="tmpl-settings" onclick="go('settings','templates')">${icon('settings', 12)} настроить шаблоны</button>
     </div>
     <p class="form-hint" id="sendAccountHint" style="margin:-2px 0 0"></p></form>` : `<div class="composer"><p class="form-hint" style="margin:0">${icon('eye', 14)} Режим просмотра: переписка доступна для чтения, отвечает менеджер или администратор.</p></div>`}` : '<div class="empty">Выберите диалог</div>'}</div>
   <div class="profile">${cur ? `<h3>Клиент</h3><p><b>${esc(cur.title || '')}</b></p><p>${icon('phone', 13)} ${esc(cur.phone || '—')}<br>${icon('email', 13)} ${esc(cur.email || '—')}</p><p>Каналы: ${chan(cur.channels)}${(cur.channels || '').includes('email') ? ' <span class="tag grey">почта подключена</span>' : ''}</p><p><button class="btn sm" onclick="attachContact(${cur.contact_id})">Открыть карточку клиента</button></p><hr><h3>Быстрые действия</h3><div style="display:flex;flex-direction:column;gap:6px">${cur.phone ? `<a class="btn sm" href="tel:${esc(String(cur.phone).replace(/[^+\d]/g, ''))}">${icon('phone', 13)} Позвонить</a>` : ''}${canEdit() ? `<button class="btn sm" onclick="openTask(null,{contact_id:${cur.contact_id}})">+ Задача</button><button class="btn sm" onclick="quickDeal(${cur.contact_id})">+ Сделка</button><button class="btn sm" onclick="quickNote(${cur.contact_id})">+ Заметка</button>` : ''}</div>` : '<div class="empty">Выберите чат</div>'}</div></div>`;
  if (cur && canEdit()) refreshSendAccount(cur.id);
  const mDiv = $('#chatMsgs');
  if (mDiv) mDiv.scrollTop = mDiv.scrollHeight;
}

// Мягкое обновление открытого чата: сообщения и список диалогов обновляются,
// а поле ввода с набранным текстом остаётся нетронутым.
async function refreshInbox() {
  try {
    if (!state.conv) return;
    const msgs = await api(`/api/conversations/${state.conv}/messages`);
    const box = $('#chatMsgs');
    if (box) {
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      box.innerHTML = msgs.map(msgHtml).join('') || '<div class="empty">Диалог пуст</div>';
      if (atBottom || msgs.some(m => m.direction === 'in')) box.scrollTop = box.scrollHeight;
    }
    state.cache.convs = await api('/api/conversations');
    filterConvs($('#convSearch')?.value || '');
    refreshSendAccount(state.conv);
  } catch { }
}

function filterConvs(q) {
  const list = state.cache.convs || [];
  const qL = q.toLowerCase();
  const filtered = list.filter(c => `${c.title} ${c.last_body || ''} ${c.phone || ''}`.toLowerCase().includes(qL));
  $('#convList').innerHTML = filtered.map(c => `<div class="conv ${c.id === state.conv ? 'active' : ''}${c.unread ? ' unread' : ''}" onclick="openConv(${c.id})">
    <b><span>${esc(c.title)}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</b>
    <p>${esc(c.last_body || '—')}</p><small>${chan(c.channels)} · ${esc(dt(c.last_at))}</small></div>`).join('') || '<div class="empty">Не найдено</div>';
}

async function attachContact(cid) { if (cid) openContactCard(cid); }
async function quickDeal(contactId) { openDeal(contactId); }
async function quickNote(contactId) { openModal(`<h3>Новая заметка</h3><form onsubmit="return saveQuickNote(event,${contactId})"><textarea name="body" rows="3" required placeholder="Заметка о клиенте…"></textarea><button class="btn primary sm" style="margin-top:8px">Сохранить</button></form>`); }
async function saveQuickNote(e, cid) { e.preventDefault(); await api('/api/notes', { method: 'POST', body: JSON.stringify({ entity_type: 'contacts', entity_id: cid, body: new FormData(e.target).get('body') }) }); closeModal(); toast('Заметка сохранена'); return false; }

async function sendMsg(e, cid) {
  e.preventDefault();
  const input = $('#msgText'), body = input.value.trim();
  if (!body) return false;
  const channel = $('#msgChannel').value;
  input.value = '';
  try {
    const r = await api(`/api/conversations/${cid}/messages`, { method: 'POST', body: JSON.stringify({ body, channel }) });
    if (r.send?.hint) toast(r.send.hint);
    else if (r.send?.delivered) toast('Сообщение отправлено');
    const msgs = await api(`/api/conversations/${cid}/messages`);
    $('#chatMsgs').innerHTML = msgs.map(msgHtml).join('');
    const mDiv = $('#chatMsgs'); if (mDiv) mDiv.scrollTop = mDiv.scrollHeight;
    // обновляем список диалогов: последний текст и счётчик непрочитанных
    state.cache.convs = await api('/api/conversations');
    filterConvs($('#convSearch')?.value || '');
    refreshSendAccount(state.conv);
  } catch (err) {
    // текст не теряем: возвращаем его в поле и ставим курсор в конец
    if (input.isConnected && !input.value) { input.value = body; input.focus(); }
    toast(err.message, 'err');
  }
  return false;
}
// Загрузка файла/фото из кнопки-скрепки: файл сразу уходит в диалог как вложение-ссылка.
async function uploadChatFile(input, cid) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) return toast('Файл больше 15 МБ — выберите файл поменьше');
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const dataBase64 = String(reader.result).split(',').pop();
      const up = await api(`/api/conversations/${cid}/upload`, { method: 'POST', body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream', dataBase64 }) });
      await api(`/api/conversations/${cid}/messages`, { method: 'POST', body: JSON.stringify({ body: (file.type || '').startsWith('image/') ? '' : (file.name || 'Файл'), contentUri: up.url, contentName: up.name, contentType: up.contentType, channel: $('#msgChannel')?.value || 'whatsapp' }) });
      toast('Файл отправлен'); refreshInbox();
    } catch (err) { toast(err.message, 'err'); }
  };
  reader.readAsDataURL(file);
}
function openEmailComposer(cid) {
  // обращение по имени: письмо не должно начинаться с обезличенного «Здравствуйте!»
  const conv = (state.cache.convs || []).find(c => Number(c.id) === Number(cid)) || {};
  const name = String(conv.title || '').trim().split(' ')[0] || '';
  const hello = name ? `Здравствуйте, ${name}!` : 'Здравствуйте!';
  const email = conv.email ? ` (${conv.email})` : '';
  openModal(`<h3>Письмо клиенту${email}</h3><form onsubmit="return sendEmail(event,${cid})"><label>Тема письма*<input name="subject" required value="Информация по проекту дома"></label><label>Текст письма*<textarea name="body" rows="6" required>${esc(hello)}\n\nВысылаю информацию по каркасному дому.</textarea></label><button class="btn primary w">Отправить письмо</button></form>`);
}
async function sendEmail(e, cid) {
  e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
  try {
    // письма уходят через SMTP, а не через мессенджер
    const r = await api(`/api/conversations/${cid}/email`, { method: 'POST', body: JSON.stringify(b) });
    closeModal();
    toast(r.send && r.send.delivered ? 'Письмо отправлено' : 'Письмо сохранено в переписке, но не отправлено — проверьте настройки почты', r.send && r.send.delivered ? 'ok' : 'err');
    if (state.view === 'inbox') refreshInbox(); else render();
  } catch (err) { toast(err.message, 'err'); }
  return false;
}
async function checkHealth() {
  try {
    const r = await fetch('/api/health');
    if (!r.ok) throw new Error('bad status');
    toast('Сервер работает штатно');
  } catch { toast('Сервер недоступен — обратитесь к администратору', 'err'); }
}

/* ---------- multi-select / bulk actions ---------- */
function selSet(key) { if (!state.sel[key]) state.sel[key] = new Set(); return state.sel[key]; }
function toggleSel(key, id) { const s = selSet(key); if (s.has(id)) s.delete(id); else s.add(id); render(); }
function clearSel(key) { selSet(key).clear(); render(); }
function selCount(key) { return selSet(key).size; }
function bulkBar(key, actionsHtml = '') {
  const n = selCount(key);
  if (!n) return '';
  return `<div class="bulkbar"><b>Выбрано: ${n}</b> <button class="btn sm ghost" onclick="clearSel('${key}')">Снять выбор</button> ${actionsHtml}</div>`;
}
async function bulkApply(table, action, patch = {}) {
  const ids = [...selSet(table)];
  if (!ids.length) return;
  if (action === 'delete') return askConfirm(`Удалить выбранные записи — ${ids.length} шт.? Действие необратимо.`, () => bulkApplyNow(table, action, ids, patch), { okText: 'Удалить' });
  return bulkApplyNow(table, action, ids, patch);
}
async function bulkApplyNow(table, action, ids, patch) {
  await api('/api/bulk', { method: 'POST', body: JSON.stringify({ table, action, ids, patch }) });
  clearSel(table);
  toast(`Применено к ${ids.length} записям`);
  render();
}
function bulkOwner(table) {
  return `<select style="width:auto" onchange="if(this.value){bulkApply('${table}','update',{responsible_id:+this.value});this.value=''}"><option value="">Сменить ответственного…</option>${__team.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>`;
}
function bulkStage() {
  return `<select style="width:auto" onchange="if(this.value){bulkApply('deals','update',{stage:this.value});this.value=''}"><option value="">Перевести на этап…</option>${(state.stages || []).map(s => `<option value="${s.code}">${esc(s.name)}</option>`).join('')}</select>`;
}

/* ---------- week calendar ---------- */
function weekCalendar(tasksList) {
  const now = new Date(); const dayIdx = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayIdx);
  const days = Array.from({ length: 7 }, (_, i) => isoDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
  const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const today = isoDate(now);
  return `<div class="calendar">${days.map((d, i) => {
    const list = tasksList.filter(t => normalizeDue(t.due).startsWith(d));
    return `<div class="cal-day ${d === today ? 'today' : ''}"><h4><span>${names[i]}</span><small>${d.slice(8, 10)}.${d.slice(5, 7)}</small></h4>
      ${list.map(t => {
        const isOver = !t.done && d < today;
        return `<div class="cal-task ${isOver ? 'overdue' : ''} ${t.done ? 'done' : ''}" onclick="openTask(${t.id})"><b>${esc(t.title)}</b><small>${esc(t.due ? t.due.slice(11, 16) : '')} · ${esc(t.contact_name || '')}</small></div>`;
      }).join('') || '<small style="color:var(--muted);padding:4px 0">Свободно</small>'}</div>`;
  }).join('')}</div>`;
}

/* ---------- contacts ---------- */
async function contacts(v) {
  await team();
  const f = (state.contactFilter = state.contactFilter || { q: '', owner: '', source: '', tag: '' });
  const list = await api('/api/contacts');
  state.contacts = list;
  const filtered = list.filter(c => {
    if (f.q && !`${c.name} ${c.phone || ''} ${c.email || ''} ${c.company || ''}`.toLowerCase().includes(f.q.toLowerCase())) return false;
    if (f.owner && c.responsible_id != f.owner) return false;
    if (f.source && c.source !== f.source) return false;
    if (f.tag && !(c.tags || '').split(',').map(s => s.trim()).includes(f.tag)) return false;
    return true;
  });
  const tagsAll = [...new Set(list.flatMap(c => (c.tags || '').split(',').map(s => s.trim()).filter(Boolean)))];

  v.innerHTML = `${viewerNote()}${canEdit() ? bulkBar('contacts', `${bulkOwner('contacts')}<button class="btn sm" onclick="bulkAddTag()">${icon('tag', 13)} Добавить тег</button><button class="btn sm danger" onclick="bulkApply('contacts','delete')">${icon('trash', 13)} Удалить</button>`) : ''}
  <div class="card toolbar">
   <input id="contactSearch" style="max-width:220px" placeholder="Поиск по имени, тел, почте" value="${esc(f.q)}" oninput="liveSearch('contacts',()=>setContactQuery(this.value))">
   <select style="width:auto" onchange="setContactFilter('owner',this.value)"><option value="">Все ответственные</option>${__team.map(u => `<option value="${u.id}" ${f.owner == u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
   <select style="width:auto" onchange="setContactFilter('source',this.value)"><option value="">Все источники</option>${(state.meta?.sources || Object.keys(SOURCE_LABELS)).map(s => `<option value="${esc(s)}" ${f.source === s ? 'selected' : ''}>${esc(sourceLabel(s))}</option>`).join('')}</select>
   ${tagsAll.length ? `<select style="width:auto" onchange="setContactFilter('tag',this.value)"><option value="">Все теги</option>${tagsAll.map(t => `<option value="${esc(t)}" ${f.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
   ${(f.q || f.owner || f.source || f.tag) ? `<button class="btn sm ghost" onclick="resetContactFilter()">Сбросить</button>` : ''}
   <span class="tag grey" style="margin-left:auto">показано ${Math.min(filtered.length, state.contactLimit || 50)} из ${filtered.length}${filtered.length !== list.length ? ` (всего в базе ${list.length})` : ''}</span>
   <button class="btn sm" onclick="openMenu(event, contactsMoreMenu())" title="Дубли, экспорт и импорт">${icon('more', 13)} Ещё</button>
   ${canEdit() ? `<button class="btn sm primary" onclick="openContact()">${icon('plus', 13)} Новый контакт</button>` : ''}</div>
  <div class="card"><div class="tbl-scroll"><table><tr><th class="sel"></th><th>Клиент</th><th>Телефон / E-mail</th><th>Компания</th><th>Источник</th><th>Теги</th><th>Ответственный</th><th></th></tr>
   ${filtered.slice(0, state.contactLimit || 50).map(c => `<tr class="${selSet('contacts').has(c.id) ? 'selected' : ''}"><td class="sel">${canEdit() ? `<input type="checkbox" title="Выбрать для массового действия" ${selSet('contacts').has(c.id) ? 'checked' : ''} onchange="toggleSel('contacts',${c.id})">` : ''}</td>
    <td><a href="#" onclick="openContactCard(${c.id});return false"><b>${esc(c.name)}</b></a></td><td>${esc(c.phone || '—')}<br><small>${esc(c.email || '')}</small></td><td>${esc(c.company || '—')}</td><td><span class="tag grey">${esc(sourceLabel(c.source))}</span></td>
    <td>${(c.tags || '').split(',').filter(Boolean).map(t => `<span class="tag">${esc(t.trim())}</span>`).join('')}</td>
    <td><small>${esc(__team.find(u => u.id === c.responsible_id)?.name || '—')}</small></td>
    <td style="white-space:nowrap"><button class="btn sm" onclick="openContactCard(${c.id})">Карточка</button>${canEdit() ? ` <button class="btn sm" onclick="openDeal(${c.id})">+ Сделка</button> <button class="btn sm danger" title="Удалить контакт" onclick="del('contacts',${c.id})">${icon('close', 13)}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">Контактов не найдено</div></td></tr>'}</table></div>
   ${filtered.length > (state.contactLimit || 50) ? `<div style="text-align:center;margin-top:10px"><button class="btn" onclick="showMoreContacts()">Показать ещё 50</button></div>` : ''}</div>`;
}

function resetContactFilter() { state.contactFilter = { q: '', owner: '', source: '', tag: '' }; render(); }
// Пункты меню «Ещё» в контактах: чтение доступно всем, загрузка — не наблюдателю.
function contactsMoreMenu() {
  return `<button type="button" onclick="closeMenu();openDuplicates()">${icon('search', 13)} Найти дубли клиентов</button>
   <button type="button" onclick="closeMenu();download('/api/export/contacts','contacts.csv')">${icon('download', 13)} Выгрузить в CSV</button>
   ${canEdit() ? `<button type="button" onclick="closeMenu();importContacts()">${icon('upload', 13)} Загрузить список из CSV</button>` : ''}`;
}
function bulkAddTag() {
  askInput({ title: 'Тег для выбранных контактов', label: 'Название тега', okText: 'Добавить тег' }, tag => {
    if (!tag) return;
    (async () => {
      const list = state.contacts.filter(c => selSet('contacts').has(c.id));
      for (const c of list) {
        const cur = (c.tags || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!cur.includes(tag)) {
          cur.push(tag);
          await api('/api/contacts/' + c.id, { method: 'PATCH', body: JSON.stringify({ tags: cur.join(',') }) });
        }
      }
      clearSel('contacts'); toast('Тег добавлен'); render();
    })();
  });
}

function siteFormCode() {
  const origin = ((state.cache.settings && state.cache.settings.public_url) || location.origin).replace(/\/+$/, '');
  const secret = (state.cache.settings && state.cache.settings.webhook && state.cache.settings.webhook.secret) || '';
  const hook = origin + '/webhooks/generic' + (secret ? '?secret=' + encodeURIComponent(secret) : '');
  return `<!-- Форма заявки КаркасCRM -->
<form onsubmit="return sendToKarkas(event)">
  <input name="name" required placeholder="Ваше имя">
  <input name="phone" required placeholder="+7 999 123-45-67">
  <input name="body" placeholder="Какой дом вас интересует?">
  <button type="submit">Отправить заявку</button>
</form>
<script>
async function sendToKarkas(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    await fetch('${hook}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'site', ...data })
    });
    alert('Спасибо! Ваша заявка принята.');
    e.target.reset();
  } catch (err) { alert('Не удалось отправить заявку. Проверьте подключение к интернету и попробуйте ещё раз.'); }
  return false;
}
<\/script>`;
}
// Одна строка «адрес + копировать»: адрес меняется от установки к установке.
function hookLine(url) {
  return `<div class="hook-line"><code>${esc(url)}</code><button type="button" class="btn sm" data-copy="${esc(url)}" onclick="copyFrom(this)">${icon('copy', 13)} Копировать</button></div>`;
}
function copyFrom(btn) {
  const text = btn.getAttribute('data-copy') || '';
  const done = () => toast('Скопировано');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallback());
  else fallback();
  function fallback() {
    openModal(`<h3>Скопируйте адрес</h3><textarea rows="3" readonly onclick="this.select()">${esc(text)}</textarea><p><small>Выделите текст и нажмите Ctrl+C.</small></p>`);
  }
}
async function savePublicUrl() {
  const v = ($('#publicUrl') && $('#publicUrl').value || '').trim();
  try { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ PUBLIC_URL: v }) }); toast(v ? 'Адрес сохранён' : 'Будет использоваться адрес из строки браузера'); state.cache.settings = null; render(); }
  catch (e) { toast(e.message, true); }
}
function copySiteFormCode() {
  navigator.clipboard.writeText(siteFormCode()).then(() => toast('Код формы скопирован в буфер')).catch(() => openModal(`<h3>Код формы для сайта</h3><textarea rows="14" readonly onclick="this.select()">${esc(siteFormCode())}</textarea><p><small>Выделите и скопируйте код, затем вставьте его на страницу сайта.</small></p>`));
}

// Написать первым. Беседа появлялась только из входящего сообщения, поэтому
// менеджер не мог отправить клиенту, который ещё не обращался, ни КП, ни
// напоминание. Канал отправки выбирается сам: берётся аккаунт того сотрудника,
// который отвечает (Настройки → Интеграции), а если привязки нет — любой
// работающий аккаунт нужного мессенджера.
async function startConv(contactId) {
  const [c, chans] = await Promise.all([
    api('/api/contacts/' + contactId),
    state.channels.length ? state.channels : api('/api/channels').catch(() => []),
  ]);
  state.channels = chans;
  const types = [...new Set(chans.filter(wzAlive).map(x => WZ_TRANSPORT_TO_CHAT[String(x.transport || '').trim().toLowerCase()]).filter(Boolean))];
  const list = types.length ? types : ['whatsapp'];
  const phone = String(c.phone || '').replace(/\D/g, '');
  openModal(`<h3>Написать клиенту</h3><form onsubmit="return submitStartConv(event,${contactId})">
    ${types.length ? '' : '<p class="form-hint">Каналы не синхронизированы, поэтому выбрать мессенджер не из чего: сообщение сохранится в CRM, но клиенту не уйдёт. Настройки → Интеграции → «Проверить и синхронизировать каналы».</p>'}
    ${fld('Куда написать', `<select name="chat_type" id="scType" onchange="scAddrHint()">${list.map(t => `<option value="${esc(t)}">${esc(channelLabel(t))}</option>`).join('')}</select>`, true)}
    ${fld('Адрес получателя', `<input name="chat_id" id="scAddr" value="${esc(phone)}"><small class="form-hint" id="scHint"></small>`, true)}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button type="button" class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn primary">Открыть чат</button>
    </div></form>`);
  scAddrHint();
}
function scAddrHint() {
  const t = ($('#scType') || {}).value || 'whatsapp', a = $('#scAddr'), h = $('#scHint');
  if (!a) return;
  const byPhone = ['whatsapp', 'viber'].includes(t);
  if (h) h.textContent = byPhone
    ? 'Номер цифрами: на него уйдёт сообщение, и с него придёт ответ'
    : 'Имя чата видно в первом сообщении клиента. Адрес не угадать, поэтому без него отправить нельзя';
  a.placeholder = byPhone ? '79991234567' : 'имя аккаунта';
}
async function submitStartConv(e, contactId) {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const r = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ contact_id: contactId, chat_type: f.get('chat_type'), chat_id: String(f.get('chat_id') || '').trim() }) });
    closeModal(); openConv(r.id);
  } catch (err) { toast(err.message, 'err'); }
  return false;
}

async function openContactCard(id) {
  await ensureStages();
  const c = await api('/api/contacts/' + id);
  const deals = (await api('/api/deals')).deals.filter(d => d.contact_id === id);
  const conv = (await api('/api/conversations')).find(x => x.contact_id === id);
  const notes = await api(`/api/notes?type=contacts&entity=${id}`);
  const contactTasks = (await api('/api/tasks').catch(() => [])).filter(t => t.contact_id === id && !t.done).slice(0, 6);
  await team();
  const rawPhone = (c.phone || '').replace(/[^\d]/g, '');

  openModal(`
   <div class="contact-head">
     <div class="avatar" style="background:${getAvatarColor(c.name)}">${esc((c.name || 'К')[0].toUpperCase())}</div>
     <div><h3 style="margin:0">${esc(c.name)}</h3><small>${esc(c.company || 'Частное лицо')} · источник: ${esc(sourceLabel(c.source))}</small></div>
     <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
       ${rawPhone ? `<a class="btn sm" href="https://wa.me/${rawPhone}" target="_blank" rel="noopener">${icon('whatsapp', 13)} WhatsApp</a><a class="btn sm" href="tel:${esc(String(c.phone).replace(/[^+\d]/g, ''))}">${icon('phone', 13)} Позвонить</a>` : ''}
       ${conv
        ? `<button class="btn sm" onclick="closeModal();openConv(${conv.id})">${icon('chat', 13)} Чат</button>`
        : `<button class="btn sm" onclick="startConv(${c.id})">${icon('chat', 13)} Написать</button>`}
       <button class="btn sm" onclick="openTask(null,{contact_id:${c.id}})">+ Задача</button>
       <button class="btn sm primary" onclick="openDeal(${c.id})">+ Сделка</button>
       <button class="btn sm" onclick="openContact(${c.id})">Редактировать</button>
     </div>
   </div>
   <hr>
   <div class="cols">
     <div>
       <h4>Сделки клиента (${deals.length})</h4>
       <table><tr><th>Сделка</th><th>Сумма</th><th>Этап</th></tr>${deals.map(d => `<tr><td><a href="#" onclick="closeModal();openDealCard(${d.id});return false"><b>${esc(d.title)}</b></a></td><td>${fmt(d.amount)}</td><td><span class="tag">${esc(stageLabel(d.stage))}</span></td></tr>`).join('') || '<tr><td colspan="3"><small>Сделок нет — создайте первую</small></td></tr>'}</table>
       <h4 style="margin-top:16px">Открытые задачи (${contactTasks.length})</h4>
       <div class="list">${contactTasks.map(t => {
         const meta = taskDueMeta(t.due, t.done);
         return `<div class="row"><span><b>${esc(t.title)}</b><br><small class="${meta.overdue ? 'task-due-overdue' : ''}">${esc(meta.label)}</small></span>
           <span style="display:flex;gap:6px"><button class="btn sm mark" onclick="toggleTask(${t.id},1);openContactCard(${c.id})">${icon('check', 13)} Выполнить</button><button class="btn sm" onclick="openTask(${t.id})">${icon('edit', 13)}</button></span></div>`;
       }).join('') || '<small>Открытых задач нет — поставьте звонок или встречу, чтобы не потерять клиента.</small>'}</div>
       <button class="btn sm" style="margin-top:8px" onclick="openTask(null,{contact_id:${c.id}})">+ Задача клиенту</button>
       <h4 style="margin-top:16px">Заметки</h4>
       <form onsubmit="return addNote(event,'contacts',${c.id})"><textarea name="body" rows="2" required placeholder="Заметка о клиенте…"></textarea><button class="btn sm primary" style="margin-top:6px">Добавить заметку</button></form>
       <div class="list" style="margin-top:10px">${notes.map(n => noteRow(n, 'contacts', c.id, `${n.id},${c.id}`)).join('') || '<small>Заметок нет</small>'}</div>
     </div>
     <div>
       <div class="row" style="border:0;padding-bottom:2px"><h4 style="margin:0">Контактные данные</h4>${canEdit() ? `<button class="btn sm" onclick="openContact(${c.id})">${icon('edit', 13)} Изменить</button>` : ''}</div>
       <p>Телефон: <b>${esc(c.phone || '—')}</b><br>E-mail: <b>${esc(c.email || '—')}</b><br>Компания: <b>${esc(c.company || '—')}</b><br>Ответственный: <b>${esc(__team.find(u => u.id === c.responsible_id)?.name || 'Не назначен')}</b></p>
       ${c.notes ? `<p><small><b>Заметка в карточке:</b> ${esc(c.notes)}</small></p>` : ''}
       ${cfTable('contacts', c) ? `<h4>Свои поля</h4><table class="mini">${cfTable('contacts', c)}</table>` : ''}
       <p><small>Создан: ${esc(dt(c.created_at))}</small></p>
     </div>
   </div>`);
}

async function openContact(id) {
  await team();
  const comps = await api('/api/companies');
  const c = id ? await api('/api/contacts/' + id) : { tags: '', custom: '{}' };
  openModal(`<h3>${id ? 'Контакт' : 'Новый контакт'}</h3><form onsubmit="return saveContact(event,${id || 'null'})">
   ${formLegend()}
   ${fld('Имя клиента', `<input name="name" required value="${esc(c.name || '')}" placeholder="Иван Петров">`, true)}
   ${cfInputs('contacts', c, 2, 'required')}
   ${grid2(`${fld('Телефон', `<input name="phone" value="${esc(c.phone || '')}" placeholder="+7 999 123-45-67">`)}
     ${fld('E-mail', `<input name="email" type="email" value="${esc(c.email || '')}" placeholder="ivan@mail.ru">`)}`)}
   ${grid2(`${fld('Компания', `<select name="company_id"><option value="">— частное лицо —</option>${comps.map(x => `<option value="${x.id}" ${x.id === c.company_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`)}
     ${fld('Должность', `<input name="position" value="${esc(c.position || '')}" placeholder="Собственник / застройщик">`)}`)}
   ${grid2(`${fld('Ответственный', `<select name="responsible_id">${userOptions(c.responsible_id || meId())}</select>`)}
     ${fld('Источник', `<select name="source">${sourceOptions(c.source)}</select>`)}`)}
   <p class="form-hint">${esc(responsibleHint())}</p>
   ${fld('Теги', `<input name="tags" value="${esc(c.tags || '')}" placeholder="VIP, каркас, участок">`)}
   ${fld('Заметки', `<textarea name="notes" rows="2" placeholder="Что важно помнить об этом клиенте">${esc(c.notes || '')}</textarea>`)}
   ${cfInputs('contacts', c, 2, 'optional')}
   <button class="btn primary w">${id ? 'Сохранить' : 'Создать контакт'}</button></form>`);
}

async function saveContact(e, id, allowDuplicate = false) {
  e.preventDefault();
  const b = cfCollect(e.target);
  b.company_id = b.company_id ? +b.company_id : null;
  b.responsible_id = b.responsible_id ? +b.responsible_id : null;
  const url = id ? '/api/contacts/' + id : '/api/contacts' + (allowDuplicate ? '' : '?check_duplicates=1');
  try {
    await api(url, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) });
  } catch (err) {
    const dup = err.data && err.data.duplicate;
    if (dup) {
      askConfirm(`Похоже, этот клиент уже есть в базе: ${dup.name}${dup.phone ? ' · ' + dup.phone : ''}. Открыть существующую карточку, чтобы не создавать дубль?`,
        () => openContactCard(dup.id),
        { okText: 'Открыть карточку', danger: false, extraText: 'Всё равно создать', onExtra: () => saveContact(e, id, true) });
      return false;
    }
    throw err;
  }
  if (!id) { state.contacts = []; state.cardCompanies = null; }
  closeModal(); toast(id ? 'Контакт сохранён' : 'Контакт создан'); render(); return false;
}

async function openDuplicates() {
  const d = await api('/api/contacts/duplicates');
  state.dupes = d.groups;
  openModal(`<h3>Поиск дублей контактов</h3><p><small>Найдено групп с одинаковым телефоном или почтой: ${d.groups.length} (дублей: ${d.total}). При объединении все сделки, задачи и чаты переносятся в выбранную карточку, остальные удаляются.</small></p>
   <div class="list" style="max-height:60vh">${d.groups.map((g, gi) => `<div class="card" style="box-shadow:none;border-color:var(--orange)">
     <b>Группа: ${esc(g.key)} · карточек: ${g.contacts.length}</b>
     <table class="mini" style="margin:8px 0">${g.contacts.map(c => `<tr><td><input type="radio" name="dupe_${gi}" value="${c.id}" checked></td><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || '')}</td><td>${esc(c.email || '')}</td></tr>`).join('')}</table>
     <button class="btn sm primary" onclick="mergeGroup(${gi})">Объединить в выбранную</button>
   </div>`).join('') || '<div class="empty">Дубликатов не найдено — база чистая</div>'}</div>`);
}
function mergeGroup(gi) {
  const g = state.dupes[gi];
  const keep = $(`input[name=dupe_${gi}]:checked`).value;
  const others = g.contacts.map(c => c.id).filter(id => id != keep);
  askConfirm('Объединить остальные карточки группы в выбранную? Их сделки, задачи и чаты перенесутся, а дубли удалятся.', async () => {
    await api('/api/contacts/merge', { method: 'POST', body: JSON.stringify({ keep_id: +keep, merge_ids: others }) });
    toast('Контакты объединены'); closeModal(); render();
  }, { okText: 'Объединить' });
}

/* ---------- companies ---------- */
async function companies(v) {
  const rows = await api('/api/companies');
  const q = (state.companyQuery || '').trim().toLowerCase();
  const shown = q ? rows.filter(c => `${c.name} ${c.inn || ''} ${c.phone || ''} ${c.email || ''}`.toLowerCase().includes(q)) : rows;
  v.innerHTML = `${viewerNote()}<div class="card"><div class="row" style="border:0;flex-wrap:wrap;gap:8px"><h3>Компании (${shown.length}${shown.length !== rows.length ? ` из ${rows.length}` : ''})</h3>
   <input id="companySearch" style="max-width:240px" placeholder="Поиск: название, ИНН, телефон, почта" value="${esc(state.companyQuery || '')}" oninput="liveSearch('companies',()=>setCompanyQuery(this.value))">
   ${canEdit() ? `<button class="btn sm primary" style="margin-left:auto" onclick="openCompany()">+ Компания</button>` : ''}</div>
  <div class="tbl-scroll"><table><tr><th>Компания</th><th>ИНН</th><th>Телефон</th><th>E-mail</th><th>Сайт</th><th></th></tr>
   ${shown.slice(0, state.companyLimit || 100).map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.inn || '—')}</td><td>${esc(c.phone || '—')}</td><td>${esc(c.email || '—')}</td><td>${siteHref(c.site) ? `<a href="${esc(siteHref(c.site))}" target="_blank" rel="noopener">${esc(c.site)}</a>` : '—'}</td><td style="white-space:nowrap">${canEdit() ? `<button class="btn sm" title="Открыть карточку компании" onclick="openCompany(${c.id})">${icon('edit', 13)} Изменить</button> <button class="btn sm danger" title="Удалить компанию" onclick="del('companies',${c.id})">${icon('close', 13)}</button>` : `<button class="btn sm" onclick="openCompany(${c.id})">Открыть</button>`}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Компаний не найдено — измените поиск или добавьте компанию</div></td></tr>'}</table></div>
   ${shown.length > (state.companyLimit || 100) ? `<div style="text-align:center;margin-top:10px"><button class="btn" onclick="showMoreCompanies()">Показать ещё</button></div>` : ''}</div>`;
}
async function openCompany(id) {
  const c = id ? await api('/api/companies/' + id) : {};
  if (id) await ensureStages();
  let related = '';
  if (id) {
    // в карточке компании сразу видно, кто с ней связан и какие сделки ведутся
    const [contacts, dealsData] = await Promise.all([api('/api/contacts'), api('/api/deals')]);
    const cs = contacts.filter(x => x.company_id === id);
    const ids = new Set(cs.map(x => x.id));
    const ds = dealsData.deals.filter(x => x.company_id === id || (x.contact_id && ids.has(x.contact_id)));
    related = `<hr><div class="cols"><div><h4>Контакты компании (${cs.length})</h4>
      <div class="list">${cs.map(x => `<div class="row"><span><a href="#" onclick="closeModal();openContactCard(${x.id});return false"><b>${esc(x.name)}</b></a><br><small>${esc(x.position || '')} ${esc(x.phone || '')}</small></span></div>`).join('') || '<small>Контактов пока нет — привяжите их в карточке клиента</small>'}</div></div>
      <div><h4>Сделки (${ds.length})</h4><div class="list">${ds.map(d => `<div class="row"><span><a href="#" onclick="closeModal();openDealCard(${d.id});return false"><b>${esc(d.title)}</b></a><br><small>${esc(stageLabel(d.stage))} · ${fmt(d.amount)}</small></span></div>`).join('') || '<small>Сделок пока нет</small>'}</div></div></div>`;
  }
  openModal(`<h3>${id ? 'Компания' : 'Новая компания'}</h3><form onsubmit="return saveCompany(event,${id || 'null'})">
   ${formLegend()}
   ${fld('Название организации', `<input name="name" required value="${esc(c.name || '')}" placeholder="ООО «СтройКаркас»">`, true)}
   ${grid2(`${fld('ИНН', `<input name="inn" value="${esc(c.inn || '')}" placeholder="10 или 12 цифр">`)}
     ${fld('Телефон', `<input name="phone" value="${esc(c.phone || '')}" placeholder="+7 495 000-00-00">`)}`)}
   ${grid2(`${fld('E-mail', `<input name="email" type="email" value="${esc(c.email || '')}" placeholder="info@stroykarkas.ru">`)}
     ${fld('Сайт', `<input name="site" value="${esc(c.site || '')}" placeholder="stroykarkas.ru">`)}`)}
   ${fld('Заметки', `<textarea name="notes" rows="2" placeholder="Договорённости, особенности работы">${esc(c.notes || '')}</textarea>`)}
   <button class="btn primary w">${id ? 'Сохранить' : 'Создать компанию'}</button></form>${related}`);
}

async function saveCompany(e, id) {
  e.preventDefault();
  await api(id ? '/api/companies/' + id : '/api/companies', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
  state.cardCompanies = null;
  closeModal(); toast('Компания сохранена'); render(); return false;
}

/* ---------- tasks ---------- */
async function tasks(v) {
  const all = await api('/api/tasks');
  await team();
  const today = todayISO();
  let rows = state.taskScope === 'mine' ? all.filter(t => t.responsible_id === meId() || !t.responsible_id) : all;
  if (state.taskFilter === 'today') rows = rows.filter(t => !t.done && normalizeDue(t.due).slice(0, 10) === today);
  if (state.taskFilter === 'overdue') rows = rows.filter(t => !t.done && normalizeDue(t.due) !== '' && normalizeDue(t.due).slice(0, 10) < today);
  const tq = (state.taskQuery || '').trim().toLowerCase();
  if (tq) rows = rows.filter(t => `${t.title} ${t.contact_name || ''} ${t.deal_title || ''} ${t.responsible_name || ''} ${t.result || ''}`.toLowerCase().includes(tq));
  const groups = [
    ['Просроченные', rows.filter(t => !t.done && normalizeDue(t.due).slice(0, 10) < today && normalizeDue(t.due) !== '')],
    ['Сегодня', rows.filter(t => !t.done && normalizeDue(t.due).slice(0, 10) === today)],
    ['Активные', rows.filter(t => !t.done && (normalizeDue(t.due).slice(0, 10) > today || !t.due))],
    ['Выполненные', rows.filter(t => t.done)]
  ];
  const types = { call: icon('phone', 14) + ' Звонок', meeting: icon('users', 14) + ' Встреча', message: icon('message', 14) + ' Сообщение', email: icon('email', 14) + ' Письмо', other: icon('task', 14) + ' Дело' };
  const mineOpen = all.filter(t => !t.done && (t.responsible_id === meId() || !t.responsible_id)).length;

  v.innerHTML = `<div class="card"><div class="row" style="border:0;flex-wrap:wrap;gap:8px"><b>Задач: ${rows.length}</b>
   <span class="tabs" style="margin:0"><button class="${state.taskScope === 'mine' ? 'active' : ''}" onclick="setTaskScope('mine')">Мои (${mineOpen})</button><button class="${state.taskScope === 'all' ? 'active' : ''}" onclick="setTaskScope('all')">Все (${all.filter(t => !t.done).length})</button></span>
   ${state.taskFilter ? `<span class="tag orange" style="display:inline-flex;gap:6px;align-items:center">${state.taskFilter === 'today' ? 'Только на сегодня' : 'Только просроченные'}<button class="btn sm" style="padding:0 4px" title="Сбросить фильтр" onclick="clearTaskFilter()">×</button></span>` : ''}
   ${state.taskQuery ? `<span class="tag grey" style="display:inline-flex;gap:6px;align-items:center">Поиск: ${esc(state.taskQuery)}<button class="btn sm" style="padding:0 4px" title="Очистить поиск" onclick="clearTaskQuery()">×</button></span>` : ''}
   <span class="tabs" style="margin:0"><button class="${state.taskView === 'list' ? 'active' : ''}" onclick="setTaskView('list')">${icon('list', 14)} Список</button><button class="${state.taskView === 'week' ? 'active' : ''}" onclick="setTaskView('week')">${icon('calendar', 14)} Неделя</button></span>
   <input id="taskSearch" style="max-width:220px" placeholder="Поиск по задачам" value="${esc(state.taskQuery || '')}" oninput="liveSearch('tasks',()=>setTaskQuery(this.value))">
   ${canEdit() ? `<button class="btn sm ${state.taskSelectMode ? 'active' : ''}" onclick="toggleTaskSelect()">${state.taskSelectMode ? 'Отменить выбор' : 'Выбрать несколько'}</button>` : ''}
   ${canEdit() ? `<button class="btn sm primary" style="margin-left:auto" onclick="openTask()">${icon('plus', 14)} Задача</button>` : ''}</div>
   ${state.taskScope === 'mine' ? `<p><small>Здесь задачи, назначенные на вас (${esc((state.me && state.me.name) || '')}), и неназначенные — их удобно разобрать первыми.</small></p>` : ''}
   ${state.taskView === 'week' ? weekCalendar(rows) : ''}
   ${state.taskView !== 'week' && state.taskSelectMode && canEdit() ? bulkBar('tasks', `<button class="btn sm" onclick="bulkApply('tasks','update',{done:1})">${icon('check', 14)} Выполнить выбранные</button> <button class="btn sm" onclick="bulkRescheduleTasks()">Перенести</button> <button class="btn sm danger" onclick="bulkApply('tasks','delete')">${icon('trash', 14)} Удалить</button>`) : ''}
   ${state.taskView === 'week' ? '' : groups.map(([t, list]) => list.length ? `<h3 style="margin-top:12px">${t} <small>${list.length}</small></h3>${list.slice(0, state.taskLimit || 50).map(x => {
     const meta = taskDueMeta(x.due, x.done);
     return `<div class="row taskrow ${selSet('tasks').has(x.id) ? 'selected' : ''}">
       <div style="display:flex;gap:10px;align-items:center;min-width:0;flex:1">
         ${state.taskSelectMode && canEdit() ? `<input type="checkbox" style="width:16px" ${selSet('tasks').has(x.id) ? 'checked' : ''} onchange="toggleSel('tasks',${x.id})" title="Выбрать для действия">` : ''}
         ${canEdit() ? `<button type="button" class="btn sm mark ${x.done ? 'done' : ''}" onclick="toggleTask(${x.id}, ${x.done ? 0 : 1})">${x.done ? icon('check', 13) + ' Выполнено' : 'Выполнить'}</button>` : ''}
         <span class="${x.done ? 'task-done' : ''}">${types[x.type] || icon('task', 14)} <b>${esc(x.title)}</b>${x.repeat && x.repeat !== 'none' ? ' <span class="tag grey" title="Повторяется">' + icon('repeat', 12) + ' ' + ({ daily: 'ежедневно', weekly: 'еженедельно', monthly: 'ежемесячно' }[x.repeat] || '') + '</span>' : ''}</span>
         <small class="${meta.overdue ? 'task-due-overdue' : (meta.label.startsWith('сегодня') ? 'task-due-today' : '')}">${esc(meta.label)}${x.contact_name ? ' · ' + esc(x.contact_name) : ''}${x.deal_title ? ' · ' + esc(x.deal_title) : ''}${x.responsible_name ? ' · ' + esc(x.responsible_name) : ''}</small>
       </div>
       ${canEdit() ? `<span style="display:flex;gap:6px;flex-shrink:0">
         ${x.done ? '' : `<button class="btn sm" title="Перенести на завтра" onclick="reschedule(${x.id},1)">Завтра</button><button class="btn sm" title="Перенести на неделю" onclick="reschedule(${x.id},7)">+7 дн.</button>`}
         <button class="btn sm" title="Изменить задачу" onclick="openTask(${x.id})">${icon('edit', 13)}</button>
         <button class="btn sm danger" title="Удалить задачу" onclick="del('tasks',${x.id})">${icon('close', 13)}</button>
       </span>` : ''}
     </div>`;
   }).join('')}${list.length > (state.taskLimit || 50) ? `<div style="margin:6px 0 10px"><small>Показано ${state.taskLimit || 50} из ${list.length}. <button class="btn sm" onclick="showMoreTasks()">Показать ещё</button></small></div>` : ''}` : '').join('') || `<div class="empty-state"><span class="ico">${icon('target', 36)}</span><b>Задач нет</b>${state.taskQuery || state.taskFilter
      ? 'Под этот фильтр ничего не подошло — измените условия поиска выше.'
      : 'Поставьте первое дело — звонок, встречу или письмо: кнопка «Задача» в правом верхнем углу списка и в шапке страницы.'}</div>`}</div>`;
}

function toggleTaskSelect() {
  state.taskSelectMode = !state.taskSelectMode;
  if (!state.taskSelectMode) clearSel('tasks');
  render();
}

function bulkRescheduleTasks() {
  const ids = [...selSet('tasks')];
  if (!ids.length) return;
  askInput({ title: 'Перенос выбранных задач', label: 'На сколько дней перенести срок выполнения?', value: '1', type: 'number', okText: 'Перенести' }, days => {
    if (!days || isNaN(days)) return;
    (async () => {
      for (const id of ids) {
        await reschedule(id, Number(days));
      }
      clearSel('tasks');
      toast(`Перенесено задач: ${ids.length}`);
      render();
    })();
  });
}

async function toggleTask(id, done, refreshId) {
  try {
    await api('/api/tasks/' + id, { method: 'PATCH', body: JSON.stringify({ done: done ? 1 : 0 }) });
    toast(done ? 'Задача выполнена' : 'Задача возвращена в работу');
    if (refreshId) await openDealCard(refreshId);
    else await render();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function reschedule(id, days) {
  try {
    const t = await api('/api/tasks/' + id);
    const curDue = normalizeDue(t.due);
    const time = /\d{2}:\d{2}/.test(curDue) ? curDue.slice(-5) : '10:00';
    // дату разбираем по частям: new Date('2026-01-01') — это UTC, а не местное время
    const m = curDue.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const baseDate = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
    const nextDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + days);
    const iso = `${isoDate(nextDate)} ${time}`;
    await api('/api/tasks/' + id, { method: 'PATCH', body: JSON.stringify({ due: iso }) });
    toast(`Задача перенесена на ${fmtDayMonth(iso.slice(0, 10))}`);
    render();
  } catch (e) { toast(e.message, 'err'); }
}

async function openTask(id, p = {}) {
  const t = id ? await api('/api/tasks/' + id) : p;
  if (!state.contacts.length) state.contacts = await api('/api/contacts');
  await team();
  const deals = state.deals.length ? state.deals : (await api('/api/deals')).deals;
  // срок по умолчанию: сегодня 18:00, а если уже вечер — завтра 12:00
  const nowT = new Date();
  const defDay = new Date(nowT); let defTime = '18:00';
  if (nowT.getHours() >= 18) { defDay.setDate(defDay.getDate() + 1); defTime = '12:00'; }
  const dueVal = t.due ? normalizeDue(t.due).replace(' ', 'T').slice(0, 16) : `${isoDate(defDay)}T${defTime}`;

  // Если задачу ставят из карточки, клиент и сделка уже известны: показываем их
  // подписью, а не длинным списком. Понадобится другое — «изменить».
  const contactPick = `<select name="contact_id"><option value="">— нет —</option>${state.contacts.map(c => `<option value="${c.id}" ${c.id === t.contact_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
  const dealPick = `<select name="deal_id"><option value="">— нет —</option>${deals.map(d => `<option value="${d.id}" ${d.id === t.deal_id ? 'selected' : ''}>${esc(d.title)}</option>`).join('')}</select>`;
  window.__taskLinkSel = { contact_id: contactPick, deal_id: dealPick };
  const preContact = t.contact_id ? state.contacts.find(c => c.id === +t.contact_id) : null;
  const preDeal = t.deal_id ? deals.find(d => d.id === +t.deal_id) : null;
  const linkSlot = (kind, obj, ico) => obj
    ? `<div class="task-link-slot" data-kind="${kind}"><span class="task-link">${icon(ico, 13)} <b>${esc(obj.name || obj.title)}</b> <button type="button" class="link-btn" onclick="taskUnlink(this,'${kind}')">изменить</button></span><input type="hidden" name="${kind}" value="${obj.id}"></div>`
    : `<div class="task-link-slot" data-kind="${kind}">${kind === 'contact_id' ? contactPick : dealPick}</div>`;

  openModal(`<h3>${id ? 'Задача' : 'Новая задача'}</h3><form onsubmit="return saveTask(event,${id || 'null'})">
   ${formLegend()}
   ${fld('Что сделать', `<input name="title" required value="${esc(t.title || '')}" placeholder="Позвонить, уточнить детали">`, true)}
   ${grid2(`${fld('Срок', `<input name="due" type="datetime-local" value="${esc(dueVal)}"><small id="dueHint">${esc(t.due ? '' : (defTime === '18:00' ? 'по умолчанию — сегодня вечером' : 'по умолчанию — завтра в 12:00'))}</small>`)}
     ${fld('Тип', `<select name="type">${Object.entries({ call: 'Звонок', meeting: 'Встреча', message: 'Сообщение', email: 'Письмо', other: 'Другое' }).map(([k, n]) => `<option value="${k}" ${k === (t.type || 'call') ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}`)}
   <div class="due-chips" title="Быстрый выбор срока — поле «Срок» заполнится автоматически">
     <span class="due-chips-label">Быстро:</span>
     <button type="button" class="btn sm chip" onclick="setTaskDue(this,'today')">сегодня 18:00</button>
     <button type="button" class="btn sm chip" onclick="setTaskDue(this,'tomorrow')">завтра 10:00</button>
     <button type="button" class="btn sm chip" onclick="setTaskDue(this,'week')">через неделю</button>
     <button type="button" class="btn sm chip ghost" onclick="setTaskDue(this,'clear')">без срока</button>
   </div>
   <div class="task-links"><div class="task-link-col"><span class="task-link-cap">Клиент</span>${linkSlot('contact_id', preContact, 'contact')}</div><div class="task-link-col"><span class="task-link-cap">Сделка</span>${linkSlot('deal_id', preDeal, 'pipe')}</div></div>
   ${grid2(`${fld('Ответственный', `<select name="responsible_id">${userOptions(t.responsible_id || meId())}</select>`)}
     ${fld('Приоритет', `<select name="priority"><option value="normal" ${t.priority === 'normal' ? 'selected' : ''}>Обычный</option><option value="high" ${t.priority === 'high' ? 'selected' : ''}>Высокий</option><option value="low" ${t.priority === 'low' ? 'selected' : ''}>Низкий</option></select>`)}`)}
   ${fld('Повтор задачи', `<select name="repeat">${[['none', 'Не повторять'], ['daily', 'Каждый день'], ['weekly', 'Каждую неделю'], ['monthly', 'Каждый месяц']].map(([k, n]) => `<option value="${k}" ${k === (t.repeat || 'none') ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}
   ${fld('Результат (после выполнения)', `<textarea name="result" rows="2" placeholder="Договорились на 15:00 — пришлём смету сегодня">${esc(t.result || '')}</textarea>`)}
   <button class="btn primary w">${id ? 'Сохранить' : 'Поставить задачу'}</button></form>`);
}

// Вернуть список выбора, если привязанный клиент или сделка не подходят
function taskUnlink(btn, kind) {
  const slot = btn.closest('.task-link-slot');
  const html = window.__taskLinkSel && window.__taskLinkSel[kind];
  if (slot && html) slot.innerHTML = html;
}
// Быстрые сроки: один клик вместо прокрутки календаря. Точное время — в поле «Срок».
function setTaskDue(btn, mode) {
  const input = btn.closest('form')?.querySelector('input[name=due]');
  if (!input) return;
  const hint = $('#dueHint');
  if (mode === 'clear') { input.value = ''; if (hint) hint.textContent = 'без срока — задача не попадёт в календарь'; return; }
  const d = new Date();
  let hh = 18, mm = 0;
  if (mode === 'tomorrow') { d.setDate(d.getDate() + 1); hh = 10; }
  if (mode === 'week') { d.setDate(d.getDate() + 7); hh = 10; }
  input.value = `${isoDate(d)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  if (hint) hint.textContent = '';
}
async function saveTask(e, id) {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target));
  b.contact_id = b.contact_id ? +b.contact_id : null;
  b.deal_id = b.deal_id ? +b.deal_id : null;
  b.responsible_id = b.responsible_id ? +b.responsible_id : null;
  if (b.due) b.due = normalizeDue(b.due.replace('T', ' '));
  await api(id ? '/api/tasks/' + id : '/api/tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) });
  closeModal(); toast('Задача сохранена'); render(); return false;
}

/* ---------- products ---------- */
async function products(v) {
  const rows = await api('/api/products');
  const q = (state.productQuery || '').trim().toLowerCase();
  const onlyActive = state.productScope !== 'all';
  const shown = rows.filter(p => (!onlyActive || p.active) && (!q || `${p.name} ${p.sku || ''} ${p.unit || ''} ${p.note || ''}`.toLowerCase().includes(q)));
  const archived = rows.filter(p => !p.active).length;
  const onSale = rows.filter(p => p.active);
  const noPrice = onSale.filter(p => !(Number(p.price) > 0)).length;
  v.innerHTML = `${viewerNote()}<div class="card"><div class="row" style="border:0;flex-wrap:wrap;gap:8px"><h3>Каталог и прайс-лист (${shown.length})</h3>
   <span class="tabs" style="margin:0"><button class="${onlyActive ? 'active' : ''}" onclick="setProductScope('active')">В продаже</button><button class="${!onlyActive ? 'active' : ''}" onclick="setProductScope('all')">Все${archived ? ` (+${archived} в архиве)` : ''}</button></span>
   <input id="productSearch" style="max-width:230px" placeholder="Поиск: название, артикул, примечание" value="${esc(state.productQuery || '')}" oninput="liveSearch('products',()=>setProductQuery(this.value))">
   <button class="btn sm" title="Скачать прайс-лист таблицей CSV — откроется в Excel" onclick="download('/api/prices/export?scope=ours','price-list.csv')">${icon('download', 13)} Скачать прайс</button>
   ${amAdmin() ? `<button class="btn sm" title="Загрузить прайс из Excel или CSV" onclick="openPriceImport(null,'ours')">${icon('upload', 13)} Загрузить из файла</button>` : ''}
   ${amAdmin() ? `<button class="btn sm primary" style="margin-left:auto" onclick="openProduct()">+ Товар / проект</button>` : ''}</div>
  <p class="form-hint" style="margin:-2px 0 10px">Это <b>один список</b>: отсюда позиции берутся в сделки, и эти же цены CRM сравнивает с ценами конкурентов (раздел «Конкуренты» → «Наш прайс-лист»). В продаже: <b>${onSale.length}</b>${archived ? ` · в архиве: ${archived}` : ''}${noPrice ? ` · без цены: ${noPrice} — в сравнении они не участвуют` : ''}.</p>
  ${amAdmin() ? '' : '<p class="form-hint" style="margin:-6px 0 10px">Прайс-лист меняет администратор. Нужной позиции нет? Добавьте её прямо в сделку — сумма пересчитается, а общий прайс останется неизменным.</p>'}
  <div class="tbl-scroll"><table><tr><th>Артикул</th><th>Название</th><th>Цена</th><th>Ед.</th><th>В продаже</th><th></th></tr>
   ${shown.map(p => `<tr><td><code>${esc(p.sku || '—')}</code></td><td><b>${esc(p.name)}</b>${p.note ? `<br><small>${esc(p.note)}</small>` : ''}</td><td>${Number(p.price) > 0 ? fmt(p.price) : '<span class="tag grey">цена не указана</span>'}</td><td>${esc(p.unit || 'шт')}</td><td>${p.active ? 'Да' : '<span class="tag grey">Архив</span>'}</td><td style="white-space:nowrap">${amAdmin() ? `<button class="btn sm" title="Изменить позицию" onclick="openProduct(${p.id})">${icon('edit', 13)} Изменить</button> <button class="btn sm danger" title="Удалить из каталога" onclick="del('products',${p.id})">${icon('close', 13)}</button>` : `<button class="btn sm" title="Посмотреть позицию" onclick="openProduct(${p.id})">Открыть</button>`}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Ничего не найдено — измените фильтр или добавьте позицию</div></td></tr>'}</table></div></div>`;
}
async function openProduct(id) {
  const p = id ? await api('/api/products/' + id) : {};
  openModal(`<h3>${id ? 'Товар / проект' : 'Новая позиция каталога'}</h3><form onsubmit="return saveProduct(event,${id || 'null'})">
   ${formLegend()}
   ${fld('Название', `<input name="name" required value="${esc(p.name || '')}" placeholder="Каркасный дом «Скандинавия 8×10»">`, true)}
   ${fld('Цена (' + CUR() + ')', `<input name="price" type="number" required value="${p.price || 0}" placeholder="0">`, true)}
   ${grid2(`${fld('Единица измерения', `<input name="unit" value="${esc(p.unit || 'шт')}" placeholder="шт, м², услуга">`)}
     ${fld('Артикул / код', `<input name="sku" value="${esc(p.sku || '')}" placeholder="DOM-SKAN-810">`)}`)}
   ${fld('Примечание', `<input name="note" value="${esc(p.note || '')}" placeholder="под ключ, срок 8 недель">`)}
   <p class="form-hint" style="margin:-6px 0 10px">Примечание видно в каталоге и попадает в скачанный прайс-лист. Артикул помогает загрузке из файла: позиция с тем же артикулом обновится, а не добавится второй раз.</p>
   <label class="check-line"><input type="checkbox" name="active" style="width:auto" ${p.active === 0 ? '' : 'checked'}><span>Показывать в продаже <small>(снимите галочку, чтобы убрать в архив)</small></span></label>
   <button class="btn primary w">${id ? 'Сохранить' : 'Добавить в каталог'}</button></form>`);
  if (!amAdmin()) lockForm($('#modalBody'), 'Прайс-лист меняет администратор. Позицию, которой нет в каталоге, можно добавить прямо в сделку.');
}
async function saveProduct(e, id) {
  e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
  b.price = num(b.price); b.active = b.active ? 1 : 0;
  await api(id ? '/api/products/' + id : '/api/products', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) });
  state.ourPrices = null; // каталог и прайс-лист — одно и то же, кэш цен сбрасываем
  closeModal(); toast('Позиция сохранена'); render(); return false;
}

/* ---------- analytics ---------- */
async function analytics(v) {
  const a = await api('/api/analytics');
  const max = Math.max(...a.stages.map(s => s.sum), 1);
  const plan = a.plan || {};
  v.innerHTML = `
  <div class="grid">
   <div class="kpi" title="${esc(plan.month ? monthText(plan.month) : 'текущий месяц')}"><i>${icon('money', 20)}</i><span>Продано за ${esc(plan.month ? monthShort(plan.month) : 'этот месяц')}</span><b class="green">${fmt(plan.fact)}</b>${plan.target ? `<small class="${plan.percent >= 100 ? 'green' : ''}">план ${fmt(plan.target)} · выполнено ${plan.percent}%</small>` : '<small>план не задан — укажите цель внизу</small>'}</div>
   <div class="kpi"><i>${icon('analytics', 20)}</i><span>Конверсия воронки</span><b class="green">${a.conversion}%</b><small>успешных к закрытым</small></div>
   <div class="kpi"><i>${icon('money', 20)}</i><span>Средний чек сделки</span><b>${fmt(a.avgCheck)}</b></div>
   <div class="kpi"><i>${icon('pipe', 20)}</i><span>Прогноз (сделки в работе)</span><b class="accent">${fmt(a.forecast)}</b></div>
  </div>
  <div class="cols"><div>
   <div class="card"><h3>Сделки по этапам воронки</h3>${a.stages.map(s => `<p style="display:flex;justify-content:space-between;margin:8px 0 2px"><span>${esc(s.name)} · ${s.count}</span><b>${fmt(s.sum)}</b></p><div class="bar"><i style="width:${Math.round(s.sum / max * 100)}%"></i></div>`).join('')}</div>
   <div class="card"><h3>Выручка по месяцам</h3>
    <p class="form-hint" style="margin-top:-2px">Считаем месяц, в котором сделка закрылась успешно. Столбики — сумма продаж, под ними число сделок.</p>
    ${(a.byMonth || []).length ? (a.byMonth || []).map(m => {
      const maxM = Math.max(...(a.byMonth || []).map(x => x.s), 1);
      return `<p style="display:flex;justify-content:space-between;margin:8px 0 2px"><span>${esc(monthText(m.ym))}</span><b>${fmt(m.s)}</b></p><div class="bar"><i style="width:${Math.round((m.s || 0) / maxM * 100)}%"></i></div><p class="form-hint" style="margin:-8px 0 10px">сделок: ${m.n}</p>`;
    }).join('') : '<p><small>Успешных сделок пока нет — как только первая закроется, здесь появится её месяц.</small></p>'}</div>
   <div class="card"><h3>Сделки по источникам</h3><table><tr><th>Источник</th><th>Сделок</th><th>Сумма</th></tr>${a.bySource.map(x => `<tr><td>${esc(sourceLabel(x.name))}</td><td>${x.count}</td><td><b>${fmt(x.sum)}</b></td></tr>`).join('') || '<tr><td colspan="3"><small>Пока нет сделок</small></td></tr>'}</table></div>
   <div class="card"><h3>План продаж — ${esc(monthShort(plan.month || isoMonth()))}</h3>
    <p><small>План — цель на <b>${esc(monthText(plan.month || isoMonth()))}</b>, факт — сумма успешных сделок, закрытых за этот же месяц. Они стоят рядом, чтобы сразу видеть, сколько осталось продать до конца месяца: план минус факт. План не мешает работе — это ориентир для команды.</small></p>
    ${(state.me && state.me.role) === 'admin' ? `<form onsubmit="return setSalesPlan(event)"><div style="display:flex;gap:10px;align-items:flex-end"><label style="margin:0;flex:1">Целевая выручка на месяц (${CUR()})<input name="target" type="number" value="${plan.target || ''}" placeholder="3000000"></label><button class="btn primary">Сохранить цель</button></div></form>` : `<p><small>Цель на месяц задаёт администратор. Текущая цель: <b>${plan.target ? fmt(plan.target) : 'не задана'}</b>.</small></p>`}</div>
  </div><div>
   <div class="card"><h3>Результаты по менеджерам</h3><table><tr><th>Менеджер</th><th>Сделок</th><th>Сумма</th></tr>${a.byManager.map(x => `<tr><td>${esc(x.name)}</td><td>${x.count}</td><td><b>${fmt(x.sum)}</b></td></tr>`).join('') || '<tr><td colspan="3"><small>Нет данных</small></td></tr>'}</table></div>
   <div class="card"><h3>Причины проигрыша сделок</h3><table><tr><th>Причина</th><th>Число</th><th>Сумма потерь</th></tr>${a.byLoss.map(x => `<tr><td>${esc(x.name || 'Не указана')}</td><td>${x.count}</td><td><b>${fmt(x.sum)}</b></td></tr>`).join('') || '<tr><td colspan="3"><small>Сделок в отказе нет</small></td></tr>'}</table></div>
  </div></div>`;
}
async function setSalesPlan(e) {
  e.preventDefault(); const target = new FormData(e.target).get('target');
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ SALES_TARGET: target }) });
  toast('План продаж сохранён'); render(); return false;
}

/* ---------- competitors view ---------- */
// Уровень риска сервер считает словами — цвета подбираем к тем же словам,
// иначе плашка всегда оставалась серой и подписи «нет» вместо уровня.
const RISK_COLORS = { низкий: '#16a34a', умеренный: '#ca8a04', повышенный: '#f97316', высокий: '#dc2626' };
const RISK_LABELS = { низкий: 'низкий', умеренный: 'умеренный', повышенный: 'повышенный', высокий: 'высокий' };
const riskColor = level => RISK_COLORS[String(level || '').toLowerCase()] || '#64748b';

async function competitorsView(v) {
  const list = await api('/api/competitors');
  const ours = await api('/api/prices?scope=ours').catch(() => ({ rows: [] }));
  const q = (state.compQuery || '').trim().toLowerCase();
  const shown = q ? list.filter(c => `${c.name} ${c.inn || ''} ${c.city || ''} ${c.website || ''} ${c.phone || ''}`.toLowerCase().includes(q)) : list;
  v.innerHTML = `${viewerNote()}
  <div class="card toolbar">
    <input id="compSearch" style="flex:1;min-width:240px" placeholder="Название или ИНН конкурента — найдём и проверим по открытым источникам" onkeydown="if(event.key==='Enter')findCompetitor(this.value)">
    ${canEdit() ? `<button class="btn primary" onclick="findCompetitor(document.getElementById('compSearch').value)">${icon('search', 14)} Найти и проверить</button>
    <button class="btn" onclick="openCompetitor()">+ Добавить вручную</button>` : ''}
    <button class="btn" title="Наш прайс-лист — это раздел «Каталог»: те же позиции и цены" onclick="openOurPrices()">${icon('excel', 14)} Наш прайс-лист${ours.rows.length ? ` (${ours.rows.length})` : ''}</button>
  </div>
  <div class="card">
   <div class="row" style="border:0;flex-wrap:wrap;gap:8px">
     <h3>Конкуренты на контроле (${shown.length}${shown.length !== list.length ? ` из ${list.length}` : ''})</h3>
     <input id="compFilter" style="max-width:250px" placeholder="Поиск по списку: название, ИНН, город" value="${esc(state.compQuery || '')}" oninput="liveSearch('compList',()=>setCompQuery(this.value))">
     ${state.compQuery ? `<button class="btn sm ghost" onclick="clearCompQuery()">Сбросить</button>` : ''}
   <div class="tbl-scroll"><table><tr><th>Конкурент</th><th>ИНН</th><th>Город / сайт</th><th>Риск</th><th>Проверка</th><th>Цены</th><th></th></tr>
    ${shown.map(c => `<tr>
     <td><a href="#" onclick="openCompetitorCard(${c.id});return false"><b>${esc(c.name)}</b></a></td>
     <td><code>${esc(c.inn || '—')}</code></td><td>${esc(c.city || '—')}<br><small>${siteHref(c.website) ? `<a href="${esc(siteHref(c.website))}" target="_blank" rel="noopener">${esc(c.website)}</a>` : ''}</small></td>
     <td>${c.risk === null || c.risk === undefined ? '<span class="tag grey">не проверялся</span>' : `<span class="tag risk-tag" style="--risk:${esc(riskColor(c.level))}" title="Риск-оценка от 0 до 100 по открытым источникам">риск ${c.risk} · ${esc(RISK_LABELS[String(c.level || '').toLowerCase()] || c.level || '—')}</span>`}</td>
     <td><small>${esc(dt(c.checked_at) || 'не проверялся')}</small></td>
     <td><small>позиций: ${c.prices || 0}</small></td>
     <td style="white-space:nowrap">
       <button class="btn sm" onclick="openCompetitorCard(${c.id})">Отчёт</button>
       ${canEdit() ? `<button class="btn sm" onclick="checkCompetitor(${c.id})">${icon('refresh', 13)} Проверить</button>
       <button class="btn sm" title="Изменить карточку конкурента" onclick="openCompetitor(${c.id})">${icon('edit', 13)}</button>
       <button class="btn sm danger" title="Удалить конкурента" onclick="delCompetitor(${c.id})">${icon('close', 13)}</button>` : ''}
     </td></tr>`).join('') || `<tr><td colspan="7"><div class="empty">${q ? 'Ничего не найдено — измените поиск' : 'Конкурентов пока нет — введите название выше'}</div></td></tr>`}
   </table></div>
  </div>`;
}

/* ---------- наш прайс-лист: это каталог ---------- */
// Название приводим к одному виду, чтобы «Дом 8×10» и «дом 8x10» считались одной позицией.
function normItem(s) { return String(s || '').toLowerCase().replace(/[«»"'`]/g, '').replace(/[^a-zа-я0-9]+/gi, ' ').trim(); }
// Похожесть названий (0..1) — тот же разбор, что на сервере: «Баня каркасная 4×6»
// и «Баня 4×6» считаются одной позицией, а разные комплектации не склеиваются.
function nameScore(a, b) {
  const A = new Set(normItem(a).split(' ').filter(Boolean));
  const B = new Set(normItem(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  if (!shared) return 0;
  const union = new Set([...A, ...B]).size;
  const jaccard = shared / union;
  return shared === Math.min(A.size, B.size) ? Math.max(jaccard, 0.8) : jaccard;
}
const MATCH_MIN = 0.6;
function comparePrices(ours, theirs) {
  const list = theirs || [];
  const map = new Map(list.map(r => [normItem(r.item), r]));
  return (ours || []).map(o => {
    const k = normItem(o.item);
    if (!k || !(Number(o.price) > 0)) return null; // позиция без цены в сравнении не участвует
    let hit = map.get(k) || null, best = 0;
    if (!hit) for (const r of list) { const sc = nameScore(o.item, r.item); if (sc >= MATCH_MIN && sc > best) { best = sc; hit = r } }
    return hit ? { item: o.item, ours: Number(o.price) || 0, theirs: Number(hit.price) || 0 } : null;
  }).filter(Boolean);
}
function ourPriceRows(rows) {
  return `<tr><th>Позиция</th><th>Цена</th><th>Ед.</th><th>Артикул</th></tr>` + (rows.map(r => `<tr><td><b>${esc(r.item)}</b>${r.note ? `<br><small>${esc(r.note)}</small>` : ''}</td><td>${fmt(r.price)}</td><td>${esc(r.unit || 'шт')}</td><td><code>${esc(r.sku || '—')}</code></td></tr>`).join('')
    || `<tr><td colspan="4"><div class="empty">Прайс-лист пуст${amAdmin() ? ' — добавьте позиции в каталоге или загрузите их файлом' : ' — позиции добавит администратор в разделе «Каталог»'}</div></td></tr>`);
}
function filterOurPrices(q) {
  const needle = String(q || '').trim().toLowerCase();
  const rows = (state.ourPrices || []).filter(r => `${r.item} ${r.sku || ''} ${r.unit || ''} ${r.note || ''}`.toLowerCase().includes(needle));
  const t = $('#ourPriceTable');
  if (t) t.innerHTML = ourPriceRows(rows);
  const c = $('#ourPriceCount');
  if (c) c.textContent = needle ? `Найдено позиций: ${rows.length}` : '';
}
// Кнопка «Наш прайс-лист» показывает каталог: цены меняет администратор.
// backId — карточка конкурента, из которой открыли прайс: возвращаем человека назад.
async function openOurPrices(backId = null) {
  const d = await api('/api/prices?scope=ours').catch(() => ({ rows: [] }));
  const rows = d.rows || [];
  state.ourPrices = rows;
  state.ourPricesBack = backId || null;
  const sum = rows.reduce((a, r) => a + (Number(r.price) || 0), 0);
  openModal(`<h3>${icon('excel', 18)} Наш прайс-лист</h3>
   <p class="form-hint">Ваш прайс-лист: позиции подставляются в сделки, и эти же цены сравниваются с ценами конкурентов. Позиций: <b>${rows.length}</b>${rows.length ? ` · суммарно на <b>${fmt(sum)}</b>` : ''}.</p>
   <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
     <button class="btn sm" title="Скачать прайс-лист таблицей CSV" onclick="download('/api/prices/export?scope=ours','price-list.csv')">${icon('download', 13)} Скачать прайс (CSV)</button>
     ${amAdmin() ? `<button class="btn sm primary" onclick="openPriceImport(null,'ours')">${icon('upload', 13)} Загрузить из файла</button>` : ''}
     <button class="btn sm" title="Открыть раздел «Каталог» — там прайс и редактируется" onclick="closeModal();go('products')">${icon('products', 13)} Открыть каталог</button>
     ${state.ourPricesBack ? `<button class="btn sm" onclick="openCompetitorCard(${state.ourPricesBack})">${icon('arrowLeft', 13)} Назад к отчёту</button>` : ''}
   </div>
   ${amAdmin() ? '' : '<p class="form-hint">Цены обновляет администратор в разделе «Каталог». Вам прайс нужен, чтобы сравнить его с ценами конкурента в переговорах.</p>'}
   <input id="ourPriceFilter" placeholder="Поиск по позициям" oninput="filterOurPrices(this.value)" style="margin-bottom:8px">
   <p class="form-hint" id="ourPriceCount" style="margin:0 0 6px"></p>
   <div class="list" style="max-height:50vh"><table class="mini" id="ourPriceTable">${ourPriceRows(rows)}</table></div>`);
}

// Одно сообщение на действие: кнопка показывает «идёт проверка», тост — только результат.
function busyButton(matcher, on) {
  const btn = $$('#view .btn, #modalBody .btn').find(b => matcher.test(b.textContent || ''));
  if (!btn) return null;
  btn.classList.toggle('loading', on);
  btn.disabled = on;
  return btn;
}
async function findCompetitor(query) {
  const q = String(query || '').trim();
  if (!q) {
    toast('Введите название или ИНН конкурента');
    const field = $('#compSearch');
    if (field) field.focus();
    return;
  }
  const btn = busyButton(/Найти и проверить/, true);
  try {
    // проверка по открытым источникам может занять больше стандартных 30 секунд
    const res = await api('/api/competitors/find', { method: 'POST', body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(120000) });
    const id = (res.competitor && res.competitor.id) || res.id;
    toast(res.created ? 'Конкурент добавлен и проверен' : 'Проверка обновлена');
    await render();
    if (id) openCompetitorCard(id);
  } catch (e) { toast(e.message, 'err'); }
  finally { busyButton(/Найти и проверить/, false); }
}

async function checkCompetitor(id) {
  const btn = busyButton(/Проверить сейчас|Проверить/, true);
  try {
    await api(`/api/competitors/${id}/check`, { method: 'POST', signal: AbortSignal.timeout(120000) });
    toast('Проверка завершена — отчёт обновлён');
    await render();
    openCompetitorCard(id);
  } catch (e) { toast(e.message, 'err'); }
  finally { busyButton(/Проверить сейчас|Проверить/, false); }
}

function delCompetitor(id) {
  askConfirm('Удалить конкурента вместе со всеми его отчётами? Действие необратимо.', async () => {
    await api('/api/competitors/' + id, { method: 'DELETE' });
    toast('Удалено'); render();
  }, { okText: 'Удалить' });
}

async function openCompetitor(id) {
  const c = id ? await api('/api/competitors/' + id) : {};
  openModal(`<h3>${id ? 'Конкурент' : 'Новый конкурент'}</h3><form onsubmit="return saveCompetitor(event,${id || 'null'})">
   <label>Название организации*<input name="name" required value="${esc(c.name || '')}" placeholder="ООО «БрусДом»"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>ИНН<input name="inn" value="${esc(c.inn || '')}"></label><label>ОГРН<input name="ogrn" value="${esc(c.ogrn || '')}"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Город<input name="city" value="${esc(c.city || '')}"></label><label>Сайт<input name="website" value="${esc(c.website || '')}" placeholder="brusdom.ru"></label></div>
   <label>Телефон<input name="phone" value="${esc(c.phone || '')}"></label>
   <label>Ссылка на прайс<input name="price_url" value="${esc(c.price_url || '')}" placeholder="https://…/price.csv"></label>
   <p class="form-hint" style="margin-top:-4px">Если конкурент публикует прайс таблицей, укажите адрес — CRM сама подтянет его при каждой проверке, и позиции попадут в сравнение цен.</p>
   <label>Заметки<textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></label>
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveCompetitor(e, id) {
  e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
  await api(id ? '/api/competitors/' + id : '/api/competitors', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) });
  closeModal(); toast('Сохранено'); render(); return false;
}

async function openCompetitorCard(id) {
  const c = await api('/api/competitors/' + id);
  if (!state.ourPrices) state.ourPrices = (await api('/api/prices?scope=ours').catch(() => ({ rows: [] }))).rows || [];
  state.compTab = state.compTab || 'report';
  openModal(`
   <div class="modal-head">
     <div><h3>${esc(c.name)}</h3><small>ИНН: ${esc(c.inn || '—')} · ${esc(c.city || '')}</small></div>
     <div style="display:flex;gap:6px;flex-wrap:wrap">
       ${canEdit() ? `<button class="btn sm primary" onclick="checkCompetitor(${c.id})">${icon('refresh', 13)} Проверить сейчас</button>
       <button class="btn sm" onclick="openPriceImport(${c.id},'theirs')">${icon('excel', 13)} Загрузить прайс</button>` : ''}
       ${(c.prices || []).length ? `<button class="btn sm" title="Скачать прайс конкурента таблицей CSV" onclick="download('/api/prices/export?scope=competitor&competitor=${c.id}','competitor-prices.csv')">${icon('download', 13)} Скачать прайс</button>` : ''}
     </div>
   </div>
   <div class="tabs" style="margin-bottom:12px">
     <button class="${state.compTab === 'report' ? 'active' : ''}" onclick=\"setCompTab('report',${id})\">Сводный отчёт</button>
     <button class="${state.compTab === 'sources' ? 'active' : ''}" onclick=\"setCompTab('sources',${id})\">Источники (${(c.checks || []).length})</button>
     <button class="${state.compTab === 'debts' ? 'active' : ''}" onclick=\"setCompTab('debts',${id})\">Долги и суды</button>
     <button class="${state.compTab === 'reviews' ? 'active' : ''}" onclick=\"setCompTab('reviews',${id})\">Отзывы (${(c.reviews || []).length})</button>
     <button class="${state.compTab === 'prices' ? 'active' : ''}" onclick=\"setCompTab('prices',${id})\">Сравнение цен</button>
     <button class="${state.compTab === 'history' ? 'active' : ''}" onclick=\"setCompTab('history',${id})\">История</button>
   </div>
   <div id="compTabBody">${competitorTab(c)}</div>`);
}

// Отзывов здесь нет намеренно: для них есть своя вкладка «Отзывы» с автором и
// оценкой. Держать два места для одного смысла — значит расходиться в данных.
const FINDING_KINDS = ['долги', 'суды', 'связи', 'прочее'];

// Банк данных ФССП, «Связи» на Rusprofile и отзывы на Авито автоматически не
// отдаются: API закрыт, сайт закрыт от роботов, данные за платным доступом.
// Поэтому то, что менеджер посмотрел сам, записывается сюда и попадает в отчёт
// и в оценку риска — иначе проверка испаряется вместе с закрытой вкладкой.
function findingsBlock(c) {
  const finds = c.findings || [];
  return `<hr><div class="row" style="border:0"><h4>Найдено вручную (${finds.length})</h4></div>
   <p class="form-hint">Запишите, что увидели в реестре: сумма долга, число дел, связанные организации. Запись учитывается в оценке риска.</p>
   <div class="list">${finds.map(f => `<div class="row"><span><b>${esc(f.kind || 'прочее')}</b>${f.title ? ': ' + esc(f.title) : ''}
      ${f.amount ? `<br><small>${f.kind === 'суды' ? esc(String(Math.round(f.amount))) + ' дел' : esc(fmt(f.amount))}</small>` : ''}
      ${f.note ? `<br><small>${esc(f.note)}</small>` : ''}
      <br><small>${esc(f.author || '')} · ${esc(dt(f.created_at))}${f.source_url ? ` · <a href="${esc(f.source_url)}" target="_blank" rel="noopener">источник</a>` : ''}</small></span>
      ${canEdit() ? `<button class="btn sm ghost" onclick="deleteFinding(${f.id},${c.id})">Удалить</button>` : ''}</div>`).join('') || '<small>Записей пока нет</small>'}</div>
   ${canEdit() ? `<form onsubmit="return saveFinding(event,${c.id})" style="margin-top:10px">
     <div style="display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:end">
      <label>Что нашли<select name="kind">${FINDING_KINDS.map(k => `<option value="${k}">${k}</option>`).join('')}</select></label>
      <label>Описание<input name="title" placeholder="3 исполнительных производства, долг по договору поставки" required maxlength="200"></label>
      <label>Сумма или число<input name="amount" type="number" min="0" step="1" placeholder="450000"></label>
      <button class="btn primary">Записать</button>
     </div>
     <label>Ссылка на источник (необязательно)<input name="source_url" placeholder="https://fssp.gov.ru/iss/ip"></label>
    </form>` : ''}`;
}

async function saveFinding(e, cid) {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target));
  try {
    await api(`/api/competitors/${cid}/findings`, { method: 'POST', body: JSON.stringify(b) });
    toast('Находка записана — пересчитайте отчёт, чтобы она попала в оценку риска');
    openCompetitorCard(cid);   // карточка перечитывается с сервера вместе с находками
  } catch (err) { toast(err.message, 'err'); }
  return false;
}

function deleteFinding(fid, cid) {
  askConfirm('Удалить запись о находке? Она перестанет учитываться в оценке риска.', async () => {
    try {
      await api(`/api/competitors/${cid}/findings/${fid}`, { method: 'DELETE' });
      toast('Запись удалена');
      openCompetitorCard(cid);
    } catch (err) { toast(err.message, 'err'); }
  });
}

// Ссылки на реестры берём из отчёта: их уже собрал сервер по ИНН, ОГРН и названию.
// Держать два зашитых адреса в разметке — значит показывать меньше, чем CRM знает.
function reportLinks(rep, c) {
  const links = (rep && Array.isArray(rep.links) && rep.links.length) ? rep.links : [
    { label: 'Rusprofile: поиск по названию', url: 'https://www.rusprofile.ru/search?query=' + encodeURIComponent(c.inn || c.name || '') },
    { label: 'ФНС: Прозрачный бизнес', url: 'https://pb.nalog.ru/search.html?query=' + encodeURIComponent(c.inn || c.name || '') },
  ];
  return `<p class="form-hint" style="margin-bottom:6px">Ссылки для ручной проверки — каждая открывается в новой вкладке:</p>
   <div class="report-links">${links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>`;
}

function competitorTab(c) {
  const rep = c.report || {};
  const checks = c.checks || [];
  const g = key => checks.find(s => s.source === key) || {};
  if (state.compTab === 'report') {
    const color = rep.color || riskColor(rep.level);
    // Нули вместо прочерка читались бы как «долгов и судов нет». Если источник
    // не ответил, показываем прочерк и причину.
    const fsspChk = g('fssp'), kadChk = g('kad');
    const debtsTotal = (fsspChk.data || {}).total;
    const debtsKnown = fsspChk.status === 'ok' && debtsTotal != null;
    const kadKnown = kadChk.status === 'ok';
    return `
     <div class="grid" style="margin-bottom:12px">
       <div class="kpi"><span>Риск-оценка</span><b class="risk-value" style="--risk:${esc(color)}">${rep.risk ?? '—'} / 100</b><small>${esc(RISK_LABELS[String(rep.level || '').toLowerCase()] || rep.level || 'проверок не было')}</small></div>
       <div class="kpi"><span>Исполнительные производства</span><b>${debtsKnown ? fmt(debtsTotal) : '—'}</b><small>${debtsKnown ? 'по базе ФССП' : 'API ФССП закрыт — по ссылке'}</small></div>
       <div class="kpi"><span>Арбитражные дела</span><b>${kadKnown ? Number((kadChk.data || {}).total || 0) + ' дел' : '—'}</b><small>${kadKnown ? 'Кад.Арбитр' : 'картотека не ответила'}</small></div>
       <div class="kpi"><span>Средний рейтинг</span><b>${(rep.reviews && rep.reviews.avgRating) ? rep.reviews.avgRating + ' ' + icon('star', 12) : '—'}</b><small>карты и отзывы</small></div>
     </div>
     <div class="card" style="box-shadow:none;border-color:var(--line)">
       <h4>Вердикт разведки</h4>
       <p>${esc(rep.verdict || 'Запустите проверку конкурента для получения сводки.')}</p>
       <h4 style="margin-top:12px">Аргументы для менеджера в переговорах:</h4>
       <div class="list">${(rep.talking_points || []).map(p => `<div class="row"><span>• ${esc(p)}</span></div>`).join('') || '<small>Факторы риска не выявлены — аргументов пока нет</small>'}</div>
       <hr>${reportLinks(rep, c)}
     </div>`;
  }
  if (state.compTab === 'sources') {
    return `<table><tr><th>Источник</th><th>Статус</th><th>Данные</th><th>Обновлено</th></tr>
     ${checks.map(s => `<tr><td><b>${esc(s.title || s.source)}</b></td><td><span class="tag ${s.status === 'ok' ? '' : 'orange'}">${esc(s.status)}</span></td><td><small>${esc(s.summary || '—')}</small></td><td><small>${esc(dt(s.checked_at))}</small></td></tr>`).join('') || '<tr><td colspan="4"><small>Источники ещё не опрашивались</small></td></tr>'}</table>`;
  }
  if (state.compTab === 'debts') {
    // «Проверили — чисто» и «проверить не удалось» показываем по-разному:
    // во втором случае прочерк, причина и ссылка на официальный реестр.
    const fsspChk = g('fssp'), fssp = fsspChk.data || {};
    const kadChk = g('kad'), kad = kadChk.data || {};
    const fsspLink = (fsspChk.links || []).find(l => /fssp\.gov\.ru/.test(l.url));
    return `<div class="cols"><div>
     <h4>ФССП (долги у судебных приставов)</h4>
     ${fsspChk.status === 'ok' ? `<p>Общая сумма долгов: <b>${fmt(fssp.total || 0)}</b></p>
     <div class="list">${(fssp.productions || []).map(d => `<div class="row"><span>${esc(d.number || 'Исполнительное производство')}<br><small>${fmt(d.sum || 0)} · ${esc(d.subject || '')}</small></span></div>`).join('') || '<small>Долгов у приставов не найдено</small>'}</div>`
      : `<p><small>${esc(fsspChk.summary || 'Официальный API ФССП закрыт с марта 2022 года — суммы долгов смотрятся вручную по ссылке на банк данных.')}</small></p>
     ${fsspLink ? `<a class="btn sm" href="${esc(fsspLink.url)}" target="_blank" rel="noopener">${icon('search', 13)} Открыть банк данных ФССП</a>` : ''}`}
    </div><div>
     <h4>Арбитражные суды (Кад.Арбитр)</h4>
     ${kadChk.status === 'ok' ? `<p>Всего дел: <b>${kad.total || 0}</b></p>
     <div class="list">${(kad.cases || []).map(x => `<div class="row"><span>Дело № ${esc(x.number)}<br><small>${esc(x.role || 'участник')}${x.type ? ' · ' + esc(x.type) : ''}${x.court ? ' · ' + esc(x.court) : ''}${x.date ? ' · ' + esc(dt(x.date)) : ''}</small></span>${x.url ? `<a class="btn sm" href="${esc(x.url)}" target="_blank" rel="noopener">${icon('fileText', 13)} Карточка дела</a>` : ''}</div>`).join('') || '<small>Судебных споров не найдено</small>'}</div>`
      : `<p><small>${esc(kadChk.summary || 'Картотека не ответила — проверьте по ссылке ниже.')}</small></p>`}
    </div></div>
    ${findingsBlock(c)}`;
  }
  if (state.compTab === 'reviews') {
    return `<div class="row" style="border:0"><h4>Отзывы клиентов (${(c.reviews || []).length})</h4><button class="btn sm" onclick="addReview(${c.id})">+ Добавить отзыв</button></div>
     <div class="list">${(c.reviews || []).map(r => `<div class="row"><span><b>${esc(r.author || 'Клиент')}</b> (${r.rating} ${icon('star', 12)}) — <small>${esc(r.source || 'карты')}</small><br>${esc(r.text)}</span><button class="btn sm danger" onclick="delReview(${r.id},${c.id})">${icon('close', 13)}</button></div>`).join('') || '<small>Отзывов пока нет</small>'}</div>`;
  }
  if (state.compTab === 'prices') {
    // сравнение считается по текущим данным: обновили цену в каталоге — цифры сразу свежие
    const ours = (state.ourPrices || []).filter(r => Number(r.price) > 0);
    const theirs = c.prices || [];
    const pairs = comparePrices(ours, theirs);
    const diffs = pairs.map(x => (x.theirs - x.ours) / (x.ours || 1) * 100);
    const avg = diffs.length ? Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length) : 0;
    const weCheaper = diffs.filter(d => d > 0).length;
    const theyCheaper = diffs.filter(d => d < 0).length;
    return `<p class="form-hint" style="margin:0 0 8px">Наши цены — это раздел «Каталог»: поправили цену там, и сравнение здесь сразу свежее. Позиции без цены в сравнении не участвуют.</p>
     <div class="row" style="border:0;flex-wrap:wrap;gap:8px"><h4>Сравнение с нашим прайс-листом</h4>
      <span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" title="Наш прайс-лист — это раздел «Каталог»: те же позиции и цены" onclick="openOurPrices(${c.id})">${icon('excel', 13)} Наш прайс-лист (${ours.length})</button>
      ${canEdit() ? `<button class="btn sm primary" onclick="openPriceImport(${c.id},'theirs')">${icon('upload', 13)} Загрузить прайс конкурента</button>` : ''}</span></div>
     ${pairs.length ? `<div class="grid" style="margin:6px 0 12px">
       <div class="kpi"><span>Сопоставлено позиций</span><b>${pairs.length}</b><small>из ${ours.length} наших и ${theirs.length} конкурента</small></div>
       <div class="kpi"><span>Средняя разница</span><b class="${avg > 0 ? 'green' : avg < 0 ? 'accent' : ''}">${avg > 0 ? '+' : ''}${avg}%</b><small>${avg > 0 ? 'конкурент дороже — мы выигрываем ценой' : avg < 0 ? 'конкурент дешевле — готовьте обоснование ценности' : 'цены совпадают'}</small></div>
       <div class="kpi"><span>Где мы дешевле</span><b>${weCheaper}</b><small>позиций</small></div>
       <div class="kpi"><span>Где дешевле конкурент</span><b>${theyCheaper}</b><small>позиций</small></div></div>` : ''}
     <table><tr><th>Позиция / проект</th><th>Наша цена</th><th>Цена конкурента</th><th>Разница</th></tr>
      ${pairs.map(x => {
        const diff = (x.theirs || 0) - (x.ours || 0);
        const pct = x.ours ? Math.round(diff / x.ours * 100) : 0;
        return `<tr><td><b>${esc(x.item)}</b></td><td>${fmt(x.ours)}</td><td>${fmt(x.theirs)}</td><td><span class="tag ${diff > 0 ? '' : diff < 0 ? 'orange' : 'grey'}">${diff === 0 ? 'одинаково' : (diff > 0 ? `мы дешевле на ${fmt(diff)} (${pct}%)` : `конкурент дешевле на ${fmt(-diff)} (${Math.abs(pct)}%)`)}</span></td></tr>`;
      }).join('') || `<tr><td colspan="4"><small>${!ours.length ? 'В каталоге нет позиций с ценой — без них сравнивать нечего.' : !theirs.length ? 'Прайс конкурента не загружен — загрузите его таблицей или вставьте текстом.' : 'Совпадающих позиций не нашлось: названия в таблицах разные. Сравнение строится по похожим наименованиям.'}</small></td></tr>`}</table>`;
  }
  if (state.compTab === 'history') {
    return `<div class="list">${(c.history || []).map(h => `<div class="row"><span><b class="risk-value sm" style="--risk:${esc(riskColor(h.level))}">риск ${h.risk}</b> · ${esc(RISK_LABELS[String(h.level || '').toLowerCase()] || h.level || '')}<br><small>${esc(h.verdict || '')}</small></span><small>${esc(dt(h.created_at))}</small></div>`).join('') || '<small>Проверок ещё не было</small>'}</div>`;
  }
}

function addReview(cid) {
  openModal(`<h3>Добавить отзыв</h3><form onsubmit="return saveReview(event,${cid})"><label>Автор<input name="author" placeholder="Алексей"></label><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Оценка (1-5)<input name="rating" type="number" min="1" max="5" value="5"></label><label>Источник<select name="source"><option value="yandex">Яндекс</option><option value="google">Google</option><option value="2gis">2ГИС</option><option value="avito">Авито</option></select></label></div><label>Текст отзыва*<textarea name="text" rows="3" required></textarea></label><button class="btn primary w">Сохранить</button></form>`);
}
async function saveReview(e, cid) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); b.competitor_id = cid; b.rating = +b.rating; await api('/api/reviews', { method: 'POST', body: JSON.stringify(b) }); closeModal(); toast('Отзыв добавлен'); openCompetitorCard(cid); return false; }
async function delReview(rid, cid) { await api('/api/reviews/' + rid, { method: 'DELETE' }); toast('Удалено'); openCompetitorCard(cid); }

// Как перенести файл в прайс-лист. По умолчанию — безопасно: знакомые позиции
// обновляются, новые добавляются, ничего не пропадает.
function priceModeField() {
  return `<label>Что сделать с текущим прайс-листом
   <select name="mode">
     <option value="merge">Обновить цены и добавить новые позиции (обычный режим)</option>
     <option value="replace">Заменить прайс целиком: чего нет в файле — уйдёт в архив</option>
   </select></label>
  <p class="form-hint" style="margin:-6px 0 10px">Позиция находится по артикулу, а если его нет — по названию. Ничего не удаляется: архивные позиции остаются в каталоге и возвращаются в продажу одной галочкой.</p>`;
}
function openPriceImport(competitorId, scope) {
  const ours = scope === 'ours';
  openModal(`<h3>${ours ? 'Загрузка прайс-листа' : 'Загрузка прайса конкурента'} (Excel / CSV)</h3>
   <p class="form-hint">${ours
    ? 'Прайс-лист — это ваш каталог: загруженные цены сразу появятся в сделках и в сравнении с конкурентами.'
    : 'Прайс конкурента нужен для сравнения позиций во вкладке «Сравнение цен».'}</p>
   ${ours ? `<div class="notice info" style="margin-bottom:10px">Удобнее всего так: скачайте текущий прайс, поправьте цены в Excel и загрузите файл обратно — знакомые позиции обновятся, новые добавятся.<div style="margin-top:8px"><button type="button" class="btn sm" onclick="download('/api/prices/export?scope=ours','price-list.csv')">${icon('download', 13)} Скачать текущий прайс</button></div></div>`
     : `<p class="form-hint">Загрузка заменит предыдущий прайс этого конкурента.</p>`}
   <p><small>Первая строка — заголовки: <code>Наименование;Цена;Ед</code>. Например: <code>Дом 8×10;3850000;шт</code>. Подойдёт файл CSV (обычная таблица) или первый лист Excel; цены — числами. <a href="/examples/prices.csv" download>Скачать пример</a>.</small></p>
   <div class="tabs"><button class="active" onclick="this.parentElement.nextElementSibling.classList.remove('hidden');this.nextElementSibling.classList.remove('active');this.classList.add('active');">Файл .xlsx / .csv</button><button onclick="openPriceTextForm(${competitorId},'${scope}')">Текст / ссылки</button></div>
   <div><form onsubmit="return importPriceFile(event,${competitorId || 'null'},'${scope}')">
     <label>Выберите файл таблицы (.xlsx или .csv)<input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required></label>
     ${ours ? priceModeField() : ''}
     <button class="btn primary w">Загрузить и разобрать</button></form></div>`);
}

async function importPriceFile(e, competitorId, scope) {
  e.preventDefault();
  const file = e.target.querySelector('input[type=file]').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1];
    try {
      const url = competitorId ? `/api/competitors/${competitorId}/prices` : '/api/prices/ours';
      const mode = (e.target.querySelector('[name=mode]') || {}).value || 'merge';
      const out = await api(url, { method: 'POST', body: JSON.stringify({ base64, filename: file.name, scope, mode }) });
      closeModal(); toast(priceImportText(out));
      afterPriceImport(competitorId);
    } catch (err) { toast(err.message, 'err'); }
  };
  reader.readAsDataURL(file);
  return false;
}

function openPriceTextForm(competitorId, scope) {
  openModal(`<h3>Загрузка прайса текстом или по URL</h3><form onsubmit="return importPriceText(event,${competitorId || 'null'},'${scope}')">
   <label>Ссылка на опубликованную таблицу Google Sheets / CSV<input name="url" placeholder="https://docs.google.com/spreadsheets/d/…/export?format=csv"></label>
   <label>Или вставьте строки (Позиция;Цена;Ед)<textarea name="text" rows="6" placeholder="Каркасный дом 8х10;3850000;шт&#10;Баня 4х6;890000;шт"></textarea></label>
   ${scope === 'ours' ? priceModeField() : ''}
   <button class="btn primary w">Сохранить</button></form>`);
}

async function importPriceText(e, competitorId, scope) {
  e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
  const endpoint = competitorId ? `/api/competitors/${competitorId}/prices` : '/api/prices/ours';
  const out = await api(endpoint, { method: 'POST', body: JSON.stringify({ url: f.url, text: f.text, scope, mode: f.mode || 'merge' }) });
  closeModal(); toast(priceImportText(out));
  afterPriceImport(competitorId);
  return false;
}
// один понятный ответ вместо «сохранено»: что именно произошло с прайсом
function priceImportText(out) {
  if (!out || out.scope !== 'ours') return `Прайс конкурента загружен: ${(out && out.imported) || 0} поз.`;
  const parts = [`добавлено ${out.added || 0}`, `обновлено ${out.updated || 0}`];
  if (out.archived) parts.push(`в архив ${out.archived}`);
  return `Прайс-лист (каталог) обновлён: ${parts.join(', ')}`;
}
// Таблица загружена: сбрасываем кэш и возвращаем человека туда, откуда он пришёл.
function afterPriceImport(competitorId) {
  state.ourPrices = null;
  if (competitorId) return openCompetitorCard(competitorId);
  const back = state.ourPricesBack;
  state.ourPricesBack = null;
  if (back) return openCompetitorCard(back);
  return render();
}

/* ---------- settings ---------- */
async function settings(v) {
  const isAdmin = (state.me && state.me.role) === 'admin';
  const s = isAdmin ? await api('/api/settings') : {}; state.cache.settings = s;
  // Адрес для вебхуков: сохранённый публичный адрес, иначе тот, по которому открыта CRM.
  const origin = (s.public_url || location.origin).replace(/\/+$/, '');
  const localOrigin = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.)/i.test(origin);
  // Порядок — по пути настройки: сначала каналы и воронка, затем правила и поля,
  // потом сообщения и разведка, в конце люди, данные компании и свой профиль.
  const allTabs = {
    integrations: 'Интеграции и каналы',
    pipelines: 'Воронки и этапы',
    automations: 'Автоматизации',
    fields: 'Поля карточек',
    templates: 'Шаблоны сообщений',
    competitors: 'Конкуренты и источники',
    team: 'Команда',
    data: 'Данные и компания',
    profile: 'Профиль'
  };
  const adminOnly = ['integrations', 'competitors', 'fields', 'pipelines', 'automations', 'team', 'data'];
  const tabs = Object.fromEntries(Object.entries(allTabs).filter(([k]) => isAdmin || !adminOnly.includes(k)));
  if (!tabs[state.settingsTab]) state.settingsTab = isAdmin ? 'integrations' : 'profile';
  let body = '';

  if (state.settingsTab === 'integrations') {
    // сотрудники нужны, чтобы привязать к каждому аккаунту того, кто с него
    // отвечает. Запрашиваем вместе с каналами, а не после них: вкладка не должна
    // ждать второго обращения к серверу, чтобы показаться.
    const [chans, users] = await Promise.all([
      state.channels.length ? state.channels : api('/api/channels').catch(() => []),
      state.users.length ? state.users : api('/api/users').catch(() => []),
    ]);
    state.channels = chans; state.users = users;
    // уволенного сотрудника привязать к аккаунту нельзя: обращения назначались бы
    // на того, кто уже не работает
    const staff = (users || []).filter(u => u.active !== 0);
    body = `${!isAdmin ? '<div class="card tint-info"><b>Режим просмотра</b><br><small>Ключи и настройки интеграций меняет администратор. Вы можете работать с чатами, сделками и задачами — всё остальное доступно.</small></div>' : ''}
    <div class="settings-cols"><div>
     <div class="card"><h3>Мессенджеры через Wazzup</h3>
      <p>Статус: <b class="${s.wazzup.configured ? 'green' : ''}">${s.wazzup.configured ? 'подключено' : 'не подключено'}</b></p>
      <label>Ключ доступа Wazzup<input id="wzKey" placeholder="${esc(s.wazzup.api_key || 'вставьте ключ из личного кабинета Wazzup')}"></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Куда отправлять ответы по умолчанию<select id="wzChannel"><option value="">— выберите канал —</option>${chans.filter(c => wzAlive(c) || c.external_id === s.wazzup.channel_id).map(c => `<option value="${esc(c.external_id)}" ${c.external_id === s.wazzup.channel_id ? 'selected' : ''}>${esc(wzTitle(c))}${wzAlive(c) ? '' : ' — не работает'}</option>`).join('')}</select></label>
      <label>Код защиты адреса (необязательно)<input id="wzSecret" value="${esc(s.wazzup.webhook_secret || '')}" placeholder="придумайте длинный код"></label></div>
      <p class="form-hint">Код подставляется в адрес вебхука и защищает от поддельных сообщений.</p>
      <label>Адрес сервера Wazzup<input id="wzUrl" value="${esc(s.wazzup.api_url)}"></label>
      <p class="form-hint">Адрес API Wazzup. Менять обычно не нужно.</p>
      <label>Дублировать входящие на второй адрес (необязательно)<input id="wzForward" value="${esc(s.wazzup.forward_url || '')}" placeholder="https://вторая-crm.ru/webhooks/wazzup"></label>
      <p class="form-hint">Wazzup присылает входящие на один адрес. Если те же мессенджеры подключены ещё к одной CRM, укажите её вебхук: каждая пачка входящих будет продублирована туда, чаты живут в обеих системах.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" onclick="saveWazzup()">Сохранить</button><button class="btn" onclick="testWazzup()">${icon('sync', 13)} Проверить и синхронизировать каналы</button></div>
      <hr><p><b>Адрес, по которому Wazzup присылает сообщения</b></p>
      ${hookLine(wazzupHookUrl(s))}
      <p><small>${s.wazzup.webhook_secret ? 'Секрет в адресе — пароль от этой двери: без него чужие люди не смогут присылать поддельные сообщения.' : 'Секрет не задан: адрес примет сообщение от любого, кто его узнает. Для работы в интернете лучше задать секрет выше.'}</small></p>
      ${s.wazzup.configured ? `<p><small>${s.wazzup.hook_msgs
        ? `Входящих получено: ${s.wazzup.hook_msgs}, последнее — ${esc(s.wazzup.hook_last_human)}.`
        : s.wazzup.hook_test_at ? `Проверочный запрос Wazzup прошёл ${esc(s.wazzup.hook_test_human)}, сообщений пока не было.`
        : 'Wazzup ещё не присылал сообщений: зарегистрируйте адрес кнопкой ниже.'}</small></p>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" onclick="registerWazzupWebhook()">${icon('sync', 13)} Зарегистрировать адрес автоматически</button></div>
      <hr><h3>Подключённые каналы (${chans.length})</h3>
      ${(() => {
        const alive = chans.filter(wzAlive), dead = chans.filter(c => !wzAlive(c));
        const list = state.showDeadChannels ? chans : alive;
        return (dead.length ? `<p><small>В рабочем состоянии: ${alive.length}. Недоступных скрыто: ${dead.length} — они не принимают и не отправляют сообщения.</small></p>` : '')
        + (list.map(c => { const [st, cls] = wzState(c.state);
        return `<div class="row"><span style="min-width:0;overflow-wrap:anywhere"><b>${esc(c.label || c.name || c.phone || c.external_id || 'Канал')}</b><br><small>${esc(wzTransportLabel(c.transport))}${c.label ? ' · ' + esc(c.name || c.phone || c.external_id || '') : ''}</small></span>
        <span style="display:flex;gap:6px;align-items:center;flex:1 1 320px;min-width:0"><input id="chLabel${c.id}" value="${esc(c.label || '')}" placeholder="своё название, например «WhatsApp — Ирина»" maxlength="60" style="flex:1 1 150px;min-width:0"><select id="chUser${c.id}" title="Кто отвечает с этого аккаунта" style="flex:1 1 150px;min-width:0"><option value="">— сотрудник не указан —</option>${staff.map(u => `<option value="${u.id}" ${Number(c.user_id) === Number(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select><button type="button" class="btn sm" style="white-space:nowrap" onclick="saveChannel(${c.id})">Сохранить</button></span>
        <span class="tag ${cls}">${esc(st)}</span></div>` }).join('')
        || (chans.length ? '<small>Все подключённые каналы недоступны: причина указана у каждого справа.</small>' : '<small>Каналы появятся после сохранения ключа и синхронизации.</small>'))
        + (dead.length ? `<div style="margin-top:8px"><button type="button" class="btn sm" onclick="toggleDeadChannels()">${state.showDeadChannels ? 'Скрыть недоступные' : 'Показать недоступные'} (${dead.length})</button></div>` : '');
      })()}
      ${chans.length && !chans.some(wzAlive) ? '<p class="form-hint">Ни один канал пока не работает — сообщения не отправятся. Причина указана справа от канала: её устраняют в личном кабинете Wazzup.</p>' : ''}</div>

     <div class="card"><h3>Заявки с сайта и из других сервисов</h3>
      <p><small>Готовая форма для сайта и «входная дверь» для любых заявок: имя, телефон и вопрос попадают в CRM, а она сама создаёт клиента, чат и сделку. Код формы копируется кнопкой ниже и вставляется на страницу сайта. Сюда же можно направить заявки с Авито, лендинга или своего бота — если сервис умеет отправлять данные на адрес (это называется вебхук).</small></p>
      ${hookLine(origin + '/webhooks/generic' + (s.webhook?.secret ? '?secret=' + encodeURIComponent(s.webhook.secret) : ''))}
      <p style="margin:6px 0 2px"><small>Пример запроса</small></p><pre class="code-block">curl -X POST '${esc(origin)}/webhooks/generic${s.webhook?.secret ? '?secret=' + esc(s.webhook.secret) : ''}' \
  -H 'Content-Type: application/json' \
  -d '{"channel":"site","name":"Иван","phone":"+7 999 123-45-67","body":"Нужен дом 8×10"}'</pre>
      <label>Код защиты (чтобы чужие не присылали заявки)
        <div style="display:flex;gap:8px"><input id="whSecret" value="${esc(s.webhook?.secret || '')}" placeholder="пусто — принимать любые заявки"><button type="button" class="btn sm" style="white-space:nowrap" onclick="genWebhookSecret()">Сгенерировать</button></div>
      </label>
      <p><small>Если код задан, заявка без него отклоняется. Готовая форма для сайта уже содержит код — её можно вставлять как есть. Другим сервисам добавьте код в адрес: <code>?secret=…</code> (подробность для программиста: можно и заголовком <code>x-webhook-secret</code>).</small></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary sm" onclick="saveWebhookSecret()">Сохранить секрет</button><button class="btn sm" onclick="copySiteFormCode()">${icon('copy', 13)} Скопировать код формы для сайта</button></div></div>
    </div><div>
     <div class="card"><h3>Проверка связи</h3><button class="btn orange w" onclick="checkHealth()">Проверить работу сервера</button><p style="margin-top:8px"><small>Проверка доступности сервера и базы данных. Диалоги и входящие сообщения появляются автоматически при подключённых каналах связи.</small></p></div>
     <div class="card"><h3>Адрес CRM в интернете</h3>
      <p><small>По этому адресу CRM открывают сотрудники, и сюда же обращаются Wazzup и формы с сайта. Он подставляется во все ссылки ниже.</small></p>
      <label>Публичный адрес<input id="publicUrl" value="${esc(s.public_url || '')}" placeholder="https://crm.вашдомен.ру"></label>
      <button class="btn sm primary" onclick="savePublicUrl()">Сохранить адрес</button>
      ${localOrigin ? `<div class="notice warn" style="margin-top:12px"><b>Сейчас открыт локальный адрес</b><br><small>${esc(origin)} виден только на этом компьютере. Wazzup и формы с сайта не смогут сюда достучаться — укажите публичный адрес выше (например, https://crm.вашдомен.ру) или откройте CRM по домену.</small></div>` : ''}
     </div>  
     <div class="card"><h3>Электронная почта</h3>
      <p><small>После настройки письма клиентам отправляются прямо из карточки чата, а входящие письма попадают в ту же переписку.</small></p>
      <p><small><b>Что такое «пароль приложения».</b> Яндекс Почта, Mail.ru и Gmail не разрешают сторонним программам входить по обычному паролю. В настройках безопасности ящика создаётся отдельный одноразовый пароль для CRM: он выглядит как <code>abcd efgh ijkl mnop</code> и вводится в поле «Пароль приложения» ниже. Обычный пароль от почты останется только у вас.</small></p>
      <p>Статус: <b class="${s.email.configured ? 'green' : ''}">${s.email.configured ? 'почта настроена' : 'не настроена'}</b></p>
      <form onsubmit="return saveEmail(event)">
       <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px"><label>Почтовый сервер<input name="SMTP_HOST" value="${esc(s.email.host || '')}" placeholder="smtp.mail.ru"></label><label>Порт<input name="SMTP_PORT" value="${esc(s.email.port || '587')}" placeholder="465 или 587"></label></div>
       <p class="form-hint">Обычно <code>smtp.название.ru</code>, точно — в справке вашей почты. Порт и шифрование определяются сами.</p>
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Логин (адрес ящика)<input name="SMTP_USER" value="${esc(s.email.user || '')}" placeholder="crm@company.ru"></label><label>Пароль приложения<input name="SMTP_PASS" type="password" placeholder="${s.email.pass ? '•••••• (сохранён)' : 'пароль приложения'}"></label></div>
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Защита соединения<select name="SMTP_SECURE"><option value="" ${!s.email.secure ? 'selected' : ''}>Авто: STARTTLS</option><option value="1" ${s.email.secure === '1' ? 'selected' : ''}>SSL/TLS сразу (обычно 465)</option><option value="0" ${s.email.secure === '0' ? 'selected' : ''}>Без шифрования (внутренний сервер)</option></select></label><label>Адрес отправителя<input name="MAIL_FROM" value="${esc(s.email.from || '')}" placeholder="crm@company.ru"></label></div>
       <label>Адрес для проверочного письма<input name="SMTP_TEST_TO" value="${esc(s.email.test_to || '')}" placeholder="admin@company.ru"></label>
       <div style="display:flex;gap:8px"><button class="btn primary">Сохранить почту</button><button class="btn" type="button" onclick="testEmail(this.form)">Отправить проверочное письмо</button></div></form>
      <hr><p><b>Приём входящих писем</b></p>
      <p><small><b>Входящие письма.</b> Письма приходят не сами по себе: в почтовом ящике нужно включить пересылку (фильтр «пересылать все письма на адрес…») на адрес ниже. CRM разберёт отправителя, тему и текст и добавит письмо в чат клиента. Код защиты спасает адрес от чужого спама; если он пуст, письма принимаются без проверки.</small></p>
      <div style="display:flex;gap:8px"><input id="emailSecret" value="${esc(s.email.webhook_secret || '')}" placeholder="секрет для входящих писем"><button type="button" class="btn sm" style="white-space:nowrap" onclick="genEmailSecret()">Сгенерировать</button><button type="button" class="btn sm primary" style="white-space:nowrap" onclick="saveEmailSecret()">Сохранить</button></div>
      ${hookLine(origin + '/webhooks/email' + (s.email.webhook_secret ? '?secret=' + encodeURIComponent(s.email.webhook_secret) : ''))}
     </div>
     </div></div>`;
  } else if (state.settingsTab === 'fields') {
    const cf = await api('/api/custom-fields');
    const rows = cf.fields;
    body = `<div class="settings-cols"><div class="card"><div class="row" style="border:0"><div><h3>Свои поля для контактов и сделок</h3><small>Дополнительные строки в карточке: площадь участка, тип фундамента, дата замера — что удобно именно вам. Название, обязательность и варианты списка меняются кнопкой «Изменить».</small></div><button class="btn sm primary" onclick="editField(-1)">${icon('plus', 13)} Добавить поле</button></div>
     <table id="cfFields"><tr><th>Название</th><th>Раздел</th><th>Тип</th><th>Обязательное</th><th class="act"></th></tr>${rows.map((f, i) => `<tr><td><b>${esc(f.label)}</b></td><td>${({ contacts: 'Контакты', deals: 'Сделки', both: 'Контакты и сделки' })[f.entity] || esc(f.entity)}</td><td>${({ text: 'Текст', number: 'Число', date: 'Дата', select: 'Список', phone: 'Телефон', email: 'E-mail' })[f.type] || esc(f.type)}${f.options && f.options.length ? '<br><small>' + f.options.map(esc).join(', ') + '</small>' : ''}</td><td>${f.required ? '<b>Да</b><br><small>сначала, со звёздочкой</small>' : 'Нет<br><small>ниже, можно позже</small>'}</td><td style="white-space:nowrap"><button class="btn sm" onclick="editField(${i})">${icon('edit', 13)} Изменить</button> <button class="btn sm danger" onclick="delField(${i})">${icon('trash', 13)} Удалить</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Своих полей пока нет</div></td></tr>'}</table>
     <p><small>Например: «Площадь участка», «Тип фундамента», «Дата замера». Новое поле сразу появляется в форме создания и в карточке клиента или сделки, а его значения попадают в выгрузку контактов в CSV.</small></p></div>
     <div>${builtinFieldsCard()}
      <div class="card"><h3>Как работают свои поля</h3>
      <p><small>Введите понятное название — технический код система сделает сама, видеть его не нужно. Поле появится в форме и в карточке, значения сохранятся вместе с клиентом или сделкой.</small></p>
      <p><small><b>Обязательное</b> поле нельзя сохранить пустым: оно стоит первым, подписано жирным и звёздочкой. Необязательные идут ниже спокойным шрифтом — их можно заполнить сразу или позже, они не мешают сохранить карточку.</small></p>
      <p><small><b>Изменить</b> можно любое своё поле: переименовать, сменить тип, раздел или сделать обязательным. Новые настройки сразу видны в формах и карточках.</small></p>
      <p><small><b>Раздел:</b> «Контакты и сделки» — поле видно везде; можно ограничить одним разделом.</small></p>
      <p><small><b>Удаление</b> убирает поле из форм и карточек; ранее введённые значения остаются в базе, но больше не показываются. Если поле нужно снова — создайте его с тем же названием.</small></p></div></div></div>`;
  } else if (state.settingsTab === 'competitors') {
    const cs = await api('/api/competitor-sources');
    // Цены для сравнения берутся из каталога. Здесь — только счётчик и указатель:
    // управлять прайсом из настроек разведки нелогично, для этого есть раздел «Каталог».
    const ours = await api('/api/prices?scope=ours').catch(() => ({ rows: [] }));
    // ключ → что он даёт и где взять. Без ключа источник не ломается: остаются ссылки.
    const KEY_FIELDS = [
      ['FNS_API_KEY', 'Ключ api-fns.ru (данные ФНС)', 'api-fns.ru — платный доступ к ЕГРЮЛ/ЕГРИП: статус, адрес, руководитель, учредители, ОКВЭД. Без ключа: ссылки «ФНС: Прозрачный бизнес» и «ФНС: бухотчётность» в отчёте'],
      ['GOOGLE_PLACES_KEY', 'Ключ Google Places', 'console.cloud.google.com → включите «Places API (New)». Старая версия API с октября 2026 не подключается в новых проектах. Без ключа: ссылка на поиск отзывов'],
      ['TWOGIS_KEY', 'Ключ 2ГИС', 'dev.2gis.ru — рейтинг и отзывы в 2ГИС. Отзывы отдаются только ключу с расширенным доступом. Без ключа: ссылка на карточку организации'],
      ['YANDEX_API_KEY', 'Ключ Яндекс Геопоиска', 'developer.tech.yandex.ru — карточка организации на Яндекс Картах (API платный). Без ключа: ссылка на карты']
    ];
    // источник без ключа работает сам; с ключом — данные подтягиваются;
    // manual — работающего API нет вовсе, и обещать «работает без ключа» нельзя
    const readyLabel = src => src.manual ? 'данные по ссылке вручную'
      : !src.needs.length ? 'работает без ключа'
      : (src.configured ? 'ключ задан — данные подтягиваются сами' : 'ключа нет — данные по ссылкам');
    body = `<div class="settings-cols"><div>
     <div class="card"><h3>Источники проверки</h3>
      <p class="form-hint">Ключи <b>не обязательны</b>: без них в отчёте остаются ссылки на официальные реестры, с ними данные подтягиваются сами и попадают в риск-оценку.</p>
      <table class="mini"><tr><th>Источник</th><th>Что даёт</th><th>Ключ</th><th>Готовность</th></tr>${cs.sources.map(src => `<tr><td><b>${esc(src.name)}</b></td><td><small>${esc(src.about)}</small></td><td>${src.needs.length ? (src.configured ? '<span class="tag">задан</span>' : '<span class="tag grey">не задан</span>') : '<span class="tag grey">не нужен</span>'}</td><td><small>${esc(readyLabel(src))}</small></td></tr>`).join('')}</table>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${isAdmin ? `<button class="btn sm" onclick="probeSources(this)">${icon('sync', 13)} Проверить доступность источников</button>` : ''}
        <button class="btn sm" onclick="go('competitors')">${icon('competitor', 13)} Открыть раздел «Конкуренты»</button>
      </div>
      <div id="srcProbe" style="margin-top:10px"></div>
     </div>
     ${isAdmin ? `<div class="card"><h3>Ключи источников</h3>
      <p class="form-hint">Нужны только источникам, которые отдают данные по ключу. Пусто — источник работает по ссылкам.</p>
      <form onsubmit="return saveCompetitorKeys(event)">${KEY_FIELDS.map(([k, label]) => `<label>${esc(label)}<input name="${k}" placeholder="${cs.keys[k] ? '•••••• (сохранён)' : 'вставьте ключ или оставьте пустым'}"></label>`).join('')}<button class="btn primary">Сохранить ключи</button></form></div>`
      : `<div class="card"><h3>Ключи источников</h3><p><small>Ключи задаёт администратор: Настройки → Конкуренты и источники. Отчёты, ссылки и сравнение цен доступны вам и без ключей.</small></p></div>`}
    </div><div>
     <div class="card"><h3>Как работает разведка конкурентов</h3>
      <p><small>CRM опрашивает открытые реестры и карты, собирает долги, суды, банкротство и отзывы, считает риск-оценку от 0 до 100 и подсказывает менеджеру аргументы для переговоров.</small></p>
      <p><small><b>Без ключей</b> CRM сама опрашивает картотеку арбитражных судов (Кад.Арбитр) и пробует Федресурс (банкротство) и Rusprofile. Эти два сайта часто закрываются от автоматических запросов — тогда в отчёте остаются прямые ссылки на официальные реестры: ФНС, ГИР БО, Федресурс, Госзакупки, Яндекс Карты, 2ГИС и Авито. <b>С ключами</b> добавляются данные ЕГРЮЛ (api-fns.ru) и рейтинги с карт (Google, 2ГИС, Яндекс).</small></p>
      <p><small><b>Долги у приставов автоматически не подтягиваются.</b> Официальный API ФССП закрыт с марта 2022 года и, по ответу службы, восстанавливаться не будет. В отчёте есть ссылка на банк исполнительных производств: сотрудник открывает её и вводит ИНН — это занимает минуту. CRM в этом случае показывает прочерк, а не «0 ₽», чтобы ноль нельзя было принять за отсутствие долгов.</small></p>
      <p><small>Отзывы и прайс конкурента можно внести вручную прямо в его карточке — сравнение цен и рейтинг появятся в отчёте сразу.</small></p>
      <p><small><b>Наши цены</b> для сравнения берутся из раздела «Каталог» — это один и тот же список: поправили цену там, и сравнение в карточке конкурента сразу свежее. Позиций в каталоге: <b>${ours.rows.length}</b>; в сравнении участвуют только те, у которых указана цена.</small></p>
      <button class="btn sm" onclick="go('products')">${icon('products', 13)} Открыть каталог</button></div>
     ${isAdmin ? `<div class="card"><h3>Адреса сервисов проверки</h3><p><small>Нужны только техническому специалисту — обычно здесь ничего менять не надо. Если сервис сменил адрес, его можно поправить.</small></p><form onsubmit="return saveCompetitorUrls(event)">${[['FNS_API_URL', 'ФНС API'], ['FEDRESURS_API_URL', 'Федресурс'], ['KAD_API_URL', 'Арбитр'], ['RUSPROFILE_URL', 'Rusprofile'], ['GOOGLE_API_URL', 'Google Places'], ['TWOGIS_API_URL', '2ГИС'], ['YANDEX_API_URL', 'Яндекс Геопоиск']].map(([k, n]) => `<label>${n}<input name="${k}" value="${esc((cs.urls || {})[k] || '')}"></label>`).join('')}<button class="btn">Сохранить адреса</button></form></div>` : ''}
    </div></div>`;
  } else if (state.settingsTab === 'pipelines') {
    const pl = await api('/api/pipelines');
    const allDeals = (await api('/api/deals')).deals;
    body = `<div class="settings-cols"><div class="card">
     <div class="row" style="border:0"><div><h3>Воронки и этапы</h3><small>Этапы — путь сделки от обращения до оплаты. Кнопки управления справа в карточке воронки.</small></div><button class="btn sm primary" onclick="addPipeline()">+ Воронка</button></div>
     ${pl.map(p => {
       const used = allDeals.filter(d => (d.pipeline_id || 1) === p.id).length;
       const open = allDeals.filter(d => (d.pipeline_id || 1) === p.id && !['won', 'lost'].includes(d.stage)).length;
       return `<div class="card pipe-card">
        <div class="pipe-main"><b>${esc(p.name)}</b>
         <small>${p.stages.length} этапов · сделок: ${used}${open ? `, в работе: ${open}` : ''}</small>
         <div class="pipe-stages">${p.stages.map((st, i) => `<span class="tag stage-tag" style="--st:${esc(st.color)}" title="${esc(st.kind === 'won' ? 'Этап успеха: сделка считается проданной' : st.kind === 'lost' ? 'Этап отказа: сделка считается потерянной' : 'Обычный этап воронки')}">${i + 1}. ${esc(st.name)}${st.kind === 'won' ? ' · успех' : st.kind === 'lost' ? ' · отказ' : ''}</span>`).join('')}</div></div>
        <div class="pipe-actions"><button class="btn sm" onclick="editPipeline(${p.id})">${icon('edit', 13)} Редактировать</button>
         ${pl.length > 1 ? `<button class="btn sm danger" title="${used ? 'В воронке есть сделки — сначала перенесите их в другую воронку' : 'Удалить воронку'}" onclick="del('pipelines',${p.id})">${icon('trash', 13)}</button>` : ''}</div>
       </div>`;
     }).join('')}</div>
     <div><div class="card"><h3>Как устроены воронки</h3>
      <p><small>Одна воронка — один путь сделки. Обычно хватает общей: «Неразобранное → Переговоры → Успешно → Закрыто и не реализовано». Отдельная воронка нужна, если направления продаются по-разному: например, дома и бани.</small></p>
      <p><small><b>Редактировать</b> — названия, цвета, порядок и тип этапа. Тип важен: этап «успех» попадает в выручку, «отказ» — в причины проигрыша, остальные считаются работой в процессе.</small></p>
      <p><small>Удалить можно только пустую воронку: пока в ней есть сделки, CRM не даст её убрать — сначала перенесите сделки в другую воронку.</small></p></div></div></div>`;
  } else if (state.settingsTab === 'automations') {
    // имена сотрудников нужны подписи правила «передать сделку»: без них в списке
    // стоит прочерк, и непонятно, кому правило отдаёт сделку
    const [rows, pl, staff, queue] = await Promise.all([api('/api/automations'), api('/api/pipelines'), team(), api('/api/automation-queue').catch(() => [])]);
    window.__autoUsers = (staff || []).filter(u => u.active !== 0);
    const stageName = code => (pl.flatMap(p => p.stages).find(s2 => s2.code === code) || {}).name || code;
    const whenText = a => a.trigger_type === 'deal_created' ? 'Появилась новая сделка'
      : a.trigger_type === 'message_in' ? (a.trigger_value ? `Клиент написал сообщение со словом «${a.trigger_value}»` : 'Клиент написал сообщение')
      : a.trigger_type === 'stage_changed' ? (a.trigger_value ? `Сделку перевели на этап «${stageName(a.trigger_value)}»` : 'Сделку перевели на другой этап')
      : a.trigger_type;
    const delayText = a => Number(a.delay_days) > 0 ? `, через ${Number(a.delay_days)} дн.` : '';
    const whatText = a => (a.action_type === 'create_task' ? `Создать задачу «${a.action_value}»`
      : a.action_type === 'change_stage' ? `Перевести сделку на этап «${stageName(a.action_value)}»`
      : a.action_type === 'add_tag' ? `Добавить клиенту тег «${a.action_value}»`
      : a.action_type === 'send_message' ? `Отправить клиенту сообщение: «${String(a.action_value || '').slice(0, 60)}»`
      : a.action_type === 'send_email' ? `Отправить клиенту письмо «${a.name}»`
      : a.action_type === 'assign_user' ? `Передать сделку сотруднику ${(window.__autoUsers || []).find(u => String(u.id) === String(a.action_value))?.name || '—'}`
      : a.action_value) + delayText(a);
    body = `<div class="settings-cols"><div>
     <div class="card"><h3>Что CRM делает сама</h3>
      <p class="form-hint">Эти два правила работают всегда, создавать их не нужно.</p>
      <form onsubmit="return saveCompanySettings(event)">
       <label>Автосоздание сделки при обращении<select name="AUTO_DEAL"><option value="1" ${s.auto_deal === '1' ? 'selected' : ''}>Да — создавать сделку «Неразобранное»</option><option value="0" ${s.auto_deal !== '1' ? 'selected' : ''}>Нет</option></select></label>
       <p class="form-hint">Сделка создаётся сразу при первом обращении: чат, форма на сайте, вебхук.</p>
       <label>Распределять новые обращения между менеджерами<select name="AUTO_ASSIGN"><option value="0" ${s.auto_assign !== '1' ? 'selected' : ''}>Нет — оставлять без ответственного</option><option value="1" ${s.auto_assign === '1' ? 'selected' : ''}>Да — отдавать наименее загруженному менеджеру</option></select></label>
       <p class="form-hint">Новое обращение получает сотрудник с меньшим числом сделок. Созданный вручную контакт остаётся за автором.</p>
       <button class="btn primary">Сохранить</button></form></div>
     <div class="card">
     <div class="row" style="border:0"><div><h3>Свои правила (${rows.length})</h3><small>Простые правила: «когда случилось — сделай». Работают сами, без участия сотрудника.</small></div><button class="btn sm primary" onclick="openAutomation()">+ Правило</button></div>
     <table><tr><th>Правило</th><th>Когда срабатывает</th><th>Что делает</th><th>Вкл.</th><th class="act"></th></tr>
      ${rows.map(a => `<tr><td><b>${esc(a.name)}</b></td><td><small>${esc(whenText(a))}</small></td><td><small>${esc(whatText(a))}</small></td>
       <td><input type="checkbox" style="width:auto" title="${a.active ? 'Правило работает — снимите, чтобы выключить' : 'Правило выключено'}" ${a.active ? 'checked' : ''} onchange="toggleAutomation(${a.id},this)"></td>
       <td style="white-space:nowrap"><button class="btn sm" onclick="openAutomation(${a.id})">${icon('edit', 13)} Изменить</button> <button class="btn sm danger" onclick="del('automations',${a.id})">${icon('trash', 13)} Удалить</button></td></tr>`).join('')
        || `<tr><td colspan="5"><div class="empty">Правил нет. Начните с простого: «Появилась новая сделка → создать задачу «Позвонить клиенту»».</div></td></tr>`}</table></div>
     ${queue.length ? `<div class="card"><h3>Запланированные действия (${queue.length})</h3>
      <p class="form-hint">Действия с выдержкой выполняются в срок сами. Лишнее можно отменить.</p>
      <div class="tbl-scroll"><table><tr><th>Когда</th><th>Правило</th><th>Что сделает</th><th>Сделка или клиент</th><th class="act"></th></tr>
       ${queue.map(q => `<tr>
        <td style="white-space:nowrap"><b>${esc(q.run_at_human)}</b><br><small>${esc(String(q.run_at).slice(11, 16))}</small></td>
        <td>${esc(q.rule)}${q.orphan ? ' <small>— правило удалено, действие не выполнится</small>' : ''}</td>
        <td><small>${esc(whatText({ action_type: q.action_type, action_value: q.action_value, name: q.rule, delay_days: 0 }))}</small></td>
        <td><small>${esc(q.deal_title || q.contact_name || '—')}</small></td>
        <td class="act"><button class="btn sm danger" onclick="cancelQueued(${q.id})">${icon('trash', 13)} Отменить</button></td>
       </tr>`).join('')}
      </table></div>
     </div>` : ''}
    </div><div><div class="card"><h3>Как это работает</h3>
      <p><small>Правило срабатывает на событие: создана сделка, клиент написал, сменился этап.</small></p>
      <p><small><b>Создать задачу</b> — задача ответственному, срок сегодня 14:00, с уведомлением.</small></p>
      <p><small><b>Перевести на этап</b> — сделка переходит на указанный этап, аналитика пересчитывается.</small></p>
      <p><small><b>Добавить тег</b> — метка клиенту для фильтра в контактах.</small></p>
      <p><small><b>Отправить сообщение</b> — в канал, откуда писал клиент; без переписки ничего не уходит, причина пишется в историю.</small></p>
      <p><small><b>Отправить письмо</b> — на e-mail из карточки клиента; тема — название правила. Нужна настроенная почта.</small></p>
      <p><small><b>Передать сделку</b> — сделка и клиент переходят сотруднику, с уведомлением.</small></p>
      <p><small><b>Выдержка «через N дней»</b> — действие попадает в список «Запланированные действия» выше и срабатывает в срок.</small></p>
      <p><small>В тексте сообщения и письма работают подстановки: <code>{name}</code> — имя клиента, <code>{deal}</code> — название сделки, <code>{sum}</code> — сумма, <code>{company}</code> — ваша компания.</small></p>
      <p><small>Правила не зацикливаются: перевод на текущий этап ничего не меняет, тег не дублируется.</small></p></div></div></div>`;
  } else if (state.settingsTab === 'templates') {
    const rows = await api('/api/templates');
    const tq = (state.tplQuery || '').trim().toLowerCase();
    const shown = tq ? rows.filter(t => `${t.name} ${t.body}`.toLowerCase().includes(tq)) : rows;
    const tplRow = t => `<div class="tpl-row"><div class="tpl-main"><b>${esc(t.name)}</b>
      <p>${esc(t.body)}</p></div>${canEdit() ? `<div class="tpl-actions"><button class="btn sm" title="Изменить шаблон" onclick="openTemplate(${t.id})">${icon('edit', 13)}</button><button class="btn sm danger" title="Удалить шаблон" onclick="delTemplate(${t.id})">${icon('trash', 13)}</button></div>` : ''}</div>`;
    body = `<div class="settings-cols"><div>
     <div class="card"><div class="row" style="border:0;flex-wrap:wrap;gap:8px"><div><h3>Мои шаблоны (${rows.length})</h3><small>Заготовки частых ответов. В чате выбираются из списка «Шаблоны ответов…» над полем ввода.</small></div>
      <input id="tplSearch" style="max-width:200px;margin-left:auto" placeholder="Поиск по шаблонам" value="${esc(state.tplQuery || '')}" oninput="liveSearch('tpl',()=>setTplQuery(this.value))">
      ${canEdit() ? `<button class="btn sm primary" onclick="openTemplate()">${icon('plus', 13)} Новый шаблон</button>` : ''}</div>
     ${shown.map(tplRow).join('') || `<div class="empty">${tq ? 'Ничего не найдено — измените поиск' : 'Шаблонов пока нет. Создайте первый — например, приветствие или условия доставки.'}</div>`}</div>
    </div><div>
     <div class="card"><h3>Как это работает</h3><p><small>Шаблоны <b>личные</b>: каждый сотрудник видит и правит только свои. При выборе в чате текст подставляется в поле ввода — его можно поправить перед отправкой.</small></p>
      <p><small><b>Подстановки:</b> {name} — имя клиента, {sum} — сумма его открытой сделки, {date} — сегодняшняя дата. Если сделки ещё нет, вместо {sum} будет «—».</small></p>
      <p><small>Куда отправить ответ, выбирается прямо в чате над полем ввода — шаблон не привязан к каналу и подходит для любого.</small></p></div>
    </div></div>`;
  } else if (state.settingsTab === 'team') {
    const rows = await api('/api/users');
    const allDeals = (await api('/api/deals')).deals;
    const allTasks = await api('/api/tasks');
    const uq = (state.teamQuery || '').trim().toLowerCase();
    const shown = uq ? rows.filter(x => `${x.name} ${x.email || ''} ${roleLabel(x.role)}`.toLowerCase().includes(uq)) : rows;
    const stat = id => {
      const my = allDeals.filter(d => d.responsible_id === id);
      const open = my.filter(d => !['won', 'lost'].includes(d.stage));
      const tasks = allTasks.filter(t => t.responsible_id === id && !t.done);
      return { open: open.length, sum: open.reduce((a, d) => a + d.amount, 0), won: my.filter(d => d.stage === 'won').length, tasks: tasks.length };
    };
    body = `<div class="settings-cols"><div class="card">
     <div class="row" style="border:0;flex-wrap:wrap;gap:8px"><div><h3>Команда (${rows.length})</h3><small>Доступ в CRM выдаёт администратор: e-mail — это логин, пароль сотрудник меняет при первом входе.</small></div>
      <input id="teamSearch" style="max-width:220px;margin-left:auto" placeholder="Поиск: имя, e-mail, роль" value="${esc(state.teamQuery || '')}" oninput="liveSearch('team',()=>setTeamQuery(this.value))">
      <button class="btn sm primary" onclick="openUser()">+ Пользователь</button></div>
     <div class="tbl-scroll"><table><tr><th>Сотрудник</th><th>E-mail (логин)</th><th>Роль</th><th>Сделки в работе</th><th>Задачи</th><th>Последний вход</th><th>Доступ</th><th></th></tr>
      ${shown.map(x => { const st = stat(x.id); return `<tr>
        <td><b>${esc(x.name)}</b>${x.must_change_password ? '<br><small>работает по временному паролю</small>' : ''}</td>
        <td>${esc(x.email || '—')}</td><td>${esc(roleLabel(x.role))}</td>
        <td>${st.open} на ${fmt(st.sum)}<br><small>успешных: ${st.won}</small></td><td>${st.tasks}</td>
        <td><small>${esc(x.last_login ? dt(x.last_login) : 'ещё не входил')}</small></td>
        <td>${x.active ? '<span class="tag">разрешён</span>' : '<span class="tag grey">отключён</span>'}</td>
        <td style="white-space:nowrap"><button class="btn sm" title="Изменить данные, роль, доступ или выдать новый пароль" onclick="openUser(${x.id})">${icon('edit', 13)} Изменить</button></td></tr>`; }).join('')
        || `<tr><td colspan="8"><div class="empty">${uq ? 'Никого не нашли — измените поиск' : 'Сотрудников пока нет'}</div></td></tr>`}</table></div></div>
     <div><div class="card"><h3>Права ролей</h3>
      <p><small><b>Администратор</b> — всё: настройки, команда, интеграции, воронки, свои поля, каталог (он же прайс-лист), резервные копии.</small></p>
      <p><small><b>Менеджер</b> — клиенты, компании, сделки, задачи, заметки, все чаты, каталог (смотрит и берёт позиции в сделки), шаблоны сообщений и проверка конкурентов. E-mail коллег ему не показывается.</small></p>
      <p><small><b>Наблюдатель</b> — только просмотр и выгрузки: руководитель или бухгалтер видит цифры, но ничего не меняет.</small></p>
      <hr><p><small><b>Первый вход.</b> После создания сотрудника CRM показывает данные для входа одним окном — скопируйте и передайте их лично. При первом входе человек задаёт свой пароль (от 12 символов), а выданный вами перестаёт работать.</small></p>
      <p><small><b>Уволился сотрудник?</b> Снимите галочку «Сотрудник может входить в CRM» — все его сеансы завершатся сразу. Карточки и переписка останутся в базе; сделки и задачи можно передать другому человеку массовым действием.</small></p></div></div></div>`;
  } else if (state.settingsTab === 'data') {
    const demoRows = Object.values(s.demo || {}).reduce((a, b) => a + b, 0);
    body = `${demoRows ? `<div class="card tint-info"><h3>${icon('sparkles', 16)} Демонстрационные данные</h3><p><small>Сейчас в базе примеры: клиентов ${s.demo?.contacts || 0}, сделок ${s.demo?.deals || 0}, задач ${s.demo?.tasks || 0}, чатов ${s.demo?.conversations || 0}, конкурентов ${s.demo?.competitors || 0}, товаров каталога ${s.demo?.products || 0}, шаблонов ${s.demo?.templates || 0}, правил ${s.demo?.automations || 0}. Их можно редактировать как обычные данные или удалить одной кнопкой — тогда CRM будет полностью чистой.</small></p><button class="btn danger sm" onclick="cleanDemo()">${icon('trash', 13)} Удалить демонстрационные данные</button></div>` : ''}
    <div class="settings-cols"><div><div class="card"><h3>Название компании</h3><form onsubmit="return saveCompanySettings(event)"><div style="display:grid;grid-template-columns:2fr 1fr;gap:12px"><label>Название<input name="COMPANY_NAME" value="${esc(s.company.name)}"></label><label>Валюта<input name="CURRENCY" value="${esc(s.company.currency)}"></label></div>
     <p class="form-hint">Название и валюта попадают в печатные документы и во все суммы. Автосоздание и распределение сделок — во вкладке «Автоматизации».</p>
     <button class="btn primary">Сохранить</button></form></div>
     <div class="card"><h3>Реквизиты для КП и счёта</h3><p><small>Попадают в печатные документы сделки (кнопки «КП» и «Счёт»). Префикс номера — начало нумерации, например «КП», «СЧ».</small></p>
      <form onsubmit="return saveCompanySettings(event)">
       <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px"><label>ИНН<input name="COMPANY_INN" value="${esc((s.requisites || {}).inn || '')}"></label>
       <label>КПП<input name="COMPANY_KPP" value="${esc((s.requisites || {}).kpp || '')}"></label>
       <label>ОГРН<input name="COMPANY_OGRN" value="${esc((s.requisites || {}).ogrn || '')}"></label></div>
       <label>Юридический адрес<input name="COMPANY_ADDRESS" value="${esc((s.requisites || {}).address || '')}"></label>
       <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px"><label>Телефон<input name="COMPANY_PHONE" value="${esc((s.requisites || {}).phone || '')}"></label>
       <label>E-mail<input name="COMPANY_EMAIL" value="${esc((s.requisites || {}).email || '')}"></label>
       <label>Сайт<input name="COMPANY_SITE" value="${esc((s.requisites || {}).site || '')}"></label></div>
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Банк<input name="COMPANY_BANK" value="${esc((s.requisites || {}).bank || '')}" placeholder="ООО «Банк», БИК 044525225"></label>
       <label>Расчётный счёт<input name="COMPANY_ACCOUNT" value="${esc((s.requisites || {}).account || '')}" placeholder="40702810…"></label></div>
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Корр. счёт<input name="COMPANY_CORR" value="${esc((s.requisites || {}).corr || '')}"></label>
       <label>Начало номера документов<input name="DOC_PREFIX" value="${esc((s.requisites || {}).doc_prefix || '')}" placeholder="КП"></label></div>
       <button class="btn primary">Сохранить реквизиты</button></form></div>
       <div class="card"><h3>Дополнительные параметры</h3>
       <form onsubmit="return saveAdvanced(event)">
       <label>Показывать CRM внутри другого сайта<input name="FRAME_ANCESTORS" value="${esc(s.advanced?.frame_ancestors || '')}" placeholder="пусто = запрещено · например https://портал.ru или *"></label>
       <p style="margin:-4px 0 10px"><small>Кому можно показывать CRM внутри своего сайта — например, встроить в портал компании. Пустое поле — никому (безопасно); адрес вида <code>https://портал.ru</code> — только этому сайту; <code>*</code> — любому сайту (не рекомендуется). На обычную работу CRM не влияет.</small></p>
       <label>Сколько неудачных попыток входа разрешать за 5 минут<input name="LOGIN_RATE_LIMIT" type="number" min="1" max="10000" value="${esc(String(s.advanced?.login_rate_limit ?? 12))}"></label>
       <p style="margin:-4px 0 10px"><small>Защита от подбора пароля: после указанного числа неудачных попыток вход с этого IP временно блокируется на 5 минут. Для офиса за одним IP ставьте значение повыше, для открытого интернета хватает 10–20.</small></p>
       <button class="btn primary">Сохранить параметры</button>
       </form>
       </div>
    </div><div>
     <div class="card"><h3>Резервные копии базы</h3>
       <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary sm" onclick="makeBackup()">${icon('plus', 13)} Создать копию сейчас</button>
       <button class="btn sm" onclick="download('/api/export/json','karkas-backup.json')" title="Текстовый файл со всеми данными — для переноса в другую программу">${icon('download', 13)} Скачать все данные</button></div>
       <div id="backupList" style="margin-top:10px">Загрузка…</div>
       <form onsubmit="return saveMaintenance(event)">
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Хранить копии, дней<input name="BACKUP_KEEP_DAYS" type="number" min="0" max="3650" value="${esc(String(s.maintenance?.backup_keep_days ?? 7))}"></label>
       <label>Час создания копии (0–23)<input name="BACKUP_HOUR" type="number" min="0" max="23" value="${esc(String(s.maintenance?.backup_hour ?? 3))}"></label></div>
       <label>Адрес для уведомлений о просроченных задачах (необязательно)<input name="NOTIFY_WEBHOOK" value="${esc(s.maintenance?.notify_webhook || '')}" placeholder="https://hooks.slack.com/services/…"></label>
       <button class="btn primary">Сохранить</button>
       </form>
     </div>
     <div class="card"><h3>Резервные копии в хранилище</h3>
      <p><small>Ночная копия остаётся на этом же сервере. Если сервер выйдет из строя или файлы зашифрует вирус, копия пропадёт вместе с базой. Хранилище — это отдельный сервер, куда CRM сама отправляет каждую новую копию. Подходит любое S3-хранилище: Рег.ру, Timeweb, Selectel, Яндекс Облако, VK Cloud. Данные берутся из панели провайдера.</small></p>
      <form onsubmit="return saveS3(event)">
       ${fld('Адрес хранилища', `<input name="S3_ENDPOINT" value="${esc(s.s3?.endpoint || '')}" placeholder="https://s3.regru.cloud">`, true)}
       ${fld('Ведро (bucket)', `<input name="S3_BUCKET" value="${esc(s.s3?.bucket || '')}" placeholder="karkas-backups">`, true)}
       ${fld('Ключ доступа', `<input name="S3_ACCESS_KEY" value="${esc(s.s3?.access_key || '')}" placeholder="обычно начинается с двух заглавных пар букв и цифр">`, true)}
       ${fld('Секретный ключ', `<input name="S3_SECRET_KEY" type="password" value="" placeholder="${s.s3?.secret_set ? 'сохранён — введите, только чтобы заменить' : 'вставьте секретный ключ'}">`, true)}
       ${fld('Папка внутри ведра', `<input name="S3_PREFIX" value="${esc(s.s3?.prefix || '')}" placeholder="karkascrm">`)}
       ${fld('Регион', `<input name="S3_REGION" value="${esc(s.s3?.region || 'us-east-1')}" placeholder="us-east-1">`)}
       ${fld('Сколько копий держать в хранилище', `<input name="S3_KEEP" type="number" min="0" max="365" value="${esc(String(s.s3?.keep ?? 14))}">`)}
       <label class="opt" style="display:flex;gap:8px;align-items:center"><input name="S3_AUTO" type="checkbox" value="1" ${s.s3?.auto ? 'checked' : ''}> Отправлять каждую новую копию автоматически</label>
       <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn primary">Сохранить хранилище</button>
        <button type="button" class="btn" onclick="uploadS3()">Выгрузить последнюю копию сейчас</button>
       </div>
      </form>
      <div id="s3status">${s3line(s.s3)}</div>
     </div>
    </div></div>`;
  } else if (state.settingsTab === 'profile') {
    const me = state.me || {};
    body = `<div class="settings-cols"><div>
     <div class="card"><h3>${icon('profile', 18)} Мой профиль</h3>
      <p><b>Сотрудник:</b> ${esc(me.name || '—')}<br>
      <b>E-mail:</b> ${esc(me.email || '—')}<br>
      <b>Роль в системе:</b> <span class="tag ${me.role === 'admin' ? 'orange' : ''}">${esc(roleLabel(me.role) || '—')}</span></p>
      <p><small>Имя, роль и статус активности настраиваются администратором в разделе «Команда».</small></p>
     </div>
     <div class="card"><h3>${icon('lock', 18)} Пароль и безопасность</h3>
      <p><small>Смените пароль здесь. После смены все другие сеансы (на других устройствах) завершаются — это защита аккаунта. Минимум 12 символов: используйте фразу из нескольких слов или менеджер паролей.</small></p>
      <form onsubmit="return savePassword(event)">
        <label>Текущий пароль<input name="old_password" type="password" required autocomplete="current-password"></label>
        <div class="pw-wrap"><label style="width:100%">Новый пароль<input name="new_password" type="password" required minlength="12" maxlength="256" autocomplete="new-password" placeholder="минимум 12 знаков"></label><button type="button" class="pw-eye" title="Показать/скрыть пароль" onclick="togglePass(this)">${icon('eye', 16)}</button></div>
        <button class="btn primary">Сохранить новый пароль</button>
      </form>
     </div>
    </div><div>
     <div class="card"><h3>${icon('theme', 18)} Тема оформления</h3>
      <p><small>Выберите цветовую схему КаркасCRM:</small></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn ${currentThemeMode() === 'light' ? 'primary' : ''}" onclick="applyTheme('light');render()">${icon('sun', 14)} Светлая</button>
        <button class="btn ${currentThemeMode() === 'dark' ? 'primary' : ''}" onclick="applyTheme('dark');render()">${icon('moon', 14)} Тёмная</button>
        <button class="btn ${currentThemeMode() === 'auto' ? 'primary' : ''}" onclick="applyTheme('auto');render()">${icon('theme', 14)} Как в системе</button>
      </div>
     </div>
    </div></div>`;
  }

  v.innerHTML = `<div class="tabs">${Object.entries(tabs).map(([k, n]) => `<button class="${state.settingsTab === k ? 'active' : ''}" onclick="setSettingsTab('${k}')">${n}</button>`).join('')}</div>${body}`;
  if (state.settingsTab === 'data') loadBackups();
}

// Своё название канала. Вендор имени не передаёт, только номер или юзернейм,
// а каналов у заказчика бывает по одному на сотрудника: без подписей список
// выглядит как перечень номеров и непонятно, чей из них чей.
// Название хранится в CRM и не затирается следующей синхронизацией.
async function saveChannel(id) {
  const name = $('#chLabel' + id), who = $('#chUser' + id);
  try {
    await api('/api/channels/' + id, { method: 'PUT', body: JSON.stringify({ label: name ? name.value : '', user_id: who && who.value ? Number(who.value) : '' }) });
    toast('Канал сохранён'); state.channels = []; render();
  } catch (e) { toast(e.message, 'err'); }
}
async function saveWazzup() { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_API_KEY: $('#wzKey').value, WAZZUP_CHANNEL_ID: $('#wzChannel').value, WAZZUP_WEBHOOK_SECRET: $('#wzSecret').value, WAZZUP_API_URL: $('#wzUrl').value, WAZZUP_FORWARD_URL: $('#wzForward').value }) }); toast('Ключ сохранён'); render(); }
let __fields = null;
async function loadFields() { if (!__fields) __fields = (await api('/api/custom-fields')).fields; return __fields; }
// Транслитерация названия поля в технический ключ — пользователь его не видит.
function translit(s) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  return String(s).toLowerCase().split('').map(ch => (ch in map ? map[ch] : (/[a-z0-9]/.test(ch) ? ch : '_'))).join('').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}
// Поля, которые уже есть в карточках: их не добавляют — ими пользуются.
// Справочник нужен, чтобы человек видел всю картину, а не только свои поля.
const BUILTIN_FIELDS = {
  contacts: {
    title: 'Контакты', where: 'в карточке клиента (кнопка «Редактировать»)',
    rows: [
      ['Имя клиента', 'да', 'Обязательное: без имени карточка не сохранится'],
      ['Телефон', 'нет', 'По нему CRM находит клиента и узнаёт дубли'],
      ['E-mail', 'нет', 'На него уходит письмо из чата'],
      ['Компания', 'нет', 'Связь с карточкой компании из раздела «Компании»'],
      ['Должность', 'нет', 'Кем работает клиент'],
      ['Ответственный', 'нет', 'Сотрудник, который ведёт клиента'],
      ['Источник', 'нет', 'Откуда пришёл: сайт, WhatsApp, Авито, импорт'],
      ['Теги', 'нет', 'Метки через запятую — по ним работает фильтр'],
      ['Заметки', 'нет', 'Короткая памятка; история заметок — в карточке клиента'],
    ]
  },
  deals: {
    title: 'Сделки', where: 'в карточке сделки (вкладка «Сведения»)',
    rows: [
      ['Название сделки', 'да', 'Обязательное: его видно на доске и в документах'],
      ['Сумма', 'нет', 'Считается в выручке и аналитике'],
      ['Этап', 'нет', 'Есть всегда: меняется перетаскиванием карточки на доске'],
      ['Клиент', 'нет', 'Привязка к карточке клиента'],
      ['Компания', 'нет', 'Привязка к карточке компании'],
      ['Дедлайн', 'нет', 'До какого числа нужно закрыть'],
      ['Ответственный', 'нет', 'Кто ведёт сделку'],
      ['Приоритет', 'нет', 'Обычный, высокий или низкий'],
      ['Причина отказа', 'нет', 'Заполняется при закрытии в минус — попадает в аналитику'],
    ]
  },
  companies: {
    title: 'Компании', where: 'в карточке компании',
    rows: [['Название организации', 'да', 'Обязательное'], ['ИНН', 'нет', 'Для документов и проверки контрагента'],
      ['Телефон', 'нет', 'Общий телефон компании'], ['E-mail', 'нет', 'Почта для документов'],
      ['Сайт', 'нет', 'Открывается ссылкой из списка'], ['Заметки', 'нет', 'Договорённости и особенности']]
  },
  tasks: {
    title: 'Задачи', where: 'в окне задачи',
    rows: [['Что сделать', 'да', 'Обязательное: что именно сделать'],
      ['Срок', 'нет', 'Дата и время; без срока задача попадает в «Активные»'],
      ['Тип', 'нет', 'Звонок, встреча, сообщение, письмо или дело'],
      ['Клиент', 'нет', 'Привязка — задача видна в карточке клиента'],
      ['Сделка', 'нет', 'Привязка — задача видна в карточке сделки'],
      ['Ответственный', 'нет', 'Кому назначена'],
      ['Приоритет', 'нет', 'Обычный, высокий или низкий'],
      ['Повтор задачи', 'нет', 'Каждый день, каждую неделю или каждый месяц'],
      ['Результат', 'нет', 'Что получилось — заполняется при выполнении']]
  }
};
function setBuiltinTab(key) { state.builtinTab = key; render(); }
function builtinFieldsCard() {
  const key = state.builtinTab || 'contacts';
  const set = BUILTIN_FIELDS[key];
  return `<div class="card"><h3>Поля, которые уже есть в карточках</h3>
   <div class="tabs" style="margin-bottom:10px">${Object.entries(BUILTIN_FIELDS).map(([k, v]) => `<button class="${k === key ? 'active' : ''}" onclick="setBuiltinTab('${k}')">${esc(v.title)}</button>`).join('')}</div>
   <table class="mini" id="builtinFields"><tr><th>Поле</th><th>Обязательное</th><th>Зачем</th></tr>
    ${set.rows.map(([name, req, why]) => `<tr><td><b>${esc(name)}</b></td><td>${req === 'да' ? '<span class="tag">да</span>' : '<span class="tag grey">нет</span>'}</td><td><small>${esc(why)}</small></td></tr>`).join('')}</table>
   </div>`;
}

async function editField(i) {
  const list = await loadFields(); const f = i >= 0 ? list[i] : { key: '', label: '', type: 'text', entity: 'both', options: [], required: false };
  openModal(`<h3>${i >= 0 ? 'Своё поле' : 'Новое поле карточки'}</h3><p><small>${i >= 0 ? 'Изменения сразу появятся в формах и карточках; уже введённые значения сохранятся.' : 'Поле появится в форме создания и в карточке выбранного раздела.'}</small></p><form onsubmit="return saveField(event,${i})">
   <input type="hidden" name="key" value="${esc(f.key)}">
   <label class="req">Название поля<span class="star">*</span><input name="label" required value="${esc(f.label)}" placeholder="Площадь участка"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Тип<select name="type">${[['text', 'Текст'], ['number', 'Число'], ['date', 'Дата'], ['email', 'E-mail'], ['phone', 'Телефон'], ['select', 'Список вариантов']].map(([k, n]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
   <label>Где показывать<select name="entity">${[['both', 'Везде'], ['contacts', 'Только контакты'], ['deals', 'Только сделки']].map(([k, n]) => `<option value="${k}" ${k === f.entity ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
   <label>Варианты списка (только для типа «Список», через запятую)<input name="options" value="${esc((f.options || []).join(', '))}" placeholder="каркас, брус, газобетон"></label>
   <label class="check-line"><input type="checkbox" name="required" style="width:auto" ${f.required ? 'checked' : ''}><span>Обязательное поле <small>— стоит первым, без него карточка не сохранится</small></span></label>
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveField(e, i) {
  e.preventDefault(); const list = (await loadFields()).slice();
  const b = Object.fromEntries(new FormData(e.target));
  let key = (b.key || '').replace(/[^a-zA-Z0-9_]/g, '') || translit(b.label) || 'field';
  if (i < 0) { let n = 1, base = key; while (list.some(f => f.key === key)) key = `${base}_${++n}`; }
  const field = { key, label: b.label, type: b.type, entity: b.entity, required: !!b.required, options: (b.options || '').split(',').map(x => x.trim()).filter(Boolean) };
  if (i >= 0) list[i] = field; else list.push(field);
  __fields = null; state.meta = null;
  await api('/api/custom-fields', { method: 'PUT', body: JSON.stringify({ fields: list }) });
  state.meta = await api('/api/meta').catch(() => null); closeModal(); toast('Поле сохранено'); render(); return false;
}
function delField(i) {
  askConfirm('Убрать это поле из карточек и форм? Ранее сохранённые значения перестанут отображаться.', async () => {
    const list = (await loadFields()).slice(); list.splice(i, 1); __fields = null;
    await api('/api/custom-fields', { method: 'PUT', body: JSON.stringify({ fields: list }) });
    state.meta = await api('/api/meta').catch(() => null); toast('Поле удалено'); render();
  }, { okText: 'Убрать поле' });
}
async function saveEmail(e) {
  e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(b) });
  toast('Настройки почты сохранены'); render(); return false;
}
async function testEmail(form) {
  const b = Object.fromEntries(new FormData(form)); toast('Отправляем проверочное письмо…');
  try { const r = await api('/api/integrations/email/test', { method: 'POST', body: JSON.stringify(b) }); toast('Письмо ушло на ' + r.to + ' — проверьте ящик'); }
  catch (err) { toast('Не получилось: ' + err.message, 'err'); }
  return false;
}
async function testWazzup() {
  const r = await api('/api/integrations/wazzup/test', { method: 'POST' }).catch(e => ({ ok: false, error: e.message }));
  if (!r.ok) return toast(r.error);
  const sync = await api('/api/integrations/wazzup/sync', { method: 'POST' }).catch(e => ({ error: e.message }));
  state.channels = [];
  if (sync.error) { toast(sync.error); return render(); }
  // ноль каналов — не повод гадать: объясняем, что делать дальше
  const list = sync.channels || [];
  const working = list.filter(wzAlive).length;
  if (!list.length) toast('Ключ подошёл, но в кабинете Wazzup нет ни одного канала. Подключите мессенджер у вендора и повторите синхронизацию.');
  else if (!working) toast(`Каналов найдено: ${list.length}, но ни один сейчас не работает. Причина написана в списке ниже — её устраняют в кабинете Wazzup.`);
  else toast(`Каналов найдено и сохранено: ${list.length}, из них работают: ${working}`);
  render();
}
// Адрес вебхука Wazzup — один и для показа, и для регистрации. Раньше регистрация
// отправляла адрес без кода защиты и без сохранённого публичного адреса: Wazzup
// делал проверочный запрос, получал 403 и отказывался регистрировать вебхук.
function wazzupHookUrl(s) {
  const st = s || state.cache.settings || {};
  const origin = String(st.public_url || location.origin).replace(/\/+$/, '');
  const secret = (st.wazzup && st.wazzup.webhook_secret) || '';
  return origin + '/webhooks/wazzup' + (secret ? '?secret=' + encodeURIComponent(secret) : '');
}
async function registerWazzupWebhook() {
  const st = state.cache.settings || {};
  const saved = String((st.wazzup && st.wazzup.webhook_secret) || '');
  const typed = $('#wzSecret') ? $('#wzSecret').value.trim() : saved;
  const savedUrl = String(st.public_url || '');
  const typedUrl = $('#publicUrl') ? $('#publicUrl').value.trim() : savedUrl;
  // регистрация отправляет адрес в Wazzup, а принимает его CRM по сохранённым
  // настройкам: если код защиты или адрес изменили и не сохранили, Wazzup получит
  // адрес, на который CRM ответит отказом, и регистрация не пройдёт
  if (typed !== saved || typedUrl !== savedUrl) {
    toast('Сначала нажмите «Сохранить»: Wazzup проверяет адрес сразу, а CRM принимает его по сохранённым настройкам', 'err');
    return;
  }
  const url = wazzupHookUrl(st);
  try { await api('/api/integrations/wazzup/webhook', { method: 'POST', body: JSON.stringify({ url }) }); toast('Вебхук зарегистрирован'); }
  catch (e) { toast(e.message, 'err'); }
}
// Диагностика источников: один запрос — видно, кто отвечает, а кто просит ключ.
const PROBE_STATUS = { ok: ['отвечает', ''], skipped: ['нужен ключ', 'grey'], blocked: ['закрыт от автоматических запросов', 'orange'], error: ['не ответил', 'orange'] };
async function probeSources(btn) {
  const host = $('#srcProbe');
  if (!host) return;
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }
  host.innerHTML = '<p class="form-hint" style="margin:0">Опрашиваем источники тестовой компанией… Это занимает до минуты.</p>';
  try {
    const d = await api('/api/competitor-sources/check', { method: 'POST', signal: AbortSignal.timeout(150000) });
    host.innerHTML = `<h4>Доступность источников</h4>
     <table class="mini"><tr><th>Источник</th><th>Статус</th><th>Ответ</th><th>Время</th></tr>
     ${(d.results || []).map(r => { const [label, cls] = PROBE_STATUS[r.status] || [r.status, 'grey'];
       return `<tr><td><b>${esc(r.name)}</b></td><td><span class="tag ${cls}">${esc(label)}</span></td><td><small>${esc(r.summary || '—')}</small></td><td><small>${(r.ms / 1000).toFixed(1)} с</small></td></tr>`; }).join('')}</table>
     <p><small>Проверка ничего не сохраняет: это только опрос доступности. «Закрыт от автоматических запросов» — обычное дело для сайтов с защитой от роботов: данные в этом случае смотрятся по ссылкам в отчёте.</small></p>`;
    toast('Источники проверены');
  } catch (e) {
    host.innerHTML = `<p class="form-hint">${esc(e.message)}</p>`;
    toast(e.message, 'err');
  } finally {
    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
  }
}
async function saveCompetitorKeys(e) { e.preventDefault(); const b = {}; for (const [k, v] of new FormData(e.target)) if (v && !String(v).includes('•')) b[k] = v; await api('/api/competitor-sources', { method: 'PUT', body: JSON.stringify(b) }); toast('Ключи сохранены'); render(); return false; }
async function saveCompetitorUrls(e) { e.preventDefault(); const b = {}; for (const [k, v] of new FormData(e.target)) if (v) b[k] = v; await api('/api/competitor-sources', { method: 'PUT', body: JSON.stringify(b) }); toast('Адреса сохранены'); render(); return false; }
async function saveCompanySettings(e) { e.preventDefault(); await api('/api/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); toast('Сохранено'); state.cache.settings = null; render(); return false; }
function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, b => ('0' + b.toString(16)).slice(-2)).join('');
}
function genWebhookSecret() {
  $('#whSecret').value = randomSecret();
}
function genEmailSecret() {
  $('#emailSecret').value = randomSecret();
}
async function saveEmailSecret() {
  const v = ($('#emailSecret')?.value || '').trim();
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ EMAIL_WEBHOOK_SECRET: v }) });
  toast(v ? 'Секрет входящих писем сохранён' : 'Секрет убран: письма принимаются без него');
  state.cache.settings = null; render();
}
async function saveWebhookSecret() {
  const v = ($('#whSecret')?.value || '').trim();
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ WEBHOOK_SECRET: v }) });
  toast(v ? 'Секрет сохранён — форма ниже уже обновлена' : 'Секрет убран: заявки принимаются без него');
  state.cache.settings = null; render();
}
async function saveMaintenance(e) { e.preventDefault(); await api('/api/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); toast('Настройки обслуживания сохранены'); state.cache.settings = null; render(); return false; }
async function saveAdvanced(e) { e.preventDefault(); await api('/api/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); toast('Параметры сохранены'); render(); return false; }
async function savePassword(e) { e.preventDefault(); try { const result = await api('/api/me/password', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); storeSessionToken(result.token); e.target.reset(); toast('Пароль изменён, другие сеансы завершены'); } catch (err) { toast(err.message, 'err'); } return false; }
function addPipeline() { askInput({ title: 'Новая воронка', label: 'Название воронки', value: 'Новая воронка', okText: 'Создать' }, name => { if (!name) return; (async () => { await api('/api/pipelines', { method: 'POST', body: JSON.stringify({ name }) }); toast('Воронка создана'); render(); })(); }); }
async function openPipelineEditor() { return editPipeline(state.pipeline || 1); }
async function editPipeline(id) {
  const pl = (await api('/api/pipelines')).find(p => p.id === id); const stages = JSON.parse(JSON.stringify(pl.stages));
  const row = (s, i) => `<div class="st" data-i="${i}"><span>${i + 1}</span><input value="${esc(s.name)}" oninput="pkStage(${i},'name',this.value)"><input type="color" value="${esc(s.color)}" oninput="pkStage(${i},'color',this.value)"><select onchange="pkStage(${i},'kind',this.value)">${['open', 'won', 'lost'].map(k => `<option value="${k}" ${k === (s.kind || 'open') ? 'selected' : ''}>${({ open: 'обычный', won: 'успех', lost: 'отказ' })[k]}</option>`).join('')}</select><button class="btn sm danger" onclick="pkDel(${i})">${icon('close', 13)}</button></div>`;
  window.__pk = { id, name: pl.name, stages };
  openModal(`<h3>Воронка «${esc(pl.name)}»</h3>
   <label>Название воронки<input id="pkName" value="${esc(pl.name)}" oninput="window.__pk.name=this.value"></label>
   <div class="stages-editor" id="pkList">${stages.map(row).join('')}</div>
   <p><button class="btn sm" onclick="pkAdd()">+ Добавить этап</button></p>
   <button class="btn primary w" onclick="pkSave()">Сохранить воронку</button>`);
}
function pkStage(i, k, v) { window.__pk.stages[i][k] = v; }
function pkDel(i) { if (window.__pk.stages.length <= 2) return toast('Нужно минимум 2 этапа'); window.__pk.stages.splice(i, 1); editPipelineRefresh(); }
function pkAdd() { window.__pk.stages.push({ code: 's' + Date.now(), name: 'Новый этап', color: '#16a34a', kind: 'open' }); editPipelineRefresh(); }
function editPipelineRefresh() { const stages = window.__pk.stages; $('#pkList').innerHTML = stages.map((s, i) => `<div class="st"><span>${i + 1}</span><input value="${esc(s.name)}" oninput="pkStage(${i},'name',this.value)"><input type="color" value="${esc(s.color)}" oninput="pkStage(${i},'color',this.value)"><select onchange="pkStage(${i},'kind',this.value)">${['open', 'won', 'lost'].map(k => `<option value="${k}" ${k === (s.kind || 'open') ? 'selected' : ''}>${({ open: 'обычный', won: 'успех', lost: 'отказ' })[k]}</option>`).join('')}</select><button class="btn sm danger" onclick="pkDel(${i})">${icon('close', 13)}</button></div>`).join(''); }
async function pkSave() {
  const btn = document.querySelector('#modalBody .btn.primary');
  if (btn) btn.disabled = true;
  try {
    await api('/api/pipelines/' + window.__pk.id, { method: 'PUT', body: JSON.stringify(window.__pk) });
    closeModal(); toast('Воронка сохранена');
    state.pipelines = []; state.stages = []; render();
  } catch (err) { toast(err.message, 'err'); }
  finally { if (btn) btn.disabled = false; }
}
const AUTO_TRIGGERS = { deal_created: 'Появилась новая сделка', message_in: 'Клиент написал сообщение', stage_changed: 'Сделку перевели на другой этап' };
const AUTO_ACTIONS = {
  create_task: 'Создать задачу',
  change_stage: 'Перевести сделку на этап',
  add_tag: 'Добавить клиенту тег',
  send_message: 'Отправить клиенту сообщение в чат',
  send_email: 'Отправить клиенту письмо',
  assign_user: 'Передать сделку сотруднику',
};
function autoStageOptions(sel) {
  const list = window.__autoStages || [];
  return list.map(s2 => `<option value="${esc(s2.code)}" ${s2.code === sel ? 'selected' : ''}>${esc(s2.name)}${s2.kind === 'won' ? ' (успех)' : s2.kind === 'lost' ? ' (отказ)' : ''}</option>`).join('');
}
// Условие события: для смены этапа — этап из списка, для сообщения — ключевое слово.
function autoTriggerField(a) {
  const t = a.trigger_type || 'deal_created';
  if (t === 'stage_changed') return `<label>На какой этап перевели<select name="trigger_value"><option value="">Любой этап</option>${autoStageOptions(a.trigger_value)}</select></label>
   <p class="form-hint" style="margin:-6px 0 10px">«Любой этап» — правило сработает на каждом переходе. Выберите конкретный этап, чтобы правило не повторялось лишний раз.</p>`;
  if (t === 'message_in') return `<label>Слово или фраза в сообщении (необязательно)<input name="trigger_value" value="${esc(a.trigger_value || '')}" placeholder="смета, цена, ипотека"></label>
   <p class="form-hint" style="margin:-6px 0 10px">Пусто — правило срабатывает на любое входящее сообщение. Можно несколько слов через запятую — хватит любого из них. Слово ищется по основе: «смета» находит и «смету», и «сметы», регистр не важен.</p>`;
  return `<input type="hidden" name="trigger_value" value="">`;
}
// Значение действия: этап выбирается из воронки, тег и текст задачи пишутся словами.
function autoActionField(a) {
  const t = a.action_type || 'create_task';
  if (t === 'send_message') return `<label>Текст сообщения<input name="action_value" required value="${esc(a.action_value || '')}" placeholder="{name}, отправляю смету по заявке «{deal}»"></label>
   <p class="form-hint" style="margin:-6px 0 10px">Уходит в тот канал, откуда клиент писал: WhatsApp, Telegram или другой. Можно подставить {name} — имя клиента, {deal} — название сделки, {sum} — сумму, {company} — название вашей компании. Если переписки с клиентом ещё нет, правило отметит это в истории и ничего не отправит.</p>`;
  if (t === 'send_email') return `<label>Текст письма<textarea name="action_value" rows="4" required placeholder="{name}, добрый день! Направляю предложение по заявке «{deal}».">${esc(a.action_value || '')}</textarea></label>
   <p class="form-hint" style="margin:-6px 0 10px">Тема письма — название правила. Подстановки те же: {name}, {deal}, {sum}, {company}. Письмо уходит на e-mail из карточки клиента; без него или без настроенной почты правило напишет об этом в историю.</p>`;
  if (t === 'assign_user') return `<label>Кому передать<select name="action_value" required>${(window.__autoUsers || []).map(u => `<option value="${u.id}" ${String(u.id) === String(a.action_value || '') ? 'selected' : ''}>${esc(u.name)} — ${esc(roleLabel(u.role))}</option>`).join('')}</select></label>
   <p class="form-hint" style="margin:-6px 0 10px">Сделка и клиент переходят к этому сотруднику, он получает уведомление. Удобно для ночных обращений: утром их разбирает дежурный.</p>`;
  if (t === 'change_stage') return `<label>Этап, на который перевести сделку<select name="action_value" required>${autoStageOptions(a.action_value)}</select></label>
   <p class="form-hint" style="margin:-6px 0 10px">Этап берётся из вашей воронки. Если сделка уже на этом этапе, правило ничего не меняет.</p>`;
  if (t === 'add_tag') return `<label>Тег<input name="action_value" required value="${esc(a.action_value || '')}" placeholder="Горячий, Нужна смета, Ипотека"></label>
   <p class="form-hint" style="margin:-6px 0 10px">Тег появится в карточке клиента и в фильтре контактов. Повторно один и тот же тег не ставится.</p>`;
  return `<label>Текст задачи<input name="action_value" required value="${esc(a.action_value || '')}" placeholder="Позвонить клиенту: уточнить задачу и участок"></label>
   <p class="form-hint" style="margin:-6px 0 10px">Задача ставится ответственному за сделку или клиента, срок — сегодня 14:00. Он получит уведомление.</p>`;
}
// При смене события или действия поле значения меняется на подходящее по смыслу.
function autoFields(form) {
  const draft = { trigger_type: form.elements.trigger_type.value, action_type: form.elements.action_type.value, trigger_value: '', action_value: '' };
  const tv = $('#autoTriggerValue'); if (tv) tv.innerHTML = autoTriggerField(draft);
  const av = $('#autoActionValue'); if (av) av.innerHTML = autoActionField(draft);
}
async function openAutomation(id) {
  // список сотрудников нужен действию «передать сделку»: выбирать из живых,
  // а не вписывать идентификатор руками
  const [rows, pl, staff] = await Promise.all([api('/api/automations'), api('/api/pipelines'), team()]);
  const a = id ? (rows.find(x => x.id === id) || {}) : {};
  window.__autoStages = pl.flatMap(p => p.stages.map(st => ({ ...st, pipeline: p.name })));
  window.__autoUsers = (staff || []).filter(u => u.active !== 0);
  openModal(`<h3>${id ? 'Правило автоматизации' : 'Новое правило автоматизации'}</h3>
   <p class="form-hint">Правило состоит из двух частей: <b>когда</b> случилось и <b>что</b> сделать. Пример: «Появилась новая сделка → создать задачу «Позвонить клиенту»».</p>
   <form onsubmit="return saveAutomation(event,${id || 'null'})">
   ${fld('Название правила', `<input name="name" required value="${esc(a.name || '')}" placeholder="Новый лид — позвонить">`, true)}
   ${fld('Когда срабатывает', `<select name="trigger_type" onchange="autoFields(this.form)">${Object.entries(AUTO_TRIGGERS).map(([k, n]) => `<option value="${k}" ${k === (a.trigger_type || 'deal_created') ? 'selected' : ''}>${n}</option>`).join('')}</select>`, true)}
   <div id="autoTriggerValue">${autoTriggerField(a)}</div>
   ${fld('Что сделать', `<select name="action_type" onchange="autoFields(this.form)">${Object.entries(AUTO_ACTIONS).map(([k, n]) => `<option value="${k}" ${k === (a.action_type || 'create_task') ? 'selected' : ''}>${n}</option>`).join('')}</select>`, true)}
   <div id="autoActionValue">${autoActionField(a)}</div>
   ${fld('Когда выполнить', `<select name="delay_days">${[0, 1, 2, 3, 5, 7, 14, 30].map(n => `<option value="${n}" ${Number(a.delay_days || 0) === n ? 'selected' : ''}>${n === 0 ? 'Сразу' : 'Через ' + n + ' дн.'}</option>`).join('')}</select>`)}
   <p class="form-hint" style="margin:-6px 0 10px">«Через N дн.» — CRM запомнит действие и выполнит его в срок, даже если страницу закрыли. Отсчёт идёт от момента события, дата указывается в истории сделки.</p>
   <label class="check-line"><input type="checkbox" name="active" style="width:auto" ${a.active === 0 ? '' : 'checked'}><span>Правило включено <small>(можно сохранить выключенным и включить позже)</small></span></label>
   <button class="btn primary w">${id ? 'Сохранить правило' : 'Создать правило'}</button></form>`);
}
async function saveAutomation(e, id) {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target));
  b.active = e.target.elements.active && e.target.elements.active.checked ? 1 : 0;
  b.delay_days = Number(b.delay_days) || 0;
  try {
    await api(id ? '/api/automations/' + id : '/api/automations', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) });
  } catch (err) { toast(err.message, 'err'); return false; }
  closeModal(); toast(id ? 'Правило сохранено' : 'Правило создано и уже работает'); render(); return false;
}
// Отмена запланированного действия: правило с выдержкой могло стать неактуальным,
// а держать его в очереди — значит отправить клиенту лишнее сообщение.
function cancelQueued(id) {
  askConfirm('Отменить запланированное действие? Оно не выполнится.', async () => {
    try { await api('/api/automation-queue/' + id, { method: 'DELETE' }); closeModal(); toast('Запланированное действие отменено'); render(); }
    catch (e) { toast(e.message, 'err'); }
  }, { okText: 'Отменить действие' });
}
// Недоступные каналы только мешают списку: по умолчанию скрыты, администратор
// показывает их одним нажатием, чтобы посмотреть причину.
function toggleDeadChannels() { state.showDeadChannels = !state.showDeadChannels; render(); }
// Переключатель «Вкл.» в таблице правил: при ошибке галочка возвращается назад.
async function toggleAutomation(id, el) {
  try {
    await api('/api/automations/' + id, { method: 'PATCH', body: JSON.stringify({ active: el.checked ? 1 : 0 }) });
    toast(el.checked ? 'Правило включено' : 'Правило выключено');
  } catch (e) { el.checked = !el.checked; toast(e.message, 'err'); }
}
async function openTemplate(id = null) {
  const rows = await api('/api/templates'); const t = id ? (rows.find(x => x.id === id) || {}) : {};
  openModal(`<h3>${id ? 'Шаблон' : 'Новый шаблон'}</h3><form onsubmit="return saveTemplate(event,${id || 'null'})"><label>Название<input name="name" required value="${esc(t.name || '')}" placeholder="Приветствие"></label>
   <label>Текст сообщения<textarea name="body" rows="5" required placeholder="Здравствуйте, {name}! …">${esc(t.body || '')}</textarea></label>
   <p><small>Подстановки: {name} — имя клиента, {sum} — сумма его открытой сделки, {date} — сегодняшняя дата. Текст можно поправить после подстановки в чате.</small></p>
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveTemplate(e, id) {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target));
  await api(id ? '/api/templates/' + id : '/api/templates', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) });
  state.cache.templates = null; closeModal(); toast('Шаблон сохранён'); render(); return false;
}
function delTemplate(id) {
  askConfirm('Удалить шаблон? Он исчезнет из списка в поле ввода чата.', async () => {
    await api('/api/templates/' + id, { method: 'DELETE' });
    state.cache.templates = null; toast('Шаблон удалён'); render();
  }, { okText: 'Удалить' });
}
async function openUser(id) {
  const rows = await api('/api/users'); const x = id ? (rows.find(u => u.id === id) || {}) : {};
  openModal(`<h3>${id ? 'Пользователь' : 'Новый пользователь'}</h3><form onsubmit="return saveUser(event,${id || 'null'})">
   <label>Имя<input name="name" required value="${esc(x.name || '')}"></label><label>E-mail<input name="email" type="email" required value="${esc(x.email || '')}"></label>
   <label>Роль<select name="role">${Object.entries({ admin: 'Администратор — всё, включая настройки', manager: 'Менеджер — клиенты, сделки, задачи, чаты', viewer: 'Наблюдатель — только просмотр' }).map(([k, n]) => `<option value="${k}" ${k === (x.role || 'manager') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
   <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="active" style="width:auto" ${x.active === 0 ? '' : 'checked'}> Сотрудник может входить в CRM</label>
   <label>${id ? 'Новый пароль (оставьте пустым, чтобы не менять)' : 'Пароль (мин. 8 символов)'}
     <div class="pw-wrap"><input name="password" type="password" minlength="8" autocomplete="new-password" ${id ? '' : 'required'} placeholder="минимум 8 знаков"><button type="button" class="pw-eye" title="Показать/скрыть пароль" onclick="togglePass(this)">${icon('eye', 16)}</button></div>
   </label>
   <button type="button" class="btn w" onclick="generateUserPassword(this.form)">Сгенерировать пароль</button>
   <p><small>Сохраните пароль и передайте сотруднику по защищённому каналу. Он сможет изменить его в профиле.</small></p>
   <button class="btn primary w">Сохранить</button></form>`);
}
function generateUserPassword(form) {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';
  const input = form.elements.password;
  input.value = Array.from(bytes, n => alphabet[n & 63] || '_').join('');
  input.type = 'text';
  input.focus(); input.select();
}
async function saveUser(e, id) {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target));
  if (!b.password) delete b.password;
  b.active = b.active ? 1 : 0;
  const btn = e.target.querySelector('button[type="submit"]') || e.target.querySelector('.btn.primary');
  btn.disabled = true;
  try {
    await api(id ? '/api/users/' + id : '/api/users', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) });
    closeModal();
    if (b.password) {
      const credentials = `КаркасCRM — данные для входа\nАдрес: ${humanOrigin((state.cache.settings && state.cache.settings.public_url) || location.origin)}\nИмя: ${b.name}\nE-mail: ${b.email}\nВременный пароль: ${b.password}\n\nПри первом входе задайте личный пароль (не менее 12 символов). Не передавайте эти данные другим людям.`;
      openModal(`<h3>${id ? 'Пароль обновлён' : 'Пользователь создан'}</h3><p>Передайте данные сотруднику по защищённому каналу. После закрытия окна пароль повторно не показывается.</p>${!b.active ? '<p class="err">Вход отключён. Разрешите вход в карточке сотрудника.</p>' : ''}<label>Данные для входа<textarea id="createdCredentials" rows="9" readonly>${esc(credentials)}</textarea></label><button type="button" class="btn primary w" onclick="copyCreatedCredentials()">Скопировать данные</button><p id="copyCredentialsStatus" role="status"></p>`);
    } else toast('Пользователь сохранён');
    render();
  } catch (err) { toast(err.message, 'err'); }
  finally { btn.disabled = false; }
  return false;
}
async function copyCreatedCredentials() {
  const field = $('#createdCredentials'), status = $('#copyCredentialsStatus');
  if (!field) return; // окно с паролем уже закрыто — копировать нечего
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(field.value);
    if (status) status.textContent = 'Данные скопированы. Передайте их сотруднику лично.';
  } catch {
    field.focus(); field.select();
    if (status) status.textContent = 'Автоматическое копирование недоступно. Нажмите Ctrl+C или скопируйте выделенный текст вручную.';
  }
}

// Состояние выгрузки показываем всегда: и когда всё хорошо, и когда хранилище
// недоступно. Молча невыгруженная копия выглядит как «настроено и работает».
function s3line(s3) {
  if (!s3) return '';
  if (!s3.configured) return `<p><small>Хранилище не настроено${(s3.missing || []).length ? ': не заполнено ' + esc(s3.missing.join(', ')) : ''}. Копии остаются только на этом сервере.</small></p>`;
  const bad = s3.last_error ? `<p><small>Последняя выгрузка не удалась: ${esc(s3.last_error)}</small></p>` : '';
  const good = s3.last_ok ? `<p><small>Последняя выгрузка: <b>${esc(dt(s3.last_ok))}</b>${s3.last_file ? ' · ' + esc(s3.last_file) : ''} · ${esc(s3.bucket)}</small></p>` : '<p><small>Хранилище настроено, но копии ещё не выгружались.</small></p>';
  return good + bad;
}
async function saveS3(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = {};
  for (const [k, v] of f.entries()) body[k] = String(v).trim();
  body.S3_AUTO = f.get('S3_AUTO') ? '1' : '0';
  if (!body.S3_SECRET_KEY) delete body.S3_SECRET_KEY; // пустое поле = ключ не меняем
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
    toast('Настройки хранилища сохранены');
    const check = await api('/api/backups/s3', { method: 'POST' }).catch(err => ({ error: err.message }));
    await render();
    toast(check.ok ? 'Проверили: копия ушла в хранилище' : 'Сохранено, но выгрузка не прошла: ' + (check.error || ''), check.ok ? 'ok' : 'err');
  } catch (err) { toast(err.message, 'err'); }
  return false;
}
async function uploadS3() {
  toast('Отправляем копию в хранилище…');
  try {
    const r = await api('/api/backups/s3', { method: 'POST' });
    toast('Копия ' + r.name + ' выгружена в ' + r.bucket + (r.removed ? ', старых удалено: ' + r.removed : ''));
  } catch (e) { toast(e.message, 'err'); }
  const host = $('#s3status');
  if (host) { try { host.innerHTML = s3line((await api('/api/backups')).s3) } catch {} }
}

async function loadBackups() {
  const host = $('#backupList'); if (!host) return;
  try { const d = await api('/api/backups');
    const isAdmin = ((state.me || {}).role) === 'admin';
    const files = (d.files || []).slice(0, 8);
    window.__backups = files.map(f => f.name);
    host.innerHTML = `<table class="mini"><tr><th>Файл</th><th>Размер</th><th>Создан</th><th></th></tr>${files.map((f, i) => `<tr><td>${esc(f.name)}</td><td>${(f.sizeBytes / 1024 | 0)} КБ</td><td><small>${esc(dt(f.created_at))}</small></td><td style="white-space:nowrap">${isAdmin ? `<button class="btn sm" onclick="downloadBackup(${i})" title="Скачать копию">${icon('download', 13)}</button> <button class="btn sm" onclick="restoreBackupAt(${i})" title="Восстановить">${icon('refresh', 13)}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4"><small>Копий пока нет — создайте первую</small></td></tr>'}</table>
     ${isAdmin ? `<p><small>Копии создаются автоматически каждую ночь и хранятся ${esc(String((state.cache.settings && state.cache.settings.maintenance && state.cache.settings.maintenance.backup_keep_days) || 7))} дней. Перед каждым обновлением система дополнительно сохраняет страховочную копию.</small></p>` : ''}`;
  } catch (e) { host.innerHTML = `<small>${esc(e.message)}</small>`; }
}
function downloadBackup(i) {
  const name = (window.__backups || [])[i];
  if (!name) return toast('Копия не найдена — обновите список', 'err');
  download('/api/backups/download?file=' + encodeURIComponent(name), name);
}
function restoreBackupAt(i) {
  const name = (window.__backups || [])[i];
  if (name) restoreBackup(name);
}
async function makeBackup() { const r = await api('/api/backups', { method: 'POST' }); toast('Копия создана: ' + r.created); loadBackups(); }
function cleanDemo() {
  askConfirm('Удалить все демонстрационные данные — клиентов, сделки, задачи, чаты и конкурентов-примеров? Реальные данные не затронутся.', async () => {
    const r = await api('/api/demo/cleanup', { method: 'POST' });
    toast('Удалено записей: ' + r.removed);
    state.cache.templates = null;
    render();
  }, { okText: 'Удалить демо-данные' });
}
// После восстановления базы сервер завершает процесс (Docker поднимает контейнер сам).
// Вместо «слепой» перезагрузки ждём, пока CRM снова ответит, и только тогда обновляем страницу.
function waitServerBack() {
  const el = document.createElement('div');
  el.className = 'restart-screen';
  el.innerHTML = `<div class="restart-card"><h3>База восстановлена</h3>
    <p>Сервер перезапускается — обычно это занимает несколько секунд.</p>
    <div class="bar"><i></i></div>
    <small id="restartHint">Ждём ответа CRM…</small></div>`;
  document.body.appendChild(el);
  let tries = 0;
  const timer = setInterval(async () => {
    tries++;
    try { const r = await fetch('/api/health', { cache: 'no-store' }); if (r.ok) { clearInterval(timer); location.reload(); return; } } catch { }
    if (tries > 40) {
      clearInterval(timer);
      const hint = el.querySelector('#restartHint');
      if (hint) hint.innerHTML = 'CRM не поднялась автоматически. Запустите её снова: <code>docker compose up -d</code> (или <code>./run-local.sh</code>) и обновите страницу.';
    }
  }, 1500);
}
function restoreBackup(file) {
  askConfirm(`Восстановить базу из копии «${file}»? Текущие данные будут заменены. Перед восстановлением система сохранит страховочную копию.`, () => {
    (async () => {
      try {
        const r = await api('/api/backups/restore', { method: 'POST', body: JSON.stringify({ file }) });
        toast(r.message || 'База восстановлена');
        waitServerBack();
      } catch (e) { toast(e.message, 'err'); }
    })();
  }, { okText: 'Восстановить', danger: false });
}
async function importContacts() { openModal(`<h3>Импорт контактов из CSV</h3><p><small>Первая строка — заголовки: <code>Имя;Телефон;E-mail;Компания</code>. Разделитель — <code>;</code> или <code>,</code>.</small></p><form onsubmit="return doImport(event)"><label>Вставьте CSV<textarea name="csv" rows="8" placeholder="Имя;Телефон;E-mail;Компания&#10;Иван Петров;+7 900 111-22-33;ivan@mail.ru;ООО Иван"></textarea></label><label>…или выберите файл<input type="file" accept=".csv,text/csv" onchange="csvFromFile(this)"></label><button class="btn primary w">Импортировать</button></form>`); }
function csvFromFile(input) { const f = input.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { $('#modalBody textarea').value = r.result; }; r.readAsText(f); }
async function doImport(e) { e.preventDefault(); const d = await api('/api/import/contacts', { method: 'POST', body: JSON.stringify({ csv: new FormData(e.target).get('csv') }) }); closeModal(); toast(d.message || ('Импортировано контактов: ' + d.imported)); render(); return false; }
const DEL_LABELS = { contacts: 'контакт', companies: 'компанию', deals: 'сделку', tasks: 'задачу', products: 'позицию каталога', automations: 'правило', pipelines: 'воронку' };
function del(table, id, name = '') {
  const what = DEL_LABELS[table] || 'запись';
  askConfirm(`Удалить ${what}${name ? ' «' + name + '»' : ''}? Действие необратимо.`, async () => {
    await api(`/api/${table}/${id}`, { method: 'DELETE' });
    if (table === 'products') state.ourPrices = null; // прайс-лист = каталог
    closeModal(); toast('Удалено'); render();
  }, { okText: 'Удалить' });
}

/* ---------- global search + realtime ---------- */
let searchT;
const si = $('#globalSearch');
/* ---------- выпадающее меню ----------
   Меню крепится к body и ставится по координатам кнопки: его не прячет
   ни таблица снизу, ни карточка с собственной рамкой, ни край экрана. */
let __menuCleanup = null;
function closeMenu() {
  const m = document.getElementById('popMenu');
  if (m) m.remove();
  if (__menuCleanup) { __menuCleanup(); __menuCleanup = null; }
}
function openMenu(evt, html) {
  evt.preventDefault(); evt.stopPropagation();
  closeMenu();
  const anchor = evt.currentTarget || evt.target;
  const m = document.createElement('div');
  m.id = 'popMenu';
  m.className = 'dropdown-pop menu-fixed';
  m.innerHTML = html;
  document.body.appendChild(m);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth || 220, mh = m.offsetHeight || 140;
    const left = Math.min(Math.max(8, r.right - mw), Math.max(8, window.innerWidth - mw - 8));
    // снизу места мало — открываем вверх
    const top = (r.bottom + 6 + mh > window.innerHeight - 8) ? Math.max(8, r.top - mh - 6) : r.bottom + 6;
    m.style.left = left + 'px';
    m.style.top = top + 'px';
  };
  place();
  const onKey = e => { if (e.key === 'Escape') { closeMenu(); anchor.focus && anchor.focus(); } };
  const onDoc = e => { if (!m.contains(e.target) && e.target !== anchor) closeMenu(); };
  document.addEventListener('click', onDoc, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', closeMenu, true);
  __menuCleanup = () => {
    document.removeEventListener('click', onDoc, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', closeMenu, true);
  };
  const first = m.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}
function closeSearchResults(clear = false) {
  const box = $('#searchResults');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
  if (clear) { const i = $('#globalSearch'); if (i) i.value = ''; }
}
if (si) {
  si.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSearchResults(); si.blur(); }
    if (e.key === 'Enter') {
      const first = $('#searchResults div[onclick]');
      if (first) { e.preventDefault(); first.click(); }
    }
  });
  si.oninput = e => {
    clearTimeout(searchT);
    const q = e.target.value.trim();
    if (!q) { $('#searchResults').classList.add('hidden'); return; }
    searchT = setTimeout(async () => {
      const d = await api('/api/search?q=' + encodeURIComponent(q));
      const box = $('#searchResults');
      const empty = '<small style="padding:8px 12px;color:var(--muted)">Ничего не найдено</small>';
      const sections = [];
      if (d.contacts.length) sections.push(`<h4>Клиенты</h4>${d.contacts.map(c => `<div onclick="closeSearchResults(true);openContactCard(${c.id})">${esc(c.name)} · <small>${esc(c.phone || c.email || '')}</small></div>`).join('')}`);
      if (d.deals.length) sections.push(`<h4>Сделки</h4>${d.deals.map(x => `<div onclick="closeSearchResults(true);openDealCard(${x.id})">${esc(x.title)} · <b>${fmt(x.amount)}</b></div>`).join('')}`);
      if (d.companies.length) sections.push(`<h4>Компании</h4>${d.companies.map(c => `<div onclick="closeSearchResults(true);openCompany(${c.id})">${esc(c.name)} · <small>${esc(c.inn || '')}</small></div>`).join('')}`);
      if (d.tasks && d.tasks.length) sections.push(`<h4>Задачи</h4>${d.tasks.map(t => `<div onclick="closeSearchResults(true);openTask(${t.id})">${esc(t.title)} · <small>${esc(t.due ? dueText(t.due) : 'без срока')}</small></div>`).join('')}`);
      if (d.products && d.products.length) sections.push(`<h4>Каталог и прайс</h4>${d.products.map(pr => `<div onclick="closeSearchResults(true);openProduct(${pr.id})">${esc(pr.name)} · <b>${fmt(pr.price)}</b>${pr.sku ? ` · <small>${esc(pr.sku)}</small>` : ''}</div>`).join('')}`);
      box.innerHTML = sections.join('') || empty;
      box.classList.remove('hidden');
    }, 200);
  };
  document.addEventListener('click', e => { if (!e.target.closest('.searchbox')) $('#searchResults')?.classList.add('hidden'); });
}

/* ── палитра команд (Ctrl+K) ────────────────────────────────────────── */
const PALETTE_ACTIONS = [
  { group: 'Разделы', items: [
    { ico: 'dashboard', title: 'Рабочий стол', hint: 'обзор продаж', run: () => go('dashboard') },
    { ico: 'pipe', title: 'Сделки', hint: 'канбан-воронка', run: () => go('pipe') },
    { ico: 'tasks', title: 'Задачи', hint: 'дела и календарь', run: () => go('tasks') },
    { ico: 'inbox', title: 'Чаты', hint: 'единый инбокс мессенджеров', run: () => go('inbox') },
    { ico: 'contacts', title: 'Контакты', hint: 'база клиентов', run: () => go('contacts') },
    { ico: 'companies', title: 'Компании', hint: 'юридические лица', run: () => go('companies') },
    { ico: 'products', title: 'Каталог', hint: 'он же прайс-лист: дома, проекты и опции', run: () => go('products') },
    { ico: 'analytics', title: 'Аналитика', hint: 'воронка и план продаж', run: () => go('analytics') },
    { ico: 'competitors', title: 'Конкуренты', hint: 'разведка и проверка', run: () => go('competitors') },
    { ico: 'settings', title: 'Настройки', hint: 'интеграции и права', run: () => go('settings') }
  ]},
  { group: 'Быстрое создание', items: [
    { ico: 'plus', title: 'Новая сделка', hint: 'открыть форму', run: () => openDeal() },
    { ico: 'plus', title: 'Новый контакт', hint: 'добавить клиента', run: () => openContact() },
    { ico: 'plus', title: 'Новая задача', hint: 'поставить дело', run: () => openTask() },
    { ico: 'company', title: 'Новая компания', hint: 'добавить юрлицо', run: () => openCompany() },
    { ico: 'competitor', title: 'Проверить конкурента', hint: 'найти по ИНН', run: () => { go('competitors'); setTimeout(() => $('#compSearch')?.focus(), 250); } },
    { ico: 'upload', title: 'Импорт контактов из CSV', hint: 'загрузить файл', run: () => importContacts() }
  ]},
  { group: 'Интерфейс', items: [
    { ico: 'sun', title: 'Светлая тема', hint: 'включить светлую', run: () => applyTheme('light') },
    { ico: 'moon', title: 'Тёмная тема', hint: 'включить тёмную', run: () => applyTheme('dark') },
    { ico: 'theme', title: 'Тема как в системе', hint: 'автоматически', run: () => applyTheme('auto') },
    { ico: 'bell', title: 'Уведомления и задачи на сегодня', hint: 'открыть список', run: () => openNotifications() }
  ]}
];

let paletteIdx = 0;
let paletteFlat = [];

function paletteCommands(query = '') {
  const q = query.trim().toLowerCase();
  const res = [];
  for (const g of PALETTE_ACTIONS) {
    const matched = g.items.filter(it => !q || (it.title + ' ' + (it.hint || '')).toLowerCase().includes(q));
    if (matched.length) res.push({ group: g.group, items: matched });
  }
  return res;
}

function paletteShell() {
  let el = $('#palette');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'palette';
  el.className = 'palette hidden';
  el.innerHTML = `
    <div class="palette-card">
      <input id="paletteInput" placeholder="Поиск по разделу, клиенту или действию…" autocomplete="off">
      <div id="paletteList" class="palette-list"></div>
      <div class="palette-foot"><span>↑ / ↓ — выбор</span><span>Enter — перейти</span><span>Esc — закрыть</span></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) closePalette(); });
  const input = el.querySelector('#paletteInput');
  input.addEventListener('input', e => paletteRender(e.target.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteIdx = Math.min(paletteFlat.length - 1, paletteIdx + 1); paletteHighlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIdx = Math.max(0, paletteIdx - 1); paletteHighlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); runPaletteRow(paletteIdx); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  return el;
}

function openPalette(initQuery = '') {
  const el = paletteShell();
  el.classList.remove('hidden');
  const input = el.querySelector('#paletteInput');
  input.value = initQuery;
  paletteIdx = 0;
  paletteRender(initQuery);
  setTimeout(() => { input.focus(); input.select(); }, 40);
}
function closePalette() { const el = $('#palette'); if (el) el.classList.add('hidden'); }

let paletteSearchTimer = null;
async function paletteRender(query = '') {
  paletteIdx = 0;
  const groups = paletteCommands(query);
  paletteFlat = [];
  groups.forEach(g => g.items.forEach(it => paletteFlat.push(it)));
  const listEl = $('#paletteList');
  if (!listEl) return;
  listEl.innerHTML = groups.map(g => `
    <div class="p-group">${esc(g.group)}</div>
    ${g.items.map(it => {
      const idx = paletteFlat.indexOf(it);
      return `<div class="p-item ${idx === 0 ? 'active' : ''}" data-idx="${idx}" onclick="runPaletteRow(${idx})">
        <span class="p-ico">${icon(it.ico || 'file', 16)}</span>
        <span style="flex:1"><b>${esc(it.title)}</b>${it.hint ? ' <small>' + esc(it.hint) + '</small>' : ''}</span>
      </div>`;
    }).join('')}`).join('') || '<div style="padding:18px;text-align:center;color:var(--muted)">Ничего не найдено</div>';

  clearTimeout(paletteSearchTimer);
  if (query.trim().length >= 2) {
    paletteSearchTimer = setTimeout(async () => {
      try {
        const d = await api('/api/search?q=' + encodeURIComponent(query.trim()));
        if (!d || (!$('#palette') || $('#palette').classList.contains('hidden'))) return;
        const extra = [];
        (d.contacts || []).slice(0, 4).forEach(c => extra.push({ group: 'Клиенты', ico: 'contact', title: c.name, hint: c.phone || c.email || 'клиент', run: () => openContactCard(c.id) }));
        (d.deals || []).slice(0, 4).forEach(x => extra.push({ group: 'Сделки', ico: 'pipe', title: x.title, hint: fmt(x.amount), run: () => openDealCard(x.id) }));
        (d.companies || []).slice(0, 3).forEach(c => extra.push({ group: 'Компании', ico: 'company', title: c.name, hint: c.inn || 'компания', run: () => openCompany(c.id) }));
        (d.tasks || []).slice(0, 3).forEach(t => extra.push({ group: 'Задачи', ico: 'task', title: t.title, hint: t.due ? dueText(t.due) : 'без срока', run: () => openTask(t.id) }));
        if (extra.length) {
          const byGrp = {};
          extra.forEach(it => { byGrp[it.group] = byGrp[it.group] || []; byGrp[it.group].push(it); paletteFlat.push(it); });
          const extraHtml = Object.entries(byGrp).map(([grp, arr]) => `
            <div class="p-group">${esc(grp)}</div>
            ${arr.map(it => {
              const idx = paletteFlat.indexOf(it);
              return `<div class="p-item" data-idx="${idx}" onclick="runPaletteRow(${idx})">
                <span class="p-ico">${icon(it.ico, 16)}</span>
                <span style="flex:1"><b>${esc(it.title)}</b>${it.hint ? ' <small>' + esc(it.hint) + '</small>' : ''}</span>
              </div>`;
            }).join('')}`).join('');
          listEl.insertAdjacentHTML('beforeend', extraHtml);
        }
      } catch {}
    }, 220);
  }
}

function paletteHighlight() {
  const items = $$('#paletteList .p-item');
  items.forEach(el => {
    const isAct = +el.dataset.idx === paletteIdx;
    el.classList.toggle('active', isAct);
    if (isAct) el.scrollIntoView({ block: 'nearest' });
  });
}
function runPaletteRow(idx) {
  const it = paletteFlat[idx];
  if (!it) return;
  closePalette();
  try { it.run(); } catch (e) { toast(e.message, 'err'); }
}

window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    const p = $('#palette');
    if (p && !p.classList.contains('hidden')) closePalette(); else openPalette();
  }
});

let realtime = null, navTimer = null, __changeTimer = null;
// Один канал realtime на вкладку: повторный вход не должен плодить SSE и таймеры.
function totalStop() {
  if (realtime) { try { realtime.close() } catch {} realtime = null; }
  if (navTimer) { clearInterval(navTimer); navTimer = null; }
}
function connectSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('notify', e => {
    const d = JSON.parse(e.data);
    if (d.type === 'overdue_tasks') {
      notify({
        title: 'Есть просроченные задачи', kind: 'task',
        text: `${d.count} ${plural(d.count, 'задача ждёт', 'задачи ждут', 'задач ждут')} выполнения`,
        actionLabel: 'Открыть задачи',
        onAction: () => { state.taskScope = 'all'; state.taskFilter = 'overdue'; go('tasks'); },
      });
    }
    if (d.type === 'deal_assigned') {
      notify({
        title: 'Вам передали сделку', kind: 'task', text: d.title,
        actionLabel: 'Открыть сделку', onAction: () => openDealCard(d.id),
      });
      api('/api/dashboard').then(navCounts).catch(() => {});
    }
    if (d.type === 'contact_assigned') {
      notify({
        title: 'Вам передали клиента', kind: 'task', text: d.title,
        actionLabel: 'Открыть карточку', onAction: () => openContactCard(d.id),
      });
    }
    if (d.type === 'task_assigned') {
      notify({
        title: 'Вам поставили задачу', kind: 'task',
        text: `${d.title}${d.due ? ' · ' + dueText(d.due) : ''}`,
        actionLabel: 'Открыть задачу',
        onAction: () => openTask(d.id),
      });
      api('/api/dashboard').then(navCounts).catch(() => {});
    }
    if (d.type === 'bulk_assigned') {
      // при массовой передаче — один тост со сводкой, а не сотня одинаковых
      const where = { deals: ['deals', 'сделок'], contacts: ['contacts', 'клиентов'], tasks: ['tasks', 'задач'] }[d.table] || ['dashboard', 'записей'];
      notify({
        title: 'Вам передали записи', kind: 'task', text: `${d.count} ${where[1]}`,
        actionLabel: 'Посмотреть', onAction: () => go(where[0]),
      });
      api('/api/dashboard').then(navCounts).catch(() => {});
    }
    if (state.view === 'inbox') { refreshInbox(); api('/api/dashboard').then(navCounts).catch(() => {}); }
    else if (state.view === 'dashboard') render();
  });
  es.addEventListener('message', e => {
    const d = JSON.parse(e.data);
    // исходящие из другого окна не анонсируем; входящее показываем только если
    // сотрудник не смотрит прямо сейчас этот чат — иначе уведомление мешает
    const sameChat = state.view === 'inbox' && Number(state.conv) === Number(d.conversation_id) && document.hasFocus();
    // чужой клиент не должен отрывать весь офис: уведомление видят ответственный
    // за беседу или клиента и администраторы; остальные получают только счётчик
    const mine = !d.for_user || Number(d.for_user) === Number(meId()) || amAdmin();
    if (d.direction !== 'out' && !sameChat && mine) {
      notify({
        title: 'Новое сообщение', kind: 'message',
        text: `${d.title || 'Клиент'}${d.preview ? ': ' + d.preview : ''}`,
        actionLabel: 'Открыть чат',
        onAction: () => { state.conv = d.conversation_id; state.listOnly = false; go('inbox'); },
      });
    }
    if (state.view === 'inbox') refreshInbox();
    api('/api/dashboard').then(navCounts).catch(() => {});
  });
  es.addEventListener('change', () => {
    // совместная работа: списки обновляются у всех, но открытую карточку не сбиваем.
    // Перерисовку склеиваем: при массовом импорте событий приходит много, а запрос нужен один.
    clearTimeout(__changeTimer);
    __changeTimer = setTimeout(() => {
      const modalOpen = !$('#modal').classList.contains('hidden');
      if (!modalOpen && ['pipe', 'dashboard', 'contacts', 'companies', 'tasks', 'products', 'analytics'].includes(state.view)) render();
    }, 400);
  });
  return es;
}
function initRealtime() {
  totalStop();
  realtime = connectSSE();
  // резервный опрос счётчиков: работает и на cookie-сессии, когда токена в localStorage нет
  navTimer = setInterval(() => { api('/api/dashboard').then(navCounts).catch(() => {}); }, 30000);
}

// любая необработанная ошибка видна пользователю, а не только в консоли
const IGNORED_ERROR = /abort|aborted|timeout|resizeobserver/i;
window.addEventListener('unhandledrejection', e => {
  const msg = e.reason && e.reason.message;
  if (msg && !IGNORED_ERROR.test(msg)) toast(msg, 'err');
});
// ошибка в обработчике клика (inline onclick) не попадает в unhandledrejection —
// без этого слушателя человек увидел бы молча неработающую кнопку
window.addEventListener('error', e => {
  const msg = (e && (e.message || (e.error && e.error.message))) || '';
  if (!msg || IGNORED_ERROR.test(msg)) return;
  toast(msg, 'err');
});

boot();
