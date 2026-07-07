import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { resources } from "./resources";
import { DEFAULT_LANGUAGE } from "./types";

if (!i18n.isInitialized) {
  void i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: DEFAULT_LANGUAGE,
      fallbackLng: DEFAULT_LANGUAGE,
      interpolation: {
        escapeValue: false,
      },
      returnNull: false,
    });
} else {
  // Fast Refresh re-evaluates this module with updated resources while the
  // i18next singleton stays initialized with the bundle it captured at app
  // start — without re-registering, strings added mid-session render as raw
  // key ids until the next cold start.
  Object.entries(resources).forEach(([language, bundle]) => {
    i18n.addResourceBundle(language, "translation", bundle.translation, true, true);
  });
}

export default i18n;
