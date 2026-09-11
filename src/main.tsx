import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import AuthGate from './auth/AuthGate'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </I18nProvider>
  </StrictMode>,
)
