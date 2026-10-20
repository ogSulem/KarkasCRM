// КаркасCRM — одностраничный интерфейс (без сборки и внешних зависимостей)
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

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
const SOURCE_LABELS = {
  manual: 'Вручную',
  'wazzup-whatsapp': 'WhatsApp (Wazzup)',
  'wazzup-telegram': 'Telegram (Wazzup)',
  'wazzup-instagram': 'Instagram (Wazzup)',
  'wazzup-viber': 'Viber (Wazzup)',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  instagram: 'Instagram',
  viber: 'Viber',
  email: 'Почта',
  site: 'Сайт',
  avito: 'Авито',
  import: 'Импорт из CSV'
};
const sourceLabel = s => SOURCE_LABELS[s] || (s ? String(s) : 'Вручную');
const sourceOptions = selected => Object.entries(SOURCE_LABELS).map(([code, name]) =>
  `<option value="${code}" ${code === (selected || 'manual') ? 'selected' : ''}>${name}</option>`).join('');

const CHANNEL_LABELS = { whatsapp: 'WhatsApp', telegram: 'Telegram', instagram: 'Instagram', viber: 'Viber', email: 'Почта', any: 'Любой канал' };
const channelLabel = c => CHANNEL_LABELS[c] || c || '';
// бейджи каналов клиента: «WhatsApp · Telegram» — одна строка для списков
const chan = c => (c || 'whatsapp').split(',').map(x => x.trim()).filter(Boolean).map(x => `<span class="chan ${x}">${esc(channelLabel(x))}</span>`).join(' ');

