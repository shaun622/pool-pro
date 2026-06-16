import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { translations } from '../lib/translations'

const LanguageContext = createContext({ lang: 'en', setLang: () => {}, seedFromProfile: () => {}, t: (k) => k })
const STORAGE_KEY = 'poolpro:language'
export const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'id', label: 'ID' },
]

export function LanguageProvider({ children }) {
  // localStorage is the per-device source of truth. `explicit` tracks
  // whether the user has actively chosen on this device, so a profile
  // preference only seeds the very first time (and never overrides a
  // local choice).
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'en' } catch { return 'en' }
  })
  const [explicit, setExplicit] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) != null } catch { return false }
  })

  const setLang = useCallback((l) => {
    setLangState(l)
    setExplicit(true)
    try { localStorage.setItem(STORAGE_KEY, l) } catch {}
  }, [])

  // Adopt a saved profile language on first load (e.g. logging in on a
  // new device), but only if the operator hasn't chosen on this device.
  const seedFromProfile = useCallback((l) => {
    if (!l || explicit) return
    setLangState(l)
  }, [explicit])

  // Keep <html lang> roughly in sync for accessibility. (Native date
  // inputs stay en-AU via index.html — this is just the document lang.)
  useEffect(() => {
    try { document.documentElement.setAttribute('lang', lang === 'id' ? 'id' : 'en-AU') } catch {}
  }, [lang])

  const t = useCallback((key, params) => {
    const dict = translations[lang] || translations.en
    let str = (dict && dict[key]) ?? translations.en[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
      }
    }
    return str
  }, [lang])

  return (
    <LanguageContext.Provider value={{ lang, setLang, seedFromProfile, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

// Translate an English service-task name for DISPLAY only. The English
// `name` is what gets stored in service_tasks.task_name and what the
// server-side report reads, so reports stay English even when the tech
// works in Indonesian.
export function translateTaskName(englishName, lang, t) {
  const key = `task.${englishName}`
  const dict = translations[lang] || translations.en
  return (dict && dict[key]) || englishName
}

// Translate an English "unable to service" reason for DISPLAY only. The
// English value is what gets stored in service_records.unable_reason and
// read by the admin email/detail, so those stay English even when the
// tech works in Indonesian (same approach as translateTaskName).
export function translateUnableReason(englishReason, lang) {
  if (!englishReason) return ''
  const key = `unableReason.${englishReason}`
  const dict = translations[lang] || translations.en
  return (dict && dict[key]) || englishReason
}
