import { BrowserRouter } from 'react-router-dom'
import AppProviders from './app/AppProviders'
import AppRouter from './app/AppRouter'

export default function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </BrowserRouter>
  )
}