const ROLE_LABELS = { admin: 'Администратор', manager: 'Менеджер', viewer: 'Наблюдатель' };
const roleLabel = r => ROLE_LABELS[r] || r;


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
  view: 'dashboard', settingsTab: 'integrations', pipeline: 1, conv: null,
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
  return raw.replace('T', ' ').slice(0, 16);
};
const dueText = s => s ? String(s).replace('T', ' ').slice(0, 16) : '';
// Локальная дата YYYY-MM-DD. toISOString() здесь нельзя: в Москве он отдаёт
// вчерашний день до 03:00, из-за чего «сегодня» и неделя съезжали на сутки.
const isoDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => isoDate();
function fmtDayMonth(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const t = new Date(); const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
  if (isoDate(d) === isoDate(t)) return 'сегодня';
  if (isoDate(d) === isoDate(tomorrow)) return 'завтра';
  return `${m[3]}.${m[2]}`;
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

function toast(t, kind = 'ok') {
  const e = $('#toast');
  if (!e) return;
  e.textContent = t;
  e.classList.toggle('error', kind === 'err');
  e.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => e.classList.remove('show'), kind === 'err' ? 5200 : 2600);
}
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
  // курсор сразу в первом пустом поле: форма заполняется с клавиатуры, но
  // открытая на просмотр карточка не перехватывает ввод и не портит текст
  const first = $('#modalBody input:not([type=hidden]):not([type=checkbox]):not([disabled]), #modalBody textarea, #modalBody select');
  if (first && !String(first.value || '').length) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch {} }, 30);
}
function closeModal() {
  $('#modal').classList.add('hidden');
  if ($('#createdCredentials')) $('#modalBody').replaceChildren();
}
// Единое аккуратное окно подтверждения вместо системного confirm().
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
function userOptions(selId) {
  return `<option value="">— не назначен —</option>` + __team.map(u => `<option value="${u.id}" ${u.id === selId ? 'selected' : ''}>${esc(u.name)} (${esc(roleLabel(u.role))})</option>`).join('');
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

// Вторичные поля формы прячем под «Дополнительно»: при создании видно
// только главное, а всё остальное доступно в один клик.
const formMore = (html, open = false) => html ? `<details class="form-more"${open ? ' open' : ''}><summary>Дополнительно</summary>${html}</details>` : '';

// ── свои поля (custom fields) ─────────────────────────────────────────────
function cfFor(entity) {
  const all = (state.meta && state.meta.customFields) || [];
  return all.filter(f => f.entity === 'both' || f.entity === entity);
}
function cfValues(custom) {
  try { return typeof custom === 'string' ? JSON.parse(custom || '{}') : (custom || {}); } catch { return {}; }
}
function cfInputs(entity, obj = {}, grid = 2) {
  const fields = cfFor(entity);
  if (!fields.length) return '';
  const val = cfValues(obj.custom);
  return `<div style="display:grid;grid-template-columns:repeat(${grid},1fr);gap:12px">${fields.map(f => {
    const v = esc(val[f.key] ?? '');
    const label = `${esc(f.label)}${f.required ? ' *' : ''}`;
    if (f.type === 'select') return `<label>${label}<select name="cf_${esc(f.key)}" ${f.required ? 'required' : ''}>${['', ...(f.options || [])].map(o => `<option value="${esc(o)}" ${String(val[f.key] ?? '') === o ? 'selected' : ''}>${esc(o || '—')}</option>`).join('')}</select></label>`;
    const t = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text';
    return `<label>${label}<input name="cf_${esc(f.key)}" type="${t}" value="${v}" ${f.required ? 'required' : ''}></label>`;
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
  const rows = fields.filter(f => String(val[f.key] ?? '') !== '').map(f => `<tr><th>${esc(f.label)}</th><td>${esc(val[f.key])}</td></tr>`).join('');
  return rows || '';
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
const TITLES = {
  dashboard: ['Дашборд', 'Продажи, воронка и активность команды'],
  pipe: ['Сделки', 'Воронка продаж — перетаскивайте карточки между этапами'],
  inbox: ['Чаты', 'Единый диалог клиента: WhatsApp, Telegram, Instagram, Viber и почта'],
  contacts: ['Контакты', 'База клиентов с историей, сделками и перепиской'],
  companies: ['Компании', 'Юридические лица, реквизиты и связанные клиенты'],
  tasks: ['Задачи', 'Календарь звонков, встреч и напоминаний по сделкам'],
  products: ['Товары и проекты', 'Каталог домов, бань, комплектаций и услуг'],
  competitors: ['Разведка конкурентов', 'Проверка по 8 источникам: долги, суды, отзывы, сравнение цен'],
  analytics: ['Аналитика', 'Конверсия воронки, план продаж, средний чек и отчёты'],
  settings: ['Настройки', 'Интеграции, воронки, свои поля, правила, команда и бэкапы']
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

// Очередь отрисовки: если пользователь быстро переключает разделы, ответ старого
// запроса не должен перетереть новый экран. Каждый вызов видит актуальный state.view.
let renderQueue = Promise.resolve();
function render() {
  renderQueue = renderQueue.then(renderNow, renderNow);
  return renderQueue;
}
async function renderNow() {
  const v = $('#view');
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
  openModal(`<h3>${icon('bell', 18)} Уведомления и сегодняшние дела</h3>
   <h4 style="margin:12px 0 4px;color:#dc2626">Просрочено: ${over.length}</h4>${over.map(t => {
     const meta = taskDueMeta(t.due, t.done);
     return `<div class="row"><span><b>${esc(t.title)}</b><br><small>${esc(meta.label)} · ${esc(t.contact_name || '')}</small></span><button class="btn sm mark" onclick="toggleTask(${t.id},1);closeModal()">${icon('check', 13)} Выполнить</button></div>`;
   }).join('') || '<small>Нет просроченных задач</small>'}
   <h4 style="margin:16px 0 4px;color:var(--green)">На сегодня: ${now.length}</h4>${now.map(t => {
     const meta = taskDueMeta(t.due, t.done);
     return `<div class="row"><span><b>${esc(t.title)}</b><br><small>${esc(meta.label)} · ${esc(t.contact_name || '')}</small></span><button class="btn sm mark" onclick="toggleTask(${t.id},1);closeModal()">${icon('check', 13)} Выполнить</button></div>`;
   }).join('') || '<small>Планов на сегодня нет</small>'}
   <h3 style="margin-top:16px">${icon('inbox', 16)} Непрочитанные чаты</h3><div id="notifConvs">…</div>`);
  const convs = (await api('/api/conversations')).filter(c => c.unread);
  $('#notifConvs').innerHTML = convs.map(c => `<div class="row"><span><b>${esc(c.title)}</b><br><small>${esc(c.last_body || '')}</small></span><button class="btn sm" onclick="closeModal();state.conv=${c.id};go('inbox')">Открыть</button></div>`).join('') || '<small>Все сообщения прочитаны</small>';
}

async function navCounts(d) {
  $('#navUnread').textContent = d.unread || '';
  $('#navTasks').textContent = d.tasksOpen || '';
  $('#navDeals').textContent = d.dealsTotal || '';
  const b = $('#bellCount');
  if (b) b.textContent = d.tasksOverdue || '';
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
       <div class="attn-card today clickable-card" onclick="state.taskScope='all';state.taskFilter='today';go('tasks')" title="Открыть задачи на сегодня">
         <span style="font-size:12.5px">${icon('calendar', 14)} На сегодня</span>
         <b>${todayTasks} задач</b>
       </div>
       <div class="attn-card warn clickable-card" onclick="state.taskScope='all';state.taskFilter='overdue';go('tasks')" title="Открыть просроченные задачи">
         <span style="font-size:12.5px">${icon('clock', 14)} Просрочено</span>
         <b>${overdueTasks} задач</b>
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
       <b>${d.dealsTotal} <small style="font-weight:normal">(${fmt(d.activeDealsSum || 0)})</small></b>
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
       <b>${d.tasksOpen} открытых</b>
       ${d.tasksOverdue ? `<small style="color:#dc2626">просрочено: ${d.tasksOverdue}</small>` : `<small>на сегодня: ${d.tasksToday}</small>`}
     </div>
     <div class="kpi clickable-card" onclick="go('inbox')" title="Перейти в Чаты">
       <i>${icon('inbox', 20)}</i>
       <span>Чаты</span>
       <b class="accent">${d.unread} непрочитанных</b>
     </div>
     <div class="kpi clickable-card" onclick="go('contacts')" title="Перейти в Контакты">
       <i>${icon('contacts', 20)}</i>
       <span>База</span>
       <b>${d.contacts} <small>/ ${d.companies} комп.</small></b>
     </div>
   </div>

  ${d.contacts === 0 && d.dealsTotal === 0 ? `<div class="card" style="box-shadow:none;border-color:#bbf7d0;background:#f0fdf4"><b>База пустая — самое время начать</b><br><small>Добавьте первый контакт кнопкой «+ Контакт» вверху страницы: сделки, задачи и чаты можно вести прямо из его карточки. Каналы связи и почта подключаются в разделе «Настройки».</small></div>` : ''}
  <div class="cols"><div>
   <div class="card"><h3>Воронка продаж</h3>${d.stages.map(s => `<p style="display:flex;justify-content:space-between;margin:8px 0 2px"><span>${esc(s.name)} · ${s.count}</span><b>${fmt(s.sum)}</b></p><div class="bar"><i style="width:${Math.round(s.sum / max * 100)}%"></i></div>`).join('')}</div>
   <div class="card"><h3>Последние сделки</h3><table class="mini"><tr><th>Сделка</th><th>Клиент</th><th>Этап</th><th>Сумма</th></tr>${d.recentDeals.map(x => `<tr><td><b>${esc(x.title)}</b></td><td>${esc(x.contact_name || '—')}</td><td>${esc((d.stages.find(s => s.code === x.stage) || {}).name || x.stage)}</td><td><b>${fmt(x.amount)}</b></td></tr>`).join('')}</table></div></div>
  <div class="card"><h3>Лента активности</h3><div class="list">${d.activities.map(a => `<div class="row"><span>• ${esc(a.text)}<br><small>${esc(dt(a.created_at))}${a.user_name ? ' · ' + esc(a.user_name) : ''}</small></span></div>`).join('') || '<small>Пока пусто</small>'}</div><hr>
   <h3>Мои задачи</h3><div class="list">${myTasksBlock()}</div><hr>
   <h3>Быстрые действия</h3><div style="display:flex;flex-direction:column;gap:8px">
   <button class="btn orange" onclick="openDeal()">${icon('plus', 14)} Новая сделка</button>
   <button class="btn primary" onclick="openContact()">${icon('plus', 14)} Контакт</button>
   <button class="btn" onclick="openTask()">${icon('plus', 14)} Задача</button>
   ${(state.me && state.me.role) === 'admin' ? `<button class="btn" onclick="go('settings','integrations')">${icon('settings', 14)} Настроить каналы связи</button>` : `<button class="btn" onclick="go('settings','profile')">${icon('profile', 14)} Мой профиль</button>`}
   <button class="btn" onclick="go('competitors')">${icon('competitor', 14)} Проверить конкурента</button></div></div></div>`;
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

  v.innerHTML = `${bulkBar('deals', `${bulkStage()}${bulkOwner('deals')}`)}<div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <b>Воронка:</b><select style="width:auto" onchange="state.pipeline=+this.value;render()">${d.pipelines.map(p => `<option value="${p.id}" ${p.id === state.pipeline ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <span class="tabs" style="margin:0"><button class="${state.dealScope !== 'mine' && state.dealScope !== 'notask' && state.dealScope !== 'overdue' ? 'active' : ''}" onclick="state.dealScope='all';render()">Все сделки</button><button class="${state.dealScope === 'mine' ? 'active' : ''}" onclick="state.dealScope='mine';render()">Мои (${d.deals.filter(x => x.responsible_id === meId()).length})</button><button class="${state.dealScope === 'notask' ? 'active' : ''}" onclick="state.dealScope='notask';render()">Без задач (${noTaskCount})</button><button class="${state.dealScope === 'overdue' ? 'active' : ''}" onclick="state.dealScope='overdue';render()">Просрочено (${overdueCount})</button></span>
    <span class="tag" title="Сделок в текущем фильтре">Показано: ${shown.length}${shown.length !== shown.filter(x => !['won', 'lost'].includes(x.stage)).length ? ` · в работе: ${shown.filter(x => !['won', 'lost'].includes(x.stage)).length}` : ''}</span><span class="tag orange" title="Сумма активных сделок в фильтре">В работе на ${fmt(shown.filter(x => !['won', 'lost'].includes(x.stage)).reduce((a, x) => a + x.amount, 0))}</span>
    <button class="btn sm" style="margin-left:auto" onclick="download('/api/export/deals','deals.csv')" title="Выгрузить сделки в CSV">${icon('download', 13)} Экспорт</button>
    <input id="dealSearch" style="max-width:210px" placeholder="Поиск по сделкам и клиентам" value="${esc(state.dealQuery || '')}" oninput="liveSearch('deals',()=>{state.dealQuery=this.value;render()})">
    ${(state.me && state.me.role) === 'admin' ? `<button class="btn sm" onclick="openPipelineEditor()">${icon('settings', 13)} Настроить воронку</button>` : ''}</div>
  <div class="kanban">${d.stages.map(s => {
    const colDeals = shown.filter(x => x.stage === s.code);
    const colSum = colDeals.reduce((a, x) => a + x.amount, 0);
    return `<div class="col" ondragover="dragOver(event,this)" ondragleave="this.classList.remove('drag-over')" ondrop="dropDeal(event,'${s.code}',this)">
   <h3><span style="color:${esc(s.color)}">● ${esc(s.name)}</span><span style="display:inline-flex;align-items:center;gap:6px"><small style="font-weight:normal;color:var(--muted)">${fmt(colSum)}</small><span>${colDeals.length}</span><button type="button" class="btn-col-add" onclick="openDeal(null,'${s.code}')" title="Добавить сделку в этап «${esc(s.name)}»">${icon('plus', 12)}</button></span></h3>
   <div class="deals">${colDeals.map(x => `<article class="deal ${selSet('deals').has(x.id) ? 'selected' : ''}" draggable="true" ondragstart="dragDealStart(event,${x.id})" ondragend="dragDealEnd()" onclick="openDealCard(${x.id})" style="border-left-color:${esc(s.color)}${selSet('deals').has(x.id) ? ';box-shadow:0 0 0 2px var(--green)' : ''}">
    <b>${esc(x.title)}</b><input type="checkbox" title="Выбрать для массового действия" style="position:absolute;top:8px;right:8px" ${selSet('deals').has(x.id) ? 'checked' : ''} onclick="event.stopPropagation()" onchange="toggleSel('deals',${x.id})"><span class="sum">${fmt(x.amount)}</span>
    <small>${icon('contact', 13)} ${esc(x.contact_name || 'Без контакта')}${x.deadline ? ' · ' + icon('clock', 13) + ' ' + esc(x.deadline) : ''}</small>
    <div>${dealTaskBadge(x)}</div>
    <div class="deal-foot"><span class="prio ${esc(x.priority)}">${x.priority === 'high' ? 'высокий' : x.priority === 'low' ? 'низкий' : 'обычный'}</span><span><button class="btn sm" onclick="event.stopPropagation();moveDeal(${x.id},1)">→</button></span></div></article>`).join('') || '<small style="padding:6px;color:var(--muted)">Пусто — перетащите сюда карточку</small>'}</div></div>`;
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

async function openDeal(contactId, stageCode) {
  await team();
  await ensureStages();
  if (!state.contacts.length) state.contacts = await api('/api/contacts');
  const def = ((state.pipelines || []).find(p => p.id === state.pipeline) || state.pipelines?.[0] || {}).stages || [];
  const curStage = stageCode || (def[0] ? def[0].code : '');
  openModal(`<h3>Новая сделка</h3><form onsubmit="return saveDeal(event)">
   <label>Название сделки*<input name="title" required placeholder="Каркасный дом 8x10"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Сумма (${CUR()})<input name="amount" type="number" value="0" placeholder="0"></label>
   <label>Контакт<select name="contact_id"><option value="">— выбрать —</option>${state.contacts.map(c => `<option value="${c.id}" ${c.id === contactId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
   <label>Этап<select name="stage">${def.map(s => `<option value="${esc(s.code)}" ${s.code === curStage ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
   ${formMore(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Ответственный<select name="responsible_id">${userOptions(meId())}</select></label>
   <label>Приоритет<select name="priority"><option value="normal">Обычный</option><option value="high">Высокий</option><option value="low">Низкий</option></select></label></div>
   <label>Дедлайн<input name="deadline" type="date"></label>
   ${cfInputs('deals')}`)}
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
   <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;flex-wrap:wrap">
     <div><h3 style="margin:0">${esc(deal.title)}</h3><small>${esc(deal.contact_name || 'Без контакта')} · ${fmt(deal.amount)} · <span class="tag">${esc(stageLabel(deal.stage) || deal.stage)}</span></small></div>
     <div style="display:flex;gap:6px">
       <button class="btn sm" onclick="printDoc(${deal.id},'quote')" title="Коммерческое предложение">${icon('print', 13)} КП</button>
       <button class="btn sm" onclick="printDoc(${deal.id},'invoice')" title="Счёт на оплату">${icon('fileText', 13)} Счёт</button>
     </div>
   </div>
   ${!done && !openTasks ? `<div class="card" style="box-shadow:none;border-color:#fdba74;background:#fff7ed;margin:10px 0;padding:10px 12px"><b>${icon('alertCircle', 15)} У сделки нет открытых задач</b> — она может зависнуть. <button class="btn sm" style="margin-left:6px" onclick="openTask(null,{deal_id:${deal.id},contact_id:${deal.contact_id || 'null'}})">${icon('plus', 13)} Поставить задачу</button></div>` : ''}
   ${!done && openTasks && nextTask ? `<p style="margin:6px 0 0"><small>${icon('clock', 13)} Ближайшая задача: <b>${esc(nextTask.title)}</b> — ${esc(taskDueMeta(nextTask.due).label)}</small></p>` : ''}
   ${done ? '' : `<div class="card-actions">
     ${deal.contact_phone ? `<a class="btn sm" href="tel:${esc(String(deal.contact_phone).replace(/[^+\d]/g, ''))}">${icon('phone', 13)} Позвонить</a>` : ''}
     ${deal.contact_phone ? `<a class="btn sm" href="https://wa.me/${esc(String(deal.contact_phone).replace(/[^\d]/g, ''))}" target="_blank" rel="noopener">${icon('whatsapp', 13)} WhatsApp</a>` : ''}
     <button class="btn sm" onclick="openTask(null,{deal_id:${deal.id},contact_id:${deal.contact_id || 'null'}})">${icon('plus', 13)} Задача</button>
     <button class="btn sm primary" onclick="state.dealTab='products';openDealCard(${deal.id})">${icon('products', 13)} Добавить товар</button>
     <button class="btn sm" style="margin-left:auto" onclick="quickDealStage(${deal.id},'${esc(kindStage('won'))}')">${icon('checkCircle', 13)} Выиграна</button>
     <button class="btn sm danger" onclick="quickDealStage(${deal.id},'${esc(kindStage('lost'))}')">${icon('xCircle', 13)} Отказ</button>
   </div>`}
   <div class="tabs" style="margin-bottom:12px">
     <button class="${state.dealTab === 'details' ? 'active' : ''}" onclick="state.dealTab='details';openDealCard(${id})">Детали</button>
     <button class="${state.dealTab === 'chat' ? 'active' : ''}" onclick="state.dealTab='chat';openDealCard(${id})">Переписка</button>
     <button class="${state.dealTab === 'products' ? 'active' : ''}" onclick="state.dealTab='products';openDealCard(${id})">Товары (${d.products.length})</button>
     <button class="${state.dealTab === 'tasks' ? 'active' : ''}" onclick="state.dealTab='tasks';openDealCard(${id})">Задачи (${d.tasks.length})</button>
     <button class="${state.dealTab === 'notes' ? 'active' : ''}" onclick="state.dealTab='notes';openDealCard(${id})">Заметки (${d.notes.length})</button>
     <button class="${state.dealTab === 'history' ? 'active' : ''}" onclick="state.dealTab='history';openDealCard(${id})">История</button>
   </div>
   <div id="dealCardTab">${dealTab(deal, d)}</div>`);
}

function dealTab(deal, d) {
  if (state.dealTab === 'details') {
    return `<form onsubmit="return saveDeal(event,${deal.id})">
     <label>Название<input name="title" value="${esc(deal.title)}"></label>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Сумма (${CUR()})<input name="amount" type="number" value="${deal.amount}"></label>
     <label>Этап<select name="stage">${selStages(deal.stage, state.cardStages)}</select></label></div>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Клиент<select name="contact_id"><option value="">— без контакта —</option>${(state.contacts || []).map(c => `<option value="${c.id}" ${c.id === deal.contact_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
     <label>Компания<select name="company_id"><option value="">— без компании —</option>${(state.cardCompanies || []).map(c => `<option value="${c.id}" ${c.id === deal.company_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
     ${formMore(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Дедлайн<input name="deadline" type="date" value="${esc((deal.deadline || '').slice(0, 10))}"></label>
     <label>Ответственный<select name="responsible_id">${userOptions(deal.responsible_id)}</select></label></div>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Приоритет<select name="priority"><option value="normal" ${deal.priority === 'normal' ? 'selected' : ''}>Обычный</option><option value="high" ${deal.priority === 'high' ? 'selected' : ''}>Высокий</option><option value="low" ${deal.priority === 'low' ? 'selected' : ''}>Низкий</option></select></label>
     <label>Причина отказа (если сделка проиграна)<input name="loss_reason" value="${esc(deal.loss_reason || '')}"></label></div>
     ${cfInputs('deals', deal)}`, true)}
     <div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary">Сохранить изменения</button><button class="btn danger" type="button" onclick="del('deals',${deal.id})">Удалить</button></div></form>`;
  }
  if (state.dealTab === 'chat') {
    if (!d.conversation) return '<div class="empty">У этой сделки нет контакта или переписки</div>';
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>Чат: ${esc(d.conversation.title)}</b><button class="btn sm" onclick="closeModal();state.conv=${d.conversation.id};go('inbox')">Открыть в разделе Чаты →</button></div>
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
     <div class="list" style="margin-top:12px">${d.notes.map(n => `<div class="row"><span>${esc(n.body)}<br><small>${esc(n.author || '—')} · ${esc(dt(n.created_at))}</small></span><button class="btn sm danger" onclick="delNote(${n.id},null,${deal.id})">${icon('close', 13)}</button></div>`).join('') || '<small>Заметок нет</small>'}</div>`;
  }
  if (state.dealTab === 'history') {
    return `<div class="list">${d.history.map(a => `<div class="row"><span>• ${esc(a.text)}<br><small>${esc(dt(a.created_at))}${a.user_name ? ' · ' + esc(a.user_name) : ''}</small></span></div>`).join('') || '<small>История пуста</small>'}</div>`;
  }
}

async function addNote(e, entity_type, entity_id) {
  e.preventDefault();
  const body = new FormData(e.target).get('body');
  await api('/api/notes', { method: 'POST', body: JSON.stringify({ entity_type, entity_id, body }) });
  toast('Заметка добавлена');
  if (entity_type === 'deals') openDealCard(entity_id);
  else render();
  return false;
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
// Вложение в пузыре сообщения: картинка — превью, остальное — аккуратная ссылка на файл.
function attachmentHtml(m) {
  // только безопасные схемы: javascript:/data: в ссылке вложения недопустимы
  if (!m.content_uri || !/^(https?:\/\/|\/uploads\/)/i.test(m.content_uri)) return '';
  const url = esc(m.content_uri);
  const isImage = (m.content_type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(m.content_uri);
  if (isImage) return `<a href="${url}" target="_blank" rel="noopener" class="chat-attach img"><img loading="lazy" src="${url}" alt="${esc(m.content_name || 'изображение')}"></a>`;
  return `<a href="${url}" target="_blank" rel="noopener" class="chat-attach file">${icon('file', 14)}<span>${esc(m.content_name || 'вложение')}</span></a>`;
}
const MSG_STATUS = { sent: 'отправлено', delivered: 'доставлено', read: 'прочитано', inbound: 'входящее', received: 'получено', local: 'сохранено в CRM', error: 'не отправлено' };
const statusLabel = s => MSG_STATUS[s] || s || '';
function msgHtml(m) {
  const body = m.body && m.body !== '[вложение]' ? esc(m.body) : '';
  const own = m.direction === 'out';
  const failed = m.status === 'failed';
  const badge = failed ? ' <span class="msg-fail" title="Не доставлено — проверьте подключение канала">не доставлено</span>' : '';
  return `<div class="msg ${own ? 'out' : ''}"><div>${attachmentHtml(m)}${body}</div><small>${esc(channelLabel(m.channel) || m.channel)} · ${esc(dt(m.created_at))}${!failed && m.status ? ' · ' + esc(statusLabel(m.status)) : ''}${badge}</small></div>`;
}
// Каналы отправки: сначала подключённые у этого клиента, затем все доступные.
function channelOptions(conv) {
  const known = ['whatsapp', 'telegram', 'instagram', 'viber', 'email'];
  const fromConv = String(conv?.channels || '').split(',').map(x => x.trim()).filter(Boolean);
  const list = [...new Set([...fromConv, ...known])];
  return list.map(c => `<option value="${esc(c)}">${esc(channelLabel(c))}</option>`).join('');
}
async function inbox(v) {
  const convs = await api('/api/conversations');
  state.cache.convs = convs;
  const cur = convs.find(c => c.id === state.conv) || convs[0];
  if (cur) state.conv = cur.id;
  const msgs = cur ? await api(`/api/conversations/${cur.id}/messages`) : [];
  const templates = (state.cache.templates = state.cache.templates || await api('/api/templates'));

  v.innerHTML = `<div class="inbox">
   <div class="convs"><div style="padding:10px;border-bottom:1px solid var(--line)"><input id="convSearch" placeholder="Поиск диалогов" oninput="filterConvs(this.value)"></div>
   <div id="convList">${convs.map(c => `<div class="conv ${c.id === (cur || {}).id ? 'active' : ''}" onclick="state.conv=${c.id};render()">
    <b><span>${esc(c.title)}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</b>
    <p>${esc(c.last_body || '—')}</p><small>${chan(c.channels)} · ${esc(dt(c.last_at))}</small></div>`).join('') || '<div class="empty">Чатов пока нет</div>'}</div></div>
   <div class="chat">${cur ? `
    <div class="chat-head"><div><b>${esc(cur.title)}</b> <small>${esc(cur.phone || '')}</small></div>
      <div style="display:flex;gap:6px">
        <button class="btn sm" onclick="openEmailComposer(${cur.id})">${icon('email', 13)} Письмо</button>
      </div></div>
    <div class="msgs" id="chatMsgs">${msgs.map(msgHtml).join('') || '<div class="empty">Диалог пуст</div>'}</div>
    <form class="composer" onsubmit="return sendMsg(event,${cur.id})">
     <div class="composer-row">
       <button type="button" class="btn icon-btn composer-ico" title="Прикрепить фото или файл" onclick="$('#chatFile').click()">${icon('paperclip', 17)}</button>
       <input type="file" id="chatFile" class="hidden" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,application/zip,.doc,.docx,.xls,.xlsx" onchange="uploadChatFile(this,${cur.id})">
       <button type="button" class="btn icon-btn composer-ico" title="Прикрепить ссылку на файл" onclick="openAttachment()">${icon('link', 16)}</button>
       <input id="msgText" placeholder="Сообщение (Enter — отправить)…" required autocomplete="off">
       <button class="btn send-btn" title="Отправить сообщение">${icon('arrowUp', 17)}</button>
     </div>
     <div class="composer-row composer-sub">
       <select id="msgChannel" class="composer-select" title="Канал отправки">${channelOptions(cur)}</select>
       <select id="msgTmpl" class="composer-select" title="Шаблон ответа" onchange="if(this.value){const t=$('#msgText');t.value=this.value;this.value='';t.focus();t.setSelectionRange(t.value.length,t.value.length)}"><option value="">Шаблоны ответов…</option>${templates.map(t => `<option value="${esc(tmpl(t.name, { body: t.body, name: cur.title }))}">${esc(t.name)}</option>`).join('')}</select>
       <button type="button" class="tmpl-settings" onclick="go('settings','templates')">${icon('settings', 12)} настроить шаблоны</button>
     </div></form>` : '<div class="empty">Выберите диалог</div>'}</div>
   <div class="profile">${cur ? `<h3>Клиент</h3><p><b>${esc(cur.title || '')}</b></p><p>${icon('phone', 13)} ${esc(cur.phone || '—')}<br>${icon('email', 13)} ${esc(cur.email || '—')}</p><p>Каналы: ${chan(cur.channels)}${(cur.channels || '').includes('email') ? ' <span class="tag grey">почта подключена</span>' : ''}</p><p><button class="btn sm" onclick="attachContact(${cur.contact_id})">Открыть карточку клиента</button></p><hr><h3>Быстрые действия</h3><div style="display:flex;flex-direction:column;gap:6px">${cur.phone ? `<a class="btn sm" href="tel:${esc(String(cur.phone).replace(/[^+\d]/g, ''))}">${icon('phone', 13)} Позвонить</a>` : ''}<button class="btn sm" onclick="openTask(null,{contact_id:${cur.contact_id}})">+ Задача</button><button class="btn sm" onclick="quickDeal(${cur.contact_id})">+ Сделка</button><button class="btn sm" onclick="quickNote(${cur.contact_id})">+ Заметка</button></div>` : '<div class="empty">Выберите чат</div>'}</div></div>`;
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
  } catch { }
}

function filterConvs(q) {
  const list = state.cache.convs || [];
  const qL = q.toLowerCase();
  const filtered = list.filter(c => `${c.title} ${c.last_body || ''} ${c.phone || ''}`.toLowerCase().includes(qL));
  $('#convList').innerHTML = filtered.map(c => `<div class="conv ${c.id === state.conv ? 'active' : ''}" onclick="state.conv=${c.id};render()">
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
function openAttachment() {
  openModal(`<h3>Прикрепить ссылку на файл</h3><form onsubmit="return sendAttachment(event)"><label>Ссылка на файл (PDF, фото, документ)*<input name="url" type="url" required placeholder="https://…/kommercheskoe-predlozhenie.pdf"></label><label>Подпись к файлу<input name="text" placeholder="Коммерческое предложение"></label><button class="btn primary w">Отправить в диалог</button></form>`);
}
async function sendAttachment(e) {
  e.preventDefault(); const { url, text } = Object.fromEntries(new FormData(e.target));
  try {
    await api(`/api/conversations/${state.conv}/messages`, { method: 'POST', body: JSON.stringify({ body: text || 'Файл по ссылке', contentUri: url, contentName: text || 'ссылка на файл', channel: $('#msgChannel')?.value || 'whatsapp' }) });
    closeModal(); toast('Файл отправлен'); refreshInbox();
  } catch (err) { toast(err.message, 'err'); }
  return false;
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
    return `<div class="cal-day ${d === today ? 'today' : ''}"><h4><span>${names[i]}</span><small>${d.slice(5)}</small></h4>
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

  v.innerHTML = `${bulkBar('contacts', `${bulkOwner('contacts')}<button class="btn sm" onclick="bulkAddTag()">${icon('tag', 13)} Добавить тег</button><button class="btn sm danger" onclick="bulkApply('contacts','delete')">${icon('trash', 13)} Удалить</button>`)}
  <div class="card" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
   <input id="contactSearch" style="max-width:220px" placeholder="Поиск по имени, тел, почте" value="${esc(f.q)}" oninput="liveSearch('contacts',()=>{state.contactFilter.q=this.value;state.contactLimit=50;render()})">
   <select style="width:auto" onchange="state.contactFilter.owner=this.value;render()"><option value="">Все ответственные</option>${__team.map(u => `<option value="${u.id}" ${f.owner == u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
   <select style="width:auto" onchange="state.contactFilter.source=this.value;render()"><option value="">Все источники</option>${['manual', 'wazzup-whatsapp', 'wazzup-telegram', 'wazzup-instagram', 'wazzup-viber', 'site', 'avito', 'email', 'import'].map(s => `<option value="${s}" ${f.source === s ? 'selected' : ''}>${sourceLabel(s)}</option>`).join('')}</select>
   ${tagsAll.length ? `<select style="width:auto" onchange="state.contactFilter.tag=this.value;render()"><option value="">Все теги</option>${tagsAll.map(t => `<option value="${esc(t)}" ${f.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
   ${(f.q || f.owner || f.source || f.tag) ? `<button class="btn sm ghost" onclick="resetContactFilter()">Сбросить</button>` : ''}
   <span class="tag grey" style="margin-left:auto">показано ${Math.min(filtered.length, state.contactLimit || 50)} из ${filtered.length}${filtered.length !== list.length ? ` (всего в базе ${list.length})` : ''}</span>
   <details class="dropdown"><summary class="btn sm">${icon('more', 13)} Ещё</summary><div class="dropdown-pop">
     <button type="button" onclick="closeDropdown(this);openDuplicates()">${icon('search', 13)} Поиск дублей</button>
     <button type="button" onclick="closeDropdown(this);download('/api/export/contacts','contacts.csv')">${icon('download', 13)} Экспорт в CSV</button>
     <button type="button" onclick="closeDropdown(this);importContacts()">${icon('upload', 13)} Импорт из CSV</button>
   </div></details>
   <button class="btn sm primary" onclick="openContact()">${icon('plus', 13)} Новый контакт</button></div>
  <div class="card"><table><tr><th class="sel"></th><th>Клиент</th><th>Телефон / E-mail</th><th>Компания</th><th>Источник</th><th>Теги</th><th>Ответственный</th><th></th></tr>
   ${filtered.slice(0, state.contactLimit || 50).map(c => `<tr class="${selSet('contacts').has(c.id) ? 'selected' : ''}"><td class="sel"><input type="checkbox" ${selSet('contacts').has(c.id) ? 'checked' : ''} onchange="toggleSel('contacts',${c.id})"></td>
    <td><a href="#" onclick="openContactCard(${c.id});return false"><b>${esc(c.name)}</b></a></td><td>${esc(c.phone || '—')}<br><small>${esc(c.email || '')}</small></td><td>${esc(c.company || '—')}</td><td><span class="tag grey">${esc(sourceLabel(c.source))}</span></td>
    <td>${(c.tags || '').split(',').filter(Boolean).map(t => `<span class="tag">${esc(t.trim())}</span>`).join('')}</td>
    <td><small>${esc(__team.find(u => u.id === c.responsible_id)?.name || '—')}</small></td>
    <td style="white-space:nowrap"><button class="btn sm" onclick="openContactCard(${c.id})">Карточка</button> <button class="btn sm" onclick="openDeal(${c.id})">+ Сделка</button> <button class="btn sm danger" onclick="del('contacts',${c.id})">${icon('close', 13)}</button></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">Контактов не найдено</div></td></tr>'}</table>
   ${filtered.length > (state.contactLimit || 50) ? `<div style="text-align:center;margin-top:10px"><button class="btn" onclick="state.contactLimit=(state.contactLimit||50)+50;render()">Показать ещё 50</button></div>` : ''}</div>`;
}

function resetContactFilter() { state.contactFilter = { q: '', owner: '', source: '', tag: '' }; render(); }
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
  const origin = location.origin;
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
function copySiteFormCode() {
  navigator.clipboard.writeText(siteFormCode()).then(() => toast('Код формы скопирован в буфер')).catch(() => openModal(`<h3>Код формы для сайта</h3><textarea rows="14" readonly onclick="this.select()">${esc(siteFormCode())}</textarea><p><small>Выделите и скопируйте код, затем вставьте его на страницу сайта.</small></p>`));
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
       ${conv ? `<button class="btn sm" onclick="closeModal();state.conv=${conv.id};go('inbox')">${icon('chat', 13)} Чат</button>` : ''}
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
       <div class="list" style="margin-top:10px">${notes.map(n => `<div class="row"><span>${esc(n.body)}<br><small>${esc(n.author || '—')} · ${esc(dt(n.created_at))}</small></span><button class="btn sm danger" onclick="delNote(${n.id},${c.id})">${icon('close', 13)}</button></div>`).join('') || '<small>Заметок нет</small>'}</div>
     </div>
     <div>
       <h4>Контактные данные</h4>
       <p>Телефон: <b>${esc(c.phone || '—')}</b><br>E-mail: <b>${esc(c.email || '—')}</b><br>Ответственный: <b>${esc(__team.find(u => u.id === c.responsible_id)?.name || 'Не назначен')}</b></p>
       <table class="mini">${cfTable('contacts', c)}</table>
       <p><small>Создан: ${esc(dt(c.created_at))}</small></p>
     </div>
   </div>`);
}

async function openContact(id) {
  await team();
  const comps = (await api('/api/companies')).concat();
  const c = id ? await api('/api/contacts/' + id) : { tags: '', custom: '{}' };
  openModal(`<h3>${id ? 'Контакт' : 'Новый контакт'}</h3><form onsubmit="return saveContact(event,${id || 'null'})">
   <label>Имя клиента*<input name="name" required value="${esc(c.name || '')}" placeholder="Иван Петров"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Телефон<input name="phone" value="${esc(c.phone || '')}" placeholder="+7 999 123-45-67"></label>
   <label>E-mail<input name="email" type="email" value="${esc(c.email || '')}" placeholder="ivan@mail.ru"></label></div>
   ${formMore(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Компания<select name="company_id"><option value="">— частное лицо —</option>${comps.map(x => `<option value="${x.id}" ${x.id === c.company_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
   <label>Должность<input name="position" value="${esc(c.position || '')}" placeholder="Собственник / застройщик"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Ответственный<select name="responsible_id">${userOptions(c.responsible_id || meId())}</select></label>
   <label>Источник<select name="source">${sourceOptions(c.source)}</select></label></div>
   <label>Теги (через запятую)<input name="tags" value="${esc(c.tags || '')}" placeholder="VIP, каркас, участок"></label>
   <label>Заметки<textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></label>
   ${cfInputs('contacts', c)}`, !!id && !!(c.tags || c.notes || c.position || (c.company_id)))}
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
  v.innerHTML = `<div class="card"><div class="row" style="border:0;flex-wrap:wrap;gap:8px"><h3>Компании (${shown.length}${shown.length !== rows.length ? ` из ${rows.length}` : ''})</h3>
   <input id="companySearch" style="max-width:240px" placeholder="Название, ИНН, телефон" value="${esc(state.companyQuery || '')}" oninput="liveSearch('companies',()=>{state.companyQuery=this.value;render()})">
   <button class="btn sm primary" style="margin-left:auto" onclick="openCompany()">+ Компания</button></div>
  <table><tr><th>Компания</th><th>ИНН</th><th>Телефон</th><th>E-mail</th><th>Сайт</th><th></th></tr>
   ${shown.slice(0, state.companyLimit || 100).map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.inn || '—')}</td><td>${esc(c.phone || '—')}</td><td>${esc(c.email || '—')}</td><td>${siteHref(c.site) ? `<a href="${esc(siteHref(c.site))}" target="_blank" rel="noopener">${esc(c.site)}</a>` : '—'}</td><td><button class="btn sm" onclick="openCompany(${c.id})">${icon('edit', 13)}</button> <button class="btn sm danger" onclick="del('companies',${c.id})">${icon('close', 13)}</button></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Компаний не найдено</div></td></tr>'}</table>
   ${shown.length > (state.companyLimit || 100) ? `<div style="text-align:center;margin-top:10px"><button class="btn" onclick="state.companyLimit=(state.companyLimit||100)+100;render()">Показать ещё</button></div>` : ''}</div>`;
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
   <label>Название организации*<input name="name" required value="${esc(c.name || '')}" placeholder="ООО «СтройКаркас»"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>ИНН<input name="inn" value="${esc(c.inn || '')}" placeholder="10 или 12 цифр"></label><label>Телефон<input name="phone" value="${esc(c.phone || '')}" placeholder="+7 495 000-00-00"></label></div>
   ${formMore(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>E-mail<input name="email" type="email" value="${esc(c.email || '')}"></label><label>Сайт<input name="site" value="${esc(c.site || '')}"></label></div>
   <label>Заметки<textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></label>`, !!id)}
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
  const groups = [
    ['Просроченные', rows.filter(t => !t.done && normalizeDue(t.due).slice(0, 10) < today && normalizeDue(t.due) !== '')],
    ['Сегодня', rows.filter(t => !t.done && normalizeDue(t.due).slice(0, 10) === today)],
    ['Активные', rows.filter(t => !t.done && (normalizeDue(t.due).slice(0, 10) > today || !t.due))],
    ['Выполненные', rows.filter(t => t.done)]
  ];
  const types = { call: icon('phone', 14) + ' Звонок', meeting: icon('users', 14) + ' Встреча', message: icon('message', 14) + ' Сообщение', email: icon('email', 14) + ' Письмо', other: icon('task', 14) + ' Дело' };
  const mineOpen = all.filter(t => !t.done && (t.responsible_id === meId() || !t.responsible_id)).length;

  v.innerHTML = `<div class="card"><div class="row" style="border:0;flex-wrap:wrap;gap:8px"><b>Задач: ${rows.length}</b>
   <span class="tabs" style="margin:0"><button class="${state.taskScope === 'mine' ? 'active' : ''}" onclick="state.taskScope='mine';render()">Мои (${mineOpen})</button><button class="${state.taskScope === 'all' ? 'active' : ''}" onclick="state.taskScope='all';render()">Все (${all.filter(t => !t.done).length})</button></span>
   ${state.taskFilter ? `<span class="tag orange" style="display:inline-flex;gap:6px;align-items:center">${state.taskFilter === 'today' ? 'Только на сегодня' : 'Только просроченные'}<button class="btn sm" style="padding:0 4px" title="Сбросить фильтр" onclick="state.taskFilter='';render()">×</button></span>` : ''}
   <span class="tabs" style="margin:0"><button class="${state.taskView === 'list' ? 'active' : ''}" onclick="state.taskView='list';render()">${icon('list', 14)} Список</button><button class="${state.taskView === 'week' ? 'active' : ''}" onclick="state.taskView='week';render()">${icon('calendar', 14)} Неделя</button></span>
   <button class="btn sm ${state.taskSelectMode ? 'active' : ''}" onclick="toggleTaskSelect()">${state.taskSelectMode ? 'Отменить выбор' : 'Выбрать несколько'}</button>
   <button class="btn sm primary" style="margin-left:auto" onclick="openTask()">${icon('plus', 14)} Задача</button></div>
   ${state.taskScope === 'mine' ? `<p><small>Здесь задачи, назначенные на вас (${esc((state.me && state.me.name) || '')}), и неназначенные — их удобно разобрать первыми.</small></p>` : ''}
   ${state.taskView === 'week' ? weekCalendar(rows) : ''}
   ${state.taskView !== 'week' && state.taskSelectMode ? bulkBar('tasks', `<button class="btn sm" onclick="bulkApply('tasks','update',{done:1})">${icon('check', 14)} Выполнить выбранные</button> <button class="btn sm" onclick="bulkRescheduleTasks()">Перенести</button> <button class="btn sm danger" onclick="bulkApply('tasks','delete')">${icon('trash', 14)} Удалить</button>`) : ''}
   ${state.taskView === 'week' ? '' : groups.map(([t, list]) => list.length ? `<h3 style="margin-top:12px">${t} <small>${list.length}</small></h3>${list.slice(0, state.taskLimit || 50).map(x => {
     const meta = taskDueMeta(x.due, x.done);
     return `<div class="row taskrow ${selSet('tasks').has(x.id) ? 'selected' : ''}">
       <div style="display:flex;gap:10px;align-items:center;min-width:0;flex:1">
         ${state.taskSelectMode ? `<input type="checkbox" style="width:16px" ${selSet('tasks').has(x.id) ? 'checked' : ''} onchange="toggleSel('tasks',${x.id})" title="Выбрать для действия">` : ''}
         <button type="button" class="btn sm mark ${x.done ? 'done' : ''}" onclick="toggleTask(${x.id}, ${x.done ? 0 : 1})">${x.done ? icon('check', 13) + ' Выполнено' : 'Выполнить'}</button>
         <span class="${x.done ? 'task-done' : ''}">${types[x.type] || icon('task', 14)} <b>${esc(x.title)}</b>${x.repeat && x.repeat !== 'none' ? ' <span class="tag grey" title="Повторяется">' + icon('repeat', 12) + ' ' + ({ daily: 'ежедневно', weekly: 'еженедельно', monthly: 'ежемесячно' }[x.repeat] || '') + '</span>' : ''}</span>
         <small class="${meta.overdue ? 'task-due-overdue' : (meta.label.startsWith('сегодня') ? 'task-due-today' : '')}">${esc(meta.label)}${x.contact_name ? ' · ' + esc(x.contact_name) : ''}${x.deal_title ? ' · ' + esc(x.deal_title) : ''}${x.responsible_name ? ' · ' + esc(x.responsible_name) : ''}</small>
       </div>
       <span style="display:flex;gap:6px;flex-shrink:0">
         ${x.done ? '' : `<button class="btn sm" title="Перенести на завтра" onclick="reschedule(${x.id},1)">Завтра</button><button class="btn sm" title="Перенести на неделю" onclick="reschedule(${x.id},7)">+7 дн.</button>`}
         <button class="btn sm" onclick="openTask(${x.id})">${icon('edit', 13)}</button>
         <button class="btn sm danger" onclick="del('tasks',${x.id})">${icon('close', 13)}</button>
       </span>
     </div>`;
   }).join('')}${list.length > (state.taskLimit || 50) ? `<div style="margin:6px 0 10px"><small>Показано ${state.taskLimit || 50} из ${list.length}. <button class="btn sm" onclick="state.taskLimit=(state.taskLimit||50)+50;render()">Показать ещё</button></small></div>` : ''}` : '').join('') || '<div class="empty-state"><span class="ico">' + icon('target', 36) + '</span><b>Задач нет</b>Поставьте первое дело — звонок, встречу или письмо.<br><button class="btn primary" onclick="openTask()">' + icon('plus', 14) + ' Задача</button></div>'}</div>`;
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
   <label>Что сделать*<input name="title" required value="${esc(t.title || '')}" placeholder="Позвонить, уточнить детали"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Срок<input name="due" type="datetime-local" value="${esc(dueVal)}"><small id="dueHint">${esc(t.due ? '' : (defTime === '18:00' ? 'по умолчанию — сегодня вечером' : 'по умолчанию — завтра в 12:00'))}</small></label>
   <label>Тип<select name="type">${Object.entries({ call: 'Звонок', meeting: 'Встреча', message: 'Сообщение', email: 'Письмо', other: 'Другое' }).map(([k, n]) => `<option value="${k}" ${k === (t.type || 'call') ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
   <div class="due-chips" title="Быстрый выбор срока — поле «Срок» заполнится автоматически">
     <span class="due-chips-label">Быстро:</span>
     <button type="button" class="btn sm chip" onclick="setTaskDue(this,'today')">сегодня 18:00</button>
     <button type="button" class="btn sm chip" onclick="setTaskDue(this,'tomorrow')">завтра 10:00</button>
     <button type="button" class="btn sm chip" onclick="setTaskDue(this,'week')">через неделю</button>
     <button type="button" class="btn sm chip ghost" onclick="setTaskDue(this,'clear')">без срока</button>
   </div>
   <div class="task-links"><div class="task-link-col"><span class="task-link-cap">Клиент</span>${linkSlot('contact_id', preContact, 'contact')}</div><div class="task-link-col"><span class="task-link-cap">Сделка</span>${linkSlot('deal_id', preDeal, 'pipe')}</div></div>
   ${formMore(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Ответственный<select name="responsible_id">${userOptions(t.responsible_id || meId())}</select></label>
   <label>Приоритет<select name="priority"><option value="normal" ${t.priority === 'normal' ? 'selected' : ''}>Обычный</option><option value="high" ${t.priority === 'high' ? 'selected' : ''}>Высокий</option><option value="low" ${t.priority === 'low' ? 'selected' : ''}>Низкий</option></select></label></div>
   <label>Повтор задачи<select name="repeat">${[['none', 'Не повторять'], ['daily', 'Каждый день'], ['weekly', 'Каждую неделю'], ['monthly', 'Каждый месяц']].map(([k, n]) => `<option value="${k}" ${k === (t.repeat || 'none') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
   <label>Результат (после выполнения)<textarea name="result" rows="2" placeholder="Договорились на 15:00 — пришлём смету сегодня">${esc(t.result || '')}</textarea></label>`, !!id)} 
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
  const shown = rows.filter(p => (!onlyActive || p.active) && (!q || `${p.name} ${p.sku || ''} ${p.unit || ''}`.toLowerCase().includes(q)));
  const archived = rows.filter(p => !p.active).length;
  v.innerHTML = `<div class="card"><div class="row" style="border:0;flex-wrap:wrap;gap:8px"><h3>Каталог (${shown.length})</h3>
   <span class="tabs" style="margin:0"><button class="${onlyActive ? 'active' : ''}" onclick="state.productScope='active';render()">В продаже</button><button class="${!onlyActive ? 'active' : ''}" onclick="state.productScope='all';render()">Все${archived ? ` (+${archived} в архиве)` : ''}</button></span>
   <input id="productSearch" style="max-width:240px" placeholder="Название или артикул" value="${esc(state.productQuery || '')}" oninput="liveSearch('products',()=>{state.productQuery=this.value;render()})">
   <button class="btn sm primary" style="margin-left:auto" onclick="openProduct()">+ Товар / проект</button></div>
  <table><tr><th>Артикул</th><th>Название</th><th>Цена</th><th>Ед.</th><th>В продаже</th><th></th></tr>
   ${shown.map(p => `<tr><td><code>${esc(p.sku || '—')}</code></td><td><b>${esc(p.name)}</b></td><td>${fmt(p.price)}</td><td>${esc(p.unit || 'шт')}</td><td>${p.active ? 'Да' : '<span class="tag grey">Архив</span>'}</td><td><button class="btn sm" onclick="openProduct(${p.id})">${icon('edit', 13)}</button> <button class="btn sm danger" onclick="del('products',${p.id})">${icon('close', 13)}</button></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Ничего не найдено — измените фильтр или добавьте позицию</div></td></tr>'}</table></div>`;
}
async function openProduct(id) {
  const p = id ? await api('/api/products/' + id) : {};
  openModal(`<h3>${id ? 'Товар / проект' : 'Новая позиция каталога'}</h3><form onsubmit="return saveProduct(event,${id || 'null'})">
   <label>Название*<input name="name" required value="${esc(p.name || '')}" placeholder="Каркасный дом «Скандинавия 8×10»"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Цена (${CUR()})<input name="price" type="number" required value="${p.price || 0}" placeholder="0"></label>
   <label>Единица измерения<input name="unit" value="${esc(p.unit || 'шт')}" placeholder="шт, м², услуга"></label></div>
   ${formMore(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Артикул / код<input name="sku" value="${esc(p.sku || '')}" placeholder="DOM-SKAN-810"></label>
   <label style="display:flex;align-items:center;gap:8px;margin-top:22px"><input type="checkbox" name="active" style="width:auto" ${p.active === 0 ? '' : 'checked'}> В продаже</label></div>`, !!id)}
   <button class="btn primary w">${id ? 'Сохранить' : 'Добавить в каталог'}</button></form>`);
}
async function saveProduct(e, id) {
  e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
  b.price = num(b.price); b.active = b.active ? 1 : 0;
  await api(id ? '/api/products/' + id : '/api/products', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) });
  closeModal(); toast('Товар сохранён'); render(); return false;
}

/* ---------- analytics ---------- */
async function analytics(v) {
  const a = await api('/api/analytics');
  const max = Math.max(...a.stages.map(s => s.sum), 1);
  const plan = a.plan || {};
  v.innerHTML = `
  <div class="grid">
   <div class="kpi"><i>${icon('money', 20)}</i><span>План продаж (${esc(plan.month || 'текущий месяц')})</span><b>${plan.target ? fmt(plan.target) : 'Не задан'}</b>${plan.percent !== null ? `<small class="${plan.percent >= 100 ? 'green' : ''}">Факт: ${fmt(plan.fact)} (${plan.percent}%)</small>` : '<small>Задайте цель внизу</small>'}</div>
   <div class="kpi"><i>${icon('analytics', 20)}</i><span>Конверсия воронки</span><b class="green">${a.conversion}%</b><small>успешных к закрытым</small></div>
   <div class="kpi"><i>${icon('money', 20)}</i><span>Средний чек сделки</span><b>${fmt(a.avgCheck)}</b></div>
   <div class="kpi"><i>${icon('pipe', 20)}</i><span>Прогноз (сделки в работе)</span><b class="accent">${fmt(a.forecast)}</b></div>
  </div>
  <div class="cols"><div>
   <div class="card"><h3>Сделки по этапам воронки</h3>${a.stages.map(s => `<p style="display:flex;justify-content:space-between;margin:8px 0 2px"><span>${esc(s.name)} · ${s.count}</span><b>${fmt(s.sum)}</b></p><div class="bar"><i style="width:${Math.round(s.sum / max * 100)}%"></i></div>`).join('')}</div>
   <div class="card"><h3>Сделки по источникам</h3><table><tr><th>Источник</th><th>Сделок</th><th>Сумма</th></tr>${a.bySource.map(x => `<tr><td>${esc(sourceLabel(x.name))}</td><td>${x.count}</td><td><b>${fmt(x.sum)}</b></td></tr>`).join('') || '<tr><td colspan="3"><small>Пока нет сделок</small></td></tr>'}</table></div>
   <div class="card"><h3>План продаж на месяц</h3>${(state.me && state.me.role) === 'admin' ? `<form onsubmit="return setSalesPlan(event)"><div style="display:flex;gap:10px;align-items:flex-end"><label style="margin:0;flex:1">Целевая выручка на месяц (${CUR()})<input name="target" type="number" value="${plan.target || ''}" placeholder="3000000"></label><button class="btn primary">Сохранить цель</button></div></form>` : `<p><small>Цель на месяц задаёт администратор. Текущая цель: <b>${plan.target ? fmt(plan.target) : 'не задана'}</b>.</small></p>`}</div>
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
const RISK_COLORS = { low: '#16a34a', mid: '#f97316', high: '#dc2626' };
const RISK_LABELS = { low: 'Низкий риск', mid: 'Средний риск', high: 'Высокий риск' };

async function competitorsView(v) {
  const list = await api('/api/competitors');
  v.innerHTML = `
  <div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <div style="flex:1;min-width:240px;position:relative"><input id="compSearch" placeholder="Введите название или ИНН конкурента для проверки…" onkeydown="if(event.key==='Enter')findCompetitor(this.value)"></div>
    <button class="btn primary" onclick="findCompetitor($('#compSearch').value)">${icon('search', 14)} Найти и проверить</button>
    <button class="btn" onclick="openCompetitor()">+ Добавить вручную</button>
    <button class="btn" onclick="openPriceImport(null,'ours')">${icon('excel', 14)} Наш прайс-лист</button>
  </div>
  <div class="card">
   <div class="row" style="border:0"><h3>Конкуренты на контроле (${list.length})</h3><small>ФНС · ФССП · Суды · Банкротство · Отзывы · Сравнение цен</small></div>
   <table><tr><th>Конкурент</th><th>ИНН</th><th>Город / сайт</th><th>Риск</th><th>Проверка</th><th>Цены</th><th></th></tr>
    ${list.map(c => `<tr>
     <td><a href="#" onclick="openCompetitorCard(${c.id});return false"><b>${esc(c.name)}</b></a></td>
     <td><code>${esc(c.inn || '—')}</code></td><td>${esc(c.city || '—')}<br><small>${siteHref(c.website) ? `<a href="${esc(siteHref(c.website))}" target="_blank" rel="noopener">${esc(c.website)}</a>` : ''}</small></td>
     <td><span class="tag" style="background:${RISK_COLORS[c.level] || '#e2e8f0'}22;color:${RISK_COLORS[c.level] || 'var(--ink)'}">риск ${c.risk ?? 0} (${RISK_LABELS[c.level] || 'нет'})</span></td>
     <td><small>${esc(dt(c.checked_at) || 'не проверялся')}</small></td>
     <td><small>позиций: ${c.prices || 0}</small></td>
     <td style="white-space:nowrap">
       <button class="btn sm" onclick="checkCompetitor(${c.id})">${icon('refresh', 13)} Проверить</button>
       <button class="btn sm" onclick="openCompetitorCard(${c.id})">Отчёт</button>
       <button class="btn sm" onclick="openCompetitor(${c.id})">${icon('edit', 13)}</button>
       <button class="btn sm danger" onclick="delCompetitor(${c.id})">${icon('close', 13)}</button>
     </td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Конкурентов пока нет — введите название выше</div></td></tr>'}
   </table>
  </div>`;
}

async function findCompetitor(query) {
  if (!query || !query.trim()) return toast('Введите название или ИНН');
  toast('Поиск и сбор сведений о конкуренте…');
  try {
    // проверка по открытым источникам может занять больше стандартных 30 секунд
    const res = await api('/api/competitors/find', { method: 'POST', body: JSON.stringify({ query }), signal: AbortSignal.timeout(120000) });
    toast('Конкурент добавлен и проверен');
    render();
    if (res.id) openCompetitorCard(res.id);
  } catch (e) { toast(e.message, 'err'); }
}

async function checkCompetitor(id) {
  toast('Проверяем конкурента по открытым источникам…');
  try {
    await api(`/api/competitors/${id}/check`, { method: 'POST', signal: AbortSignal.timeout(120000) });
    toast('Проверка завершена');
    render();
    openCompetitorCard(id);
  } catch (e) { toast(e.message, 'err'); }
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
  state.compTab = state.compTab || 'report';
  openModal(`
   <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
     <div><h3 style="margin:0">${esc(c.name)}</h3><small>ИНН: ${esc(c.inn || '—')} · ${esc(c.city || '')}</small></div>
     <div style="display:flex;gap:6px">
       <button class="btn sm primary" onclick="checkCompetitor(${c.id})">${icon('refresh', 13)} Проверить сейчас</button>
       <button class="btn sm" onclick="openPriceImport(${c.id},'theirs')">${icon('excel', 13)} Загрузить прайс</button>
     </div>
   </div>
   <div class="tabs" style="margin-bottom:12px">
     <button class="${state.compTab === 'report' ? 'active' : ''}" onclick="state.compTab='report';openCompetitorCard(${id})">Сводный отчёт</button>
     <button class="${state.compTab === 'sources' ? 'active' : ''}" onclick="state.compTab='sources';openCompetitorCard(${id})">Источники (${(c.checks || []).length})</button>
     <button class="${state.compTab === 'debts' ? 'active' : ''}" onclick="state.compTab='debts';openCompetitorCard(${id})">Долги и суды</button>
     <button class="${state.compTab === 'reviews' ? 'active' : ''}" onclick="state.compTab='reviews';openCompetitorCard(${id})">Отзывы (${(c.reviews || []).length})</button>
     <button class="${state.compTab === 'prices' ? 'active' : ''}" onclick="state.compTab='prices';openCompetitorCard(${id})">Сравнение цен</button>
     <button class="${state.compTab === 'history' ? 'active' : ''}" onclick="state.compTab='history';openCompetitorCard(${id})">История</button>
   </div>
   <div id="compTabBody">${competitorTab(c)}</div>`);
}

function competitorTab(c) {
  const rep = c.report || {};
  const checks = c.checks || [];
  const g = key => checks.find(s => s.source === key) || {};
  if (state.compTab === 'report') {
    const color = RISK_COLORS[rep.level] || 'var(--ink)';
    return `
     <div class="grid" style="margin-bottom:12px">
       <div class="kpi"><span style="color:var(--muted)">Риск-скор</span><b style="font-size:28px;color:${color}">${rep.risk ?? '—'} / 100</b><small>${RISK_LABELS[rep.level] || 'проверок не было'}</small></div>
       <div class="kpi"><span style="color:var(--muted)">Исполнительные производства</span><b>${fmt((g('fssp').data || {}).total || 0)}</b><small>по базе ФССП</small></div>
       <div class="kpi"><span style="color:var(--muted)">Арбитражные дела</span><b>${Number((g('kad').data || {}).total || 0)} дел</b><small>Кад.Арбитр</small></div>
       <div class="kpi"><span style="color:var(--muted)">Средний рейтинг</span><b>${(rep.reviews && rep.reviews.avgRating) ? rep.reviews.avgRating + ' ' + icon('star', 12) : '—'}</b><small>карты и отзывы</small></div>
     </div>
     <div class="card" style="box-shadow:none;border-color:var(--line)">
       <h4>Вердикт разведки</h4>
       <p>${esc(rep.verdict || 'Запустите проверку конкурента для получения сводки.')}</p>
       <h4 style="margin-top:12px">Аргументы для менеджера в переговорах:</h4>
       <div class="list">${(rep.talking_points || []).map(p => `<div class="row"><span>• ${esc(p)}</span></div>`).join('') || '<small>Факторы риска не выявлены — аргументов пока нет</small>'}</div>
       <hr><p><small>Ссылки для ручной проверки: <a href="https://www.rusprofile.ru/search?query=${encodeURIComponent(c.inn || c.name)}" target="_blank" rel="noopener">rusprofile.ru</a> · <a href="https://pb.nalog.ru/search.html?query=${encodeURIComponent(c.inn || c.name)}" target="_blank" rel="noopener">pb.nalog.ru (ФНС)</a></small></p>
     </div>`;
  }
  if (state.compTab === 'sources') {
    return `<table><tr><th>Источник</th><th>Статус</th><th>Данные</th><th>Обновлено</th></tr>
     ${checks.map(s => `<tr><td><b>${esc(s.title || s.source)}</b></td><td><span class="tag ${s.status === 'ok' ? '' : 'orange'}">${esc(s.status)}</span></td><td><small>${esc(s.summary || '—')}</small></td><td><small>${esc(dt(s.checked_at))}</small></td></tr>`).join('') || '<tr><td colspan="4"><small>Источники ещё не опрашивались</small></td></tr>'}</table>`;
  }
  if (state.compTab === 'debts') {
    const fssp = g('fssp').data || {};
    const kad = g('kad').data || {};
    return `<div class="cols"><div>
     <h4>ФССП (долги у судебных приставов)</h4>
     <p>Общая сумма долгов: <b>${fmt(fssp.total || 0)}</b></p>
     <div class="list">${(fssp.productions || []).map(d => `<div class="row"><span>${esc(d.number || 'Исполнительное производство')}<br><small>${fmt(d.sum || 0)} · ${esc(d.subject || '')}</small></span></div>`).join('') || '<small>Долгов у приставов не найдено</small>'}</div>
    </div><div>
     <h4>Арбитражные суды (Кад.Арбитр)</h4>
     <p>Всего дел: <b>${kad.total || 0}</b></p>
     <div class="list">${(kad.cases || []).map(x => `<div class="row"><span>Дело № ${esc(x.number)}<br><small>${esc(x.role || 'Участник')} · ${fmt(x.sum || 0)} · ${esc(x.type || '')}</small></span></div>`).join('') || '<small>Судебных споров не найдено</small>'}</div>
    </div></div>`;
  }
  if (state.compTab === 'reviews') {
    return `<div class="row" style="border:0"><h4>Отзывы клиентов (${(c.reviews || []).length})</h4><button class="btn sm" onclick="addReview(${c.id})">+ Добавить отзыв</button></div>
     <div class="list">${(c.reviews || []).map(r => `<div class="row"><span><b>${esc(r.author || 'Клиент')}</b> (${r.rating} ${icon('star', 12)}) — <small>${esc(r.source || 'карты')}</small><br>${esc(r.text)}</span><button class="btn sm danger" onclick="delReview(${r.id},${c.id})">${icon('close', 13)}</button></div>`).join('') || '<small>Отзывов пока нет</small>'}</div>`;
  }
  if (state.compTab === 'prices') {
    const pairs = (rep.pricing && rep.pricing.pairs) || [];
    return `<div class="row" style="border:0"><h4>Сравнение с нашей таблицей цен</h4><button class="btn sm primary" onclick="openPriceImport(${c.id},'theirs')">Загрузить прайс конкурента</button></div>
     <p><small>Загружено позиций конкурента: ${(c.prices || []).length}. Сравнение строится по совпадающим названиям, когда загружены оба прайса.</small></p>
     <table><tr><th>Позиция / проект</th><th>Цена конкурента</th><th>Наша цена</th><th>Разница</th></tr>
      ${pairs.map(x => {
        const diff = (x.theirs || 0) - (x.ours || 0);
        return `<tr><td><b>${esc(x.item)}</b></td><td>${fmt(x.theirs)}</td><td>${fmt(x.ours)}</td><td><span class="tag ${diff <= 0 ? '' : 'orange'}">${diff <= 0 ? 'Мы дешевле на ' + fmt(-diff) : 'Конкурент дешевле на ' + fmt(diff)}</span></td></tr>`;
      }).join('') || '<tr><td colspan="4"><small>Сравнение пусто — загрузите свой и конкурентский прайсы и запустите проверку</small></td></tr>'}</table>`;
  }
  if (state.compTab === 'history') {
    return `<div class="list">${(c.history || []).map(h => `<div class="row"><span><b style="color:${RISK_COLORS[h.level] || 'var(--ink)'}">риск ${h.risk}</b> · ${esc(h.level)}<br><small>${esc(h.verdict || '')}</small></span><small>${esc(dt(h.created_at))}</small></div>`).join('') || '<small>Проверок ещё не было</small>'}</div>`;
  }
}

function addReview(cid) {
  openModal(`<h3>Добавить отзыв</h3><form onsubmit="return saveReview(event,${cid})"><label>Автор<input name="author" placeholder="Алексей"></label><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Оценка (1-5)<input name="rating" type="number" min="1" max="5" value="5"></label><label>Источник<select name="source"><option value="yandex">Яндекс</option><option value="google">Google</option><option value="2gis">2ГИС</option><option value="avito">Авито</option></select></label></div><label>Текст отзыва*<textarea name="text" rows="3" required></textarea></label><button class="btn primary w">Сохранить</button></form>`);
}
async function saveReview(e, cid) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); b.competitor_id = cid; b.rating = +b.rating; await api('/api/reviews', { method: 'POST', body: JSON.stringify(b) }); closeModal(); toast('Отзыв добавлен'); openCompetitorCard(cid); return false; }
async function delReview(rid, cid) { await api('/api/reviews/' + rid, { method: 'DELETE' }); toast('Удалено'); openCompetitorCard(cid); }

function openPriceImport(competitorId, scope) {
  openModal(`<h3>Загрузка прайс-таблицы (Excel / CSV)</h3>
   <p><small>${scope === 'ours' ? 'Наша таблица цен — используется для сравнения во всех отчётах.' : 'Прайс конкурента — для сравнения позиций.'}</small></p>
   <p><small>Первая строка — заголовки: <code>Наименование;Цена;Ед</code>. Например: <code>Дом 8×10;3850000;шт</code>. CSV в UTF-8 или первый лист XLSX, цены числами. <a href="/examples/prices.csv" download>Скачать пример CSV</a>.</small></p>
   <div class="tabs"><button class="active" onclick="this.parentElement.nextElementSibling.classList.remove('hidden');this.nextElementSibling.classList.remove('active');this.classList.add('active');">Файл .xlsx / .csv</button><button onclick="openPriceTextForm(${competitorId},'${scope}')">Текст / ссылки</button></div>
   <div><form onsubmit="return importPriceFile(event,${competitorId || 'null'},'${scope}')">
     <label>Выберите файл таблицы (.xlsx или .csv)<input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required></label>
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
      await api(url, { method: 'POST', body: JSON.stringify({ base64, filename: file.name, scope }) });
      closeModal(); toast('Прайс-таблица успешно загружена');
      if (competitorId) openCompetitorCard(competitorId); else render();
    } catch (err) { toast(err.message, 'err'); }
  };
  reader.readAsDataURL(file);
  return false;
}

function openPriceTextForm(competitorId, scope) {
  openModal(`<h3>Загрузка прайса текстом или по URL</h3><form onsubmit="return importPriceText(event,${competitorId || 'null'},'${scope}')">
   <label>Ссылка на опубликованную таблицу Google Sheets / CSV<input name="url" placeholder="https://docs.google.com/spreadsheets/d/…/export?format=csv"></label>
   <label>Или вставьте строки (Позиция;Цена;Ед)<textarea name="text" rows="6" placeholder="Каркасный дом 8х10;3850000;шт&#10;Баня 4х6;890000;шт"></textarea></label>
   <button class="btn primary w">Сохранить</button></form>`);
}

async function importPriceText(e, competitorId, scope) {
  e.preventDefault(); const { url, text } = Object.fromEntries(new FormData(e.target));
  const endpoint = competitorId ? `/api/competitors/${competitorId}/prices` : '/api/prices/ours';
  await api(endpoint, { method: 'POST', body: JSON.stringify({ url, text, scope }) });
  closeModal(); toast('Цены сохранены');
  if (competitorId) openCompetitorCard(competitorId); else render();
  return false;
}

/* ---------- settings ---------- */
async function settings(v) {
  const isAdmin = (state.me && state.me.role) === 'admin';
  const s = isAdmin ? await api('/api/settings') : {}; state.cache.settings = s; const origin = location.origin;
  const allTabs = {
    integrations: 'Интеграции и каналы',
    fields: 'Поля карточек',
    competitors: 'Конкуренты и источники',
    pipelines: 'Воронки и этапы',
    automations: 'Автоматизации',
    templates: 'Шаблоны сообщений',
    team: 'Команда',
    data: 'Данные и компания',
    profile: 'Профиль'
  };
  const adminOnly = ['integrations', 'competitors', 'fields', 'pipelines', 'automations', 'team', 'data'];
  const tabs = Object.fromEntries(Object.entries(allTabs).filter(([k]) => isAdmin || !adminOnly.includes(k)));
  if (!tabs[state.settingsTab]) state.settingsTab = isAdmin ? 'integrations' : 'profile';
  let body = '';

  if (state.settingsTab === 'integrations') {
    const chans = state.channels.length ? state.channels : await api('/api/channels').catch(() => []); state.channels = chans;
    body = `${!isAdmin ? '<div class="card" style="box-shadow:none;border-color:#fde68a;background:#fffbeb"><b>Режим просмотра</b><br><small>Ключи и настройки интеграций меняет администратор. Вы можете работать с чатами, сделками и задачами — всё остальное доступно.</small></div>' : ''}
    <div class="settings-cols"><div>
     <div class="card"><h3>Мессенджеры через Wazzup</h3>
      <p><small>Один ключ Wazzup объединяет <b>WhatsApp, Telegram, Instagram и Viber</b> в одном разделе «Чаты» — отдельные подключения для каждого мессенджера не нужны. Ключ создаётся в личном кабинете Wazzup: раздел «Интеграция с CRM» → API.</small></p>
      <p>Статус: <b class="${s.wazzup.configured ? 'green' : ''}">${s.wazzup.configured ? 'подключено' : 'не подключено'}</b></p>
      <label>API-ключ Wazzup<input id="wzKey" placeholder="${esc(s.wazzup.api_key || 'вставьте ключ из личного кабинета Wazzup')}"></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Канал по умолчанию<select id="wzChannel"><option value="">— выберите канал —</option>${chans.map(c => `<option value="${esc(c.external_id)}" ${c.external_id === s.wazzup.channel_id ? 'selected' : ''}>${esc(c.name || c.phone || c.transport || c.external_id)}</option>`).join('')}</select></label>
      <label>Секрет для уведомлений (необязательно)<input id="wzSecret" value="${esc(s.wazzup.webhook_secret || '')}"></label></div>
      <label>Адрес API Wazzup<input id="wzUrl" value="${esc(s.wazzup.api_url)}"></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" onclick="saveWazzup()">Сохранить</button><button class="btn" onclick="testWazzup()">${icon('sync', 13)} Проверить и синхронизировать каналы</button></div>
      <hr><p><b>Адрес для уведомлений Wazzup (webhook)</b></p><p><small>Этот адрес указывается в настройках вебхуков Wazzup или регистрируется автоматически кнопкой ниже.</small></p><code>${origin}/webhooks/wazzup${s.wazzup.webhook_secret ? '?secret=' + esc(s.wazzup.webhook_secret) : ''}</code>
      <p><button class="btn sm" onclick="registerWazzupWebhook()">Зарегистрировать адрес автоматически</button></p>
      <hr><h3>Подключённые каналы (${chans.length})</h3>${chans.map(c => `<div class="row"><span>${esc(c.name || c.transport || c.external_id)}<br><small>${esc(channelLabel(c.transport))} ${esc(c.phone || '')} · статус: ${esc(c.state === 'active' ? 'активен' : (c.state || 'неизвестно'))}</small></span><span class="tag ${c.state === 'active' ? '' : 'grey'}">${esc(c.state === 'active' ? 'активен' : (c.state || 'неизвестно'))}</span></div>`).join('') || '<small>Каналы появятся после сохранения ключа и синхронизации.</small>'}</div>

     <div class="card"><h3>Форма заявки для сайта и свой вебхук</h3>
      <p><small>Готовый код формы ставится на любой сайт — заявки сразу попадают в «Чаты» и создают сделку. Сюда же можно направлять сообщения своего Telegram-бота или любой системы: POST JSON на адрес ниже.</small></p>
      <p>Адрес для формы и вебхуков: <code>${origin}/webhooks/generic${s.webhook?.secret ? '?secret=' + esc(s.webhook.secret) : ''}</code></p>
      <label>Секрет вебхука (защита от чужого спама)
        <div style="display:flex;gap:8px"><input id="whSecret" value="${esc(s.webhook?.secret || '')}" placeholder="пусто — принимать любые заявки"><button type="button" class="btn sm" style="white-space:nowrap" onclick="genWebhookSecret()">Сгенерировать</button></div>
      </label>
      <p><small>Если секрет задан, заявка без него отклоняется. Код формы ниже уже содержит секрет. Присылайте заявки на адрес с параметром <code>?secret=…</code> или с заголовком <code>x-webhook-secret</code>.</small></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary sm" onclick="saveWebhookSecret()">Сохранить секрет</button><button class="btn sm" onclick="copySiteFormCode()">${icon('copy', 13)} Скопировать код формы для сайта</button></div></div>

     <div class="card"><h3>Электронная почта</h3>
      <p><small>После настройки письма клиентам отправляются прямо из карточки чата, а входящие письма попадают в ту же переписку. Для Яндекс Почты, Mail.ru и Gmail нужен «пароль приложения», а не обычный пароль от ящика.</small></p>
      <p>Статус: <b class="${s.email.configured ? 'green' : ''}">${s.email.configured ? 'почта настроена' : 'не настроена'}</b></p>
      <form onsubmit="return saveEmail(event)">
       <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px"><label>SMTP-сервер<input name="SMTP_HOST" value="${esc(s.email.host || '')}" placeholder="smtp.mail.ru"></label><label>Порт<input name="SMTP_PORT" value="${esc(s.email.port || '587')}" placeholder="465 или 587"></label></div>
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Логин (адрес ящика)<input name="SMTP_USER" value="${esc(s.email.user || '')}" placeholder="crm@company.ru"></label><label>Пароль приложения<input name="SMTP_PASS" type="password" placeholder="${s.email.pass ? '•••••• (сохранён)' : 'пароль приложения'}"></label></div>
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Шифрование<select name="SMTP_SECURE"><option value="" ${!s.email.secure ? 'selected' : ''}>Авто: STARTTLS</option><option value="1" ${s.email.secure === '1' ? 'selected' : ''}>SSL/TLS сразу (обычно 465)</option><option value="0" ${s.email.secure === '0' ? 'selected' : ''}>Без шифрования (внутренний сервер)</option></select></label><label>Адрес отправителя<input name="MAIL_FROM" value="${esc(s.email.from || '')}" placeholder="crm@company.ru"></label></div>
       <label>Адрес для проверочного письма<input name="SMTP_TEST_TO" value="${esc(s.email.test_to || '')}" placeholder="admin@company.ru"></label>
       <div style="display:flex;gap:8px"><button class="btn primary">Сохранить почту</button><button class="btn" type="button" onclick="testEmail(this.form)">Отправить проверочное письмо</button></div></form>
      <hr><p><b>Приём входящих писем</b></p>
      <p><small>Настройте в почтовом ящике пересылку входящих на адрес ниже. Секрет защищает адрес от чужого спама; если он пуст, письма принимаются без проверки.</small></p>
      <div style="display:flex;gap:8px"><input id="emailSecret" value="${esc(s.email.webhook_secret || '')}" placeholder="секрет для входящих писем"><button type="button" class="btn sm" style="white-space:nowrap" onclick="genEmailSecret()">Сгенерировать</button><button type="button" class="btn sm primary" style="white-space:nowrap" onclick="saveEmailSecret()">Сохранить</button></div>
      <p style="margin-top:8px"><code>${origin}/webhooks/email${s.email.webhook_secret ? '?secret=' + esc(s.email.webhook_secret) : ''}</code></p>
     </div>
    </div><div>
     <div class="card"><h3>Проверка связи</h3><button class="btn orange w" onclick="checkHealth()">Проверить работу сервера</button><p style="margin-top:8px"><small>Проверка доступности сервера и базы данных. Диалоги и входящие сообщения появляются автоматически при подключённых каналах связи.</small></p></div>
    </div></div>`;
  } else if (state.settingsTab === 'fields') {
    const cf = await api('/api/custom-fields');
    const rows = cf.fields;
    body = `<div class="settings-cols"><div class="card"><div class="row" style="border:0"><h3>Свои поля для контактов и сделок</h3><button class="btn sm primary" onclick="editField(-1)">+ Поле</button></div>
     <table><tr><th>Название</th><th>Где</th><th>Тип</th><th>Обязательное</th><th></th></tr>${rows.map((f, i) => `<tr><td><b>${esc(f.label)}</b></td><td>${({ contacts: 'Контакты', deals: 'Сделки', both: 'Везде' })[f.entity] || esc(f.entity)}</td><td>${({ text: 'Текст', number: 'Число', date: 'Дата', select: 'Список', phone: 'Телефон', email: 'E-mail' })[f.type] || esc(f.type)}${f.options && f.options.length ? '<br><small>' + f.options.map(esc).join(', ') + '</small>' : ''}</td><td>${f.required ? 'Да' : '—'}</td><td><button class="btn sm" onclick="editField(${i})">${icon('edit', 13)}</button> <button class="btn sm danger" onclick="delField(${i})">${icon('close', 13)}</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Своих полей пока нет</div></td></tr>'}</table>
     <p><small>Например: «Площадь участка», «Тип фундамента», «Дата замера». Поля сразу появляются в формах и карточках и попадают во все выгрузки.</small></p></div>
     <div><div class="card"><h3>Как работают свои поля</h3><p><small>Достаточно ввести понятное название — система сама позаботится обо всём остальном. Поля сохраняются в карточке клиента или сделки, участвуют в фильтрах и печатных документах.</small></p></div></div></div>`;
  } else if (state.settingsTab === 'competitors') {
    const cs = await api('/api/competitor-sources');
    const ours = await api('/api/prices?scope=ours');
    const KEY_FIELDS = [['FNS_API_KEY', 'Ключ api-fns.ru (ФНС)', 'api-fns.ru'], ['FSSP_TOKEN', 'Токен ФССП (долги)', 'api-ip.fssprus.ru'], ['GOOGLE_PLACES_KEY', 'Ключ Google Places', 'Places API'], ['TWOGIS_KEY', 'Ключ 2ГИС', '2gis.ru'], ['YANDEX_API_KEY', 'Ключ Яндекс Геопоиска', 'Geosearch API']];
    body = `<div class="settings-cols"><div>
     <div class="card"><h3>Статус источников</h3><table class="mini"><tr><th>Источник</th><th>Что даёт</th><th>Готовность</th></tr>${cs.sources.map(s => `<tr><td><b>${esc(s.name)}</b>${s.needs.length ? `<br><small>нужен ключ</small>` : '<br><small>без ключа</small>'}</td><td><small>${esc(s.about)}</small></td><td><span class="tag ${s.configured ? '' : 'grey'}">${s.configured ? 'готов' : s.needs.length ? 'нет ключа' : 'по ссылкам'}</span></td></tr>`).join('')}</table></div>
     ${isAdmin ? `<div class="card"><h3>Ключи источников (хранятся на сервере)</h3><form onsubmit="return saveCompetitorKeys(event)">${KEY_FIELDS.map(([k, label, hint]) => `<label>${esc(label)}<input name="${k}" placeholder="${cs.keys[k] ? '•••••• (сохранён)' : esc(hint)}"></label>`).join('')}<button class="btn primary">Сохранить ключи</button></form></div>` : `<div class="card"><h3>Ключи источников</h3><p><small>Ключи источников задаёт администратор: Настройки → Конкуренты и источники. Отчёты и ссылки доступны всем — можно проверять конкурентов прямо сейчас.</small></p></div>`}
     <div class="card"><h3>Наша таблица цен</h3>${ours.rows.length ? `<p><b>Загружено позиций: ${ours.rows.length}</b></p>` : '<p><small>Пока не загружена.</small></p>'}<button class="btn primary w" onclick="openPriceImport(null,'ours')">Загрузить нашу таблицу цен</button></div>
    </div><div>
     <div class="card"><h3>Принцип работы разведки</h3><p><small>CRM собирает информацию по открытым реестрам, судам, долгам и картам, рассчитывает риск-скор и даёт подсказки менеджеру.</small></p></div>
     ${isAdmin ? `<div class="card"><h3>Адреса API источников</h3><form onsubmit="return saveCompetitorUrls(event)">${[['FNS_API_URL', 'ФНС API'], ['FSSP_API_URL', 'ФССП API'], ['FEDRESURS_API_URL', 'Федресурс'], ['KAD_API_URL', 'Арбитр'], ['RUSPROFILE_URL', 'Rusprofile'], ['GOOGLE_API_URL', 'Google Places'], ['TWOGIS_API_URL', '2ГИС'], ['YANDEX_API_URL', 'Яндекс Геопоиск']].map(([k, n]) => `<label>${n}<input name="${k}" value="${esc((cs.urls || {})[k] || '')}"></label>`).join('')}<button class="btn">Сохранить адреса</button></form></div>` : ''}
    </div></div>`;
  } else if (state.settingsTab === 'pipelines') {
    const pl = await api('/api/pipelines');
    body = `<div class="card"><div class="row" style="border:0"><h3>Воронки и этапы</h3><button class="btn sm primary" onclick="addPipeline()">+ Воронка</button></div>
    ${pl.map(p => `<div class="card" style="box-shadow:none"><b>${esc(p.name)}</b> <small>${p.stages.length} этапов</small> <button class="btn sm" onclick="editPipeline(${p.id})">Редактировать этапы</button> ${pl.length > 1 ? `<button class="btn sm danger" onclick="del('pipelines',${p.id})">${icon('close', 13)}</button>` : ''}
     <div style="margin-top:8px">${p.stages.map(s => `<span class="tag" style="background:${esc(s.color)}22;color:${esc(s.color)}">● ${esc(s.name)}</span>`).join(' ')}</div></div>`).join('')}</div>`;
  } else if (state.settingsTab === 'automations') {
    const rows = await api('/api/automations');
    const trg = { deal_created: 'Создана сделка', message_in: 'Входящее сообщение', stage_changed: 'Смена этапа' };
    const act = { create_task: 'Создать задачу', change_stage: 'Перевести на этап', add_tag: 'Добавить тег' };
    body = `<div class="card"><div class="row" style="border:0"><h3>Автоматизации</h3><button class="btn sm primary" onclick="openAutomation()">+ Правило</button></div>
    <table><tr><th>Название</th><th>Когда</th><th>Что сделать</th><th>Вкл.</th><th></th></tr>${rows.map(a => `<tr><td><b>${esc(a.name)}</b></td><td>${trg[a.trigger_type] || esc(a.trigger_type)}</td><td>${act[a.action_type] || esc(a.action_type)}: <small>${esc(a.action_value || '')}</small></td>
     <td><input type="checkbox" style="width:auto" ${a.active ? 'checked' : ''} onchange="api('/api/automations/${a.id}',{method:'PATCH',body:JSON.stringify({active:this.checked?1:0})}).then(()=>toast('Обновлено'))"></td>
     <td><button class="btn sm" onclick="openAutomation(${a.id})">${icon('edit', 13)}</button> <button class="btn sm danger" onclick="del('automations',${a.id})">${icon('close', 13)}</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Правил нет</div></td></tr>'}</table></div>`;
  } else if (state.settingsTab === 'templates') {
    const rows = await api('/api/templates');
    const tplRow = t => `<div class=\"card\" style=\"box-shadow:none\"><b>${esc(t.name)}</b> <span class=\"tag grey\">${esc(channelLabel(t.channel))}</span><span style=\"float:right;display:flex;gap:6px\"><button class=\"btn sm\" onclick=\"openTemplate(${t.id})\">${icon('edit', 13)}</button><button class=\"btn sm danger\" onclick=\"delTemplate(${t.id})\">${icon('trash', 13)}</button></span><p>${esc(t.body)}</p></div>`;
    body = `<div class=\"settings-cols\"><div>
     <div class=\"card\"><div class=\"row\" style=\"border:0\"><h3>Мои шаблоны (${rows.length})</h3><button class=\"btn sm primary\" onclick=\"openTemplate()\">${icon('plus', 13)} Новый шаблон</button></div>
     ${rows.map(tplRow).join('') || '<small>Шаблонов пока нет — создайте первый для частых ответов в чате.</small>'}</div>
    </div><div>
     <div class=\"card\"><h3>Как это работает</h3><p><small>Шаблоны личные: видит и правит только вы. В чате выбираются одним кликом из поля ввода и подставляются в текст — останется проверить и отправить. В тексте работают подстановки: {name} — клиент, {sum} — сумма сделки.</small></p></div>
    </div></div>`;
  } else if (state.settingsTab === 'team') {
    const rows = await api('/api/users');
    const allDeals = (await api('/api/deals')).deals;
    const allTasks = await api('/api/tasks');
    const stat = id => {
      const my = allDeals.filter(d => d.responsible_id === id);
      const open = my.filter(d => !['won', 'lost'].includes(d.stage));
      const tasks = allTasks.filter(t => t.responsible_id === id && !t.done);
      return { open: open.length, sum: open.reduce((a, d) => a + d.amount, 0), won: my.filter(d => d.stage === 'won').length, tasks: tasks.length };
    };
    body = `<div class="card"><div class="row" style="border:0"><h3>Команда</h3><button class="btn sm primary" onclick="openUser()">+ Пользователь</button></div>
    <table><tr><th>Сотрудник</th><th>E-mail</th><th>Роль</th><th>Сделки в работе</th><th>Задачи</th><th>Вход</th><th></th></tr>${rows.map(x => { const st = stat(x.id); return `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.email)}</td><td>${esc(roleLabel(x.role))}</td><td>${st.open} на ${fmt(st.sum)}<br><small>успешных: ${st.won}</small></td><td>${st.tasks}</td><td>${x.active ? 'разрешён' : 'отключён'}</td><td><button class="btn sm" onclick="openUser(${x.id})">${icon('edit', 13)}</button></td></tr>`; }).join('')}</table>
    <div style="margin-top:14px"><div class="card" style="box-shadow:none"><h3>Права ролей</h3><p><small><b>Администратор</b> — всё, включая настройки, команду, интеграции и данные.<br><b>Менеджер</b> — контакты, компании, сделки, задачи, заметки и все чаты; настройки и справочники меняет админ.<br><b>Наблюдатель</b> — только чтение и выгрузки.</small></p></div></div></div>`;
  } else if (state.settingsTab === 'data') {
    const demoRows = Object.values(s.demo || {}).reduce((a, b) => a + b, 0);
    body = `${demoRows ? `<div class="card" style="box-shadow:none;border-color:#fde68a;background:#fffbeb"><h3>${icon('sparkles', 16)} Демонстрационные данные</h3><p><small>Сейчас в базе примеры: клиентов ${s.demo?.contacts || 0}, сделок ${s.demo?.deals || 0}, задач ${s.demo?.tasks || 0}, чатов ${s.demo?.conversations || 0}, конкурентов ${s.demo?.competitors || 0}, товаров каталога ${s.demo?.products || 0}, шаблонов ${s.demo?.templates || 0}, правил ${s.demo?.automations || 0}. Их можно редактировать как обычные данные или удалить одной кнопкой — тогда CRM будет полностью чистой.</small></p><button class="btn danger sm" onclick="cleanDemo()">${icon('trash', 13)} Удалить демонстрационные данные</button></div>` : ''}
    <div class="settings-cols"><div><div class="card"><h3>Название компании</h3><form onsubmit="return saveCompanySettings(event)"><div style="display:grid;grid-template-columns:2fr 1fr;gap:12px"><label>Название<input name="COMPANY_NAME" value="${esc(s.company.name)}"></label><label>Валюта<input name="CURRENCY" value="${esc(s.company.currency)}"></label></div>
     <label>Автосоздание сделки при обращении<select name="AUTO_DEAL"><option value="1" ${s.auto_deal === '1' ? 'selected' : ''}>Да — создавать сделку «Неразобранное»</option><option value="0" ${s.auto_deal !== '1' ? 'selected' : ''}>Нет</option></select></label>
     <label>Распределять новые обращения между менеджерами<select name="AUTO_ASSIGN"><option value="0" ${s.auto_assign !== '1' ? 'selected' : ''}>Нет — оставлять без ответственного</option><option value="1" ${s.auto_assign === '1' ? 'selected' : ''}>Да — отдавать наименее загруженному менеджеру</option></select></label>
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
       <label>Префикс номеров документов<input name="DOC_PREFIX" value="${esc((s.requisites || {}).doc_prefix || '')}" placeholder="К-"></label></div>
       <button class="btn primary">Сохранить реквизиты</button></form></div>
    </div><div>
     <div class="card"><h3>Резервные копии базы</h3>
       <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary sm" onclick="makeBackup()">${icon('plus', 13)} Создать копию сейчас</button>
       <button class="btn sm" onclick="download('/api/export/json','karkas-backup.json')" title="Полная выгрузка всех данных в JSON">${icon('download', 13)} Выгрузить данные (JSON)</button></div>
       <div id="backupList" style="margin-top:10px">Загрузка…</div>
     </div>
     <div class="card"><h3>Логотип компании</h3>
      <p><small>Загрузка необязательна: по умолчанию используется logo.jpg из комплекта. PNG, JPG, GIF или WebP, до 4 МБ. Логотип показывается на странице входа, в боковой панели, во вкладке браузера и на документах.</small></p>
      <div class="logo-admin">
        <img id="logoPreview" src="/logo.png?ts=${Date.now()}" alt="Логотип" class="logo-admin-img">
        <div class="logo-admin-actions">
          <button type="button" class="btn primary sm" onclick="$('#logoFile').click()">${icon('upload', 13)} Загрузить логотип</button>
          <input type="file" id="logoFile" class="hidden" accept="image/png,image/jpeg,image/gif,image/webp" onchange="uploadLogo(this)">
          <button type="button" class="btn danger sm" id="logoDeleteBtn" ${s.logo && s.logo.custom ? '' : 'disabled'} onclick="deleteLogo()">Удалить логотип</button>
        </div>
      </div>
      ${s.logo && s.logo.env ? '<p><small>Задан LOGO_FILE на сервере: он имеет приоритет над загрузкой.</small></p>' : ''}
    </div>
     <div class="card"><h3>Обслуживание и уведомления</h3>
      <p><small>Резервные копии создаются автоматически и хранятся указанное число дней. Просроченные задачи можно отправлять во внешний сервис (Slack, бот, свой обработчик).</small></p>
      <form onsubmit="return saveMaintenance(event)">
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Хранить копии, дней<input name="BACKUP_KEEP_DAYS" type="number" min="0" max="3650" value="${esc(String(s.maintenance?.backup_keep_days ?? 7))}"></label>
       <label>Час создания копии (0–23)<input name="BACKUP_HOUR" type="number" min="0" max="23" value="${esc(String(s.maintenance?.backup_hour ?? 3))}"></label></div>
       <label>Адрес для уведомлений о просроченных задачах (необязательно)<input name="NOTIFY_WEBHOOK" value="${esc(s.maintenance?.notify_webhook || '')}" placeholder="https://hooks.slack.com/services/…"></label>
       <button class="btn primary">Сохранить обслуживание</button>
      </form>
     </div>
     <div class="card"><h3>Дополнительные параметры</h3>
      <p><small>Сохраняются в базе и перекрывают значения из .env — после смены здесь править .env не нужно.</small></p>
      <form onsubmit="return saveAdvanced(event)">
       <label>Встраивание в iframe (FRAME_ANCESTORS)<input name="FRAME_ANCESTORS" value="${esc(s.advanced?.frame_ancestors || '')}" placeholder="пусто = запрещено · например https://портал.ru или *"></label>
       <p style="margin:-4px 0 10px"><small>Кому можно показывать CRM внутри своего сайта через iframe. Пустое поле — запрещено всем (безопасно по умолчанию); адрес вида <code>https://портал.ru</code> — только этому сайту; <code>*</code> — любому сайту (не рекомендуется). На обычную работу CRM не влияет.</small></p>
       <label>Попыток входа с одного IP за 5 минут<input name="LOGIN_RATE_LIMIT" type="number" min="1" max="10000" value="${esc(String(s.advanced?.login_rate_limit ?? 12))}"></label>
       <p style="margin:-4px 0 10px"><small>Защита от подбора пароля: после указанного числа неудачных попыток вход с этого IP временно блокируется на 5 минут. Для офиса за одним IP ставьте значение повыше, для открытого интернета хватает 10–20.</small></p>
       <button class="btn primary">Сохранить параметры</button>
      </form>
      <p><small>Режим начальных данных (SEED_MODE): <b>${esc(s.seed_mode || 'demo')}</b> — применяется только при первом запуске на пустой базе.</small></p>
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

  v.innerHTML = `<div class="tabs">${Object.entries(tabs).map(([k, n]) => `<button class="${state.settingsTab === k ? 'active' : ''}" onclick="state.settingsTab='${k}';render()">${n}</button>`).join('')}</div>${body}`;
  if (state.settingsTab === 'data') loadBackups();
}

async function saveWazzup() { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_API_KEY: $('#wzKey').value, WAZZUP_CHANNEL_ID: $('#wzChannel').value, WAZZUP_WEBHOOK_SECRET: $('#wzSecret').value, WAZZUP_API_URL: $('#wzUrl').value }) }); toast('Ключ сохранён'); render(); }
let __fields = null;
async function loadFields() { if (!__fields) __fields = (await api('/api/custom-fields')).fields; return __fields; }
// Транслитерация названия поля в технический ключ — пользователь его не видит.
function translit(s) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  return String(s).toLowerCase().split('').map(ch => (ch in map ? map[ch] : (/[a-z0-9]/.test(ch) ? ch : '_'))).join('').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}
async function editField(i) {
  const list = await loadFields(); const f = i >= 0 ? list[i] : { key: '', label: '', type: 'text', entity: 'both', options: [], required: false };
  openModal(`<h3>${i >= 0 ? 'Поле' : 'Новое поле карточки'}</h3><form onsubmit="return saveField(event,${i})">
   <input type="hidden" name="key" value="${esc(f.key)}">
   <label>Название поля*<input name="label" required value="${esc(f.label)}" placeholder="Площадь участка"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Тип<select name="type">${[['text', 'Текст'], ['number', 'Число'], ['date', 'Дата'], ['email', 'E-mail'], ['phone', 'Телефон'], ['select', 'Список вариантов']].map(([k, n]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
   <label>Где показывать<select name="entity">${[['both', 'Везде'], ['contacts', 'Только контакты'], ['deals', 'Только сделки']].map(([k, n]) => `<option value="${k}" ${k === f.entity ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
   <label>Варианты (только для типа «Список вариантов», через запятую)<input name="options" value="${esc((f.options || []).join(', '))}" placeholder="каркас, брус, газобетон"></label>
   <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="required" style="width:auto" ${f.required ? 'checked' : ''}> Обязательное для заполнения</label>
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
  const n = (r.channels || []).length; const sync = await api('/api/integrations/wazzup/sync', { method: 'POST' }).catch(e => ({ error: e.message }));
  toast(sync.error ? sync.error : `Каналов найдено и сохранено: ${sync.synced ?? n}`); state.channels = []; render();
}
async function registerWazzupWebhook() { const url = location.origin + '/webhooks/wazzup'; try { await api('/api/integrations/wazzup/webhook', { method: 'POST', body: JSON.stringify({ url }) }); toast('Вебхук зарегистрирован'); } catch (e) { toast(e.message, 'err'); } }
async function saveCompetitorKeys(e) { e.preventDefault(); const b = {}; for (const [k, v] of new FormData(e.target)) if (v && !String(v).includes('•')) b[k] = v; await api('/api/competitor-sources', { method: 'PUT', body: JSON.stringify(b) }); toast('Ключи сохранены'); render(); return false; }
async function saveCompetitorUrls(e) { e.preventDefault(); const b = {}; for (const [k, v] of new FormData(e.target)) if (v) b[k] = v; await api('/api/competitor-sources', { method: 'PUT', body: JSON.stringify(b) }); toast('Адреса сохранены'); render(); return false; }
async function saveCompanySettings(e) { e.preventDefault(); await api('/api/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); toast('Сохранено'); return false; }
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
async function openAutomation(id) {
  const rows = await api('/api/automations'); const a = id ? (rows.find(x => x.id === id) || {}) : {};
  openModal(`<h3>${id ? 'Правило' : 'Новая автоматизация'}</h3><form onsubmit="return saveAutomation(event,${id || 'null'})">
   <label>Название<input name="name" required value="${esc(a.name || '')}"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Когда<select name="trigger_type">${Object.entries({ deal_created: 'Создана сделка', message_in: 'Входящее сообщение', stage_changed: 'Смена этапа' }).map(([k, n]) => `<option value="${k}" ${k === a.trigger_type ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
   <label>Что сделать<select name="action_type">${Object.entries({ create_task: 'Создать задачу', change_stage: 'Перевести на этап', add_tag: 'Добавить тег' }).map(([k, n]) => `<option value="${k}" ${k === a.action_type ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
   <label>Значение действия: текст задачи, название этапа или тег<input name="action_value" value="${esc(a.action_value || '')}"></label>
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveAutomation(e, id) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); await api(id ? '/api/automations/' + id : '/api/automations', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }); closeModal(); toast('Правило сохранено'); render(); return false; }
async function openTemplate(id = null) {
  const rows = await api('/api/templates'); const t = id ? (rows.find(x => x.id === id) || {}) : {};
  openModal(`<h3>${id ? 'Шаблон' : 'Новый шаблон'}</h3><form onsubmit="return saveTemplate(event,${id || 'null'})"><label>Название<input name="name" required value="${esc(t.name || '')}" placeholder="Приветствие"></label>
   <label>Текст сообщения<textarea name="body" rows="4" required>${esc(t.body || '')}</textarea></label><label>Канал<select name="channel">${['any', 'whatsapp', 'telegram', 'instagram', 'viber', 'email'].map(c => `<option value="${c}" ${c === (t.channel || 'any') ? 'selected' : ''}>${channelLabel(c)}</option>`).join('')}</select></label>
   <p><small>Подстановки: {name} — имя клиента, {sum} — сумма сделки. Текст можно изменить после подстановки в чате.</small></p>
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
      const credentials = `КаркасCRM — данные для входа\nАдрес: ${location.origin}\nИмя: ${b.name}\nE-mail: ${b.email}\nВременный пароль: ${b.password}\n\nПри первом входе задайте личный пароль (не менее 12 символов). Не передавайте эти данные другим людям.`;
      openModal(`<h3>${id ? 'Пароль обновлён' : 'Пользователь создан'}</h3><p>Передайте данные сотруднику по защищённому каналу. После закрытия окна пароль повторно не показывается.</p>${!b.active ? '<p class="err">Вход отключён. Разрешите вход в карточке сотрудника.</p>' : ''}<label>Данные для входа<textarea id="createdCredentials" rows="9" readonly>${esc(credentials)}</textarea></label><button type="button" class="btn primary w" onclick="copyCreatedCredentials()">Скопировать данные</button><p id="copyCredentialsStatus" role="status"></p>`);
    } else toast('Пользователь сохранён');
    render();
  } catch (err) { toast(err.message, 'err'); }
  finally { btn.disabled = false; }
  return false;
}
async function copyCreatedCredentials() {
  const field = $('#createdCredentials'), status = $('#copyCredentialsStatus');
  try {
    await navigator.clipboard.writeText(field.value);
    status.textContent = 'Данные скопированы. Передайте их сотруднику лично.';
  } catch {
    field.focus(); field.select();
    status.textContent = 'Автоматическое копирование недоступно. Нажмите Ctrl+C или скопируйте выделенный текст вручную.';
  }
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
// Загрузка логотипа компании: картинка проверяется сервером по содержимому, а не по расширению.
async function uploadLogo(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) return toast('Файл больше 4 МБ — выберите изображение поменьше');
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const dataBase64 = String(reader.result).split(',').pop();
      const r = await api('/api/logo', { method: 'POST', body: JSON.stringify({ filename: file.name, contentType: file.type, dataBase64 }) });
      refreshLogo(r.url);
      toast('Логотип обновлён');
      render();
    } catch (err) { toast(err.message, 'err'); }
  };
  reader.readAsDataURL(file);
}
function deleteLogo() {
  askConfirm('Удалить загруженный логотип? Будет использоваться стандартный.', async () => {
    const r = await api('/api/logo', { method: 'DELETE' });
    refreshLogo(r.url);
    toast('Логотип удалён');
    render();
  }, { okText: 'Удалить логотип' });
}
function refreshLogo(url) {
  const withTs = url.includes('?') ? url : url + '?ts=' + Date.now();
  $$('img[src^="/logo.png"]').forEach(img => { img.src = withTs; });
  const fav = document.querySelector('link[rel="icon"]');
  if (fav) fav.href = withTs;
}
async function importContacts() { openModal(`<h3>Импорт контактов из CSV</h3><p><small>Первая строка — заголовки: <code>Имя;Телефон;E-mail;Компания</code>. Разделитель — <code>;</code> или <code>,</code>.</small></p><form onsubmit="return doImport(event)"><label>Вставьте CSV<textarea name="csv" rows="8" placeholder="Имя;Телефон;E-mail;Компания&#10;Иван Петров;+7 900 111-22-33;ivan@mail.ru;ООО Иван"></textarea></label><label>…или выберите файл<input type="file" accept=".csv,text/csv" onchange="csvFromFile(this)"></label><button class="btn primary w">Импортировать</button></form>`); }
function csvFromFile(input) { const f = input.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { $('#modalBody textarea').value = r.result; }; r.readAsText(f); }
async function doImport(e) { e.preventDefault(); const d = await api('/api/import/contacts', { method: 'POST', body: JSON.stringify({ csv: new FormData(e.target).get('csv') }) }); closeModal(); toast(d.message || ('Импортировано контактов: ' + d.imported)); render(); return false; }
const DEL_LABELS = { contacts: 'контакт', companies: 'компанию', deals: 'сделку', tasks: 'задачу', products: 'позицию каталога', automations: 'правило', pipelines: 'воронку' };
function del(table, id, name = '') {
  const what = DEL_LABELS[table] || 'запись';
  askConfirm(`Удалить ${what}${name ? ' «' + name + '»' : ''}? Действие необратимо.`, async () => {
    await api(`/api/${table}/${id}`, { method: 'DELETE' });
    closeModal(); toast('Удалено'); render();
  }, { okText: 'Удалить' });
}

/* ---------- global search + realtime ---------- */
let searchT;
const si = $('#globalSearch');
function closeDropdown(el) {
  const d = el && el.closest && el.closest('details');
  if (d) d.open = false;
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
      box.innerHTML = sections.join('') || empty;
      box.classList.remove('hidden');
    }, 200);
  };
  document.addEventListener('click', e => { if (!e.target.closest('.searchbox')) $('#searchResults')?.classList.add('hidden'); });
}

/* ── палитра команд (Ctrl+K) ────────────────────────────────────────── */
const PALETTE_ACTIONS = [
  { group: 'Разделы', items: [
    { ico: 'dashboard', title: 'Дашборд', hint: 'обзор продаж', run: () => go('dashboard') },
    { ico: 'pipe', title: 'Сделки', hint: 'канбан-воронка', run: () => go('pipe') },
    { ico: 'inbox', title: 'Чаты', hint: 'единый инбокс мессенджеров', run: () => go('inbox') },
    { ico: 'contacts', title: 'Контакты', hint: 'база клиентов', run: () => go('contacts') },
    { ico: 'companies', title: 'Компании', hint: 'юридические лица', run: () => go('companies') },
    { ico: 'tasks', title: 'Задачи', hint: 'дела и календарь', run: () => go('tasks') },
    { ico: 'products', title: 'Товары', hint: 'каталог домов и опций', run: () => go('products') },
    { ico: 'competitors', title: 'Конкуренты', hint: 'разведка и проверка', run: () => go('competitors') },
    { ico: 'analytics', title: 'Аналитика', hint: 'воронка и план продаж', run: () => go('analytics') },
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
    if (d.type === 'overdue_tasks') toast(`Внимание: просроченных задач — ${d.count}`);
    if (state.view === 'inbox') { refreshInbox(); api('/api/dashboard').then(navCounts).catch(() => {}); }
    else if (state.view === 'dashboard') render();
  });
  es.addEventListener('message', e => {
    const d = JSON.parse(e.data);
    // исходящие из другого окна не анонсируем, входящие — показываем с именем клиента
    if (d.direction !== 'out') toast(`Новое сообщение: ${d.title || 'клиент'}${d.preview ? ' — ' + d.preview : ''}`);
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

// любая необработанная ошибка запроса видна пользователю, а не только в консоли
window.addEventListener('unhandledrejection', e => {
  const msg = e.reason && e.reason.message;
  if (msg && !/abort|aborted|timeout/i.test(msg)) toast(msg, 'err');
});

boot();
