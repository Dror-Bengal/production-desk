import { createRoot } from 'react-dom/client'
import { Production } from './Production'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <main className="mx-auto max-w-[1500px] p-4 sm:p-7"><Production /></main>
)
