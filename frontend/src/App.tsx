import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Limits from './pages/Limits'
import NearMe from './pages/NearMe'
import NotFound from './pages/NotFound'

// Leaflet and Recharts load only on the pages that use them.
const RiskMap = lazy(() => import('./pages/RiskMap'))
const ClusterPage = lazy(() => import('./pages/ClusterPage'))
const HowItWorks = lazy(() => import('./pages/HowItWorks'))

const wrap = (el: ReactNode) => <Suspense fallback={<div className="container loading">Loading…</div>}>{el}</Suspense>

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="map" element={wrap(<RiskMap />)} />
          <Route path="cluster/:id" element={wrap(<ClusterPage />)} />
          <Route path="near-me" element={<NearMe />} />
          <Route path="how-it-works" element={wrap(<HowItWorks />)} />
          <Route path="limits" element={<Limits />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
